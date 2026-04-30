import { fetchBtcSpot } from "./client";

/**
 * Centralized, rate-limit-aware BTC spot poller.
 *
 * Coinbase's public spot endpoint is generous (~10k req/hr per IP) but does
 * occasionally return 429s and 5xx during incidents. We coalesce all
 * subscribers into a single in-flight request, enforce a minimum interval
 * between fetches, and exponentially back off after errors.
 *
 * Public API:
 *   - subscribeSpot(cb)            → cb(price | null, status) on every poll
 *   - getSpotPollStatus()          → current { intervalMs, throttled, reason }
 */

export type SpotPollReason =
  | "ok"
  | "rate-limited" // explicit 429 from upstream
  | "error" // network / 5xx
  | "idle";

export interface SpotPollStatus {
  /** Current interval between polls in milliseconds. */
  intervalMs: number;
  /** True when we've slowed below the normal cadence due to errors. */
  throttled: boolean;
  /** Why we're at the current cadence. */
  reason: SpotPollReason;
  /** Most recent error message, if any. */
  lastError?: string;
  /** Timestamp of the last successful fetch (ms). */
  lastOkAt: number;
  /** Number of consecutive failures. */
  consecutiveErrors: number;
}

type Listener = (price: number | null, status: SpotPollStatus) => void;

// Conservative defaults — well below Coinbase's stated rate limits while
// still feeling "live" for the pre-start dialog.
const NORMAL_INTERVAL_MS = 10_000;
const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 5 * 60_000; // 5 min ceiling
const RATE_LIMIT_BACKOFF_MS = 60_000; // first backoff after a 429

const listeners = new Set<Listener>();
let timer: number | null = null;
let inFlight: Promise<number | null> | null = null;
let lastFetchAt = 0;

const status: SpotPollStatus = {
  intervalMs: NORMAL_INTERVAL_MS,
  throttled: false,
  reason: "idle",
  lastOkAt: 0,
  consecutiveErrors: 0,
};

export function getSpotPollStatus(): SpotPollStatus {
  return { ...status };
}

function scheduleNext() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (listeners.size === 0) return;
  timer = window.setTimeout(() => {
    void poll();
  }, status.intervalMs);
}

function emit(price: number | null) {
  const snap = getSpotPollStatus();
  for (const cb of listeners) {
    try {
      cb(price, snap);
    } catch {
      /* listener errors are isolated */
    }
  }
}

function classifyError(err: unknown): { rateLimited: boolean; message: string } {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
  // fetchBtcSpot only throws "Coinbase spot fetch failed" today, so we
  // can't reliably distinguish 429 from other errors. Hook into status code
  // when available — see fetchBtcSpotWithStatus below for richer info.
  return { rateLimited: /429|rate.?limit|too many/i.test(msg), message: msg };
}

async function poll(): Promise<number | null> {
  // Enforce a hard minimum interval between fetches, regardless of caller.
  const now = Date.now();
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  if (inFlight) return inFlight;

  inFlight = (async () => {
    lastFetchAt = Date.now();
    try {
      const price = await fetchBtcSpot();
      // Success — reset throttle.
      status.consecutiveErrors = 0;
      status.lastError = undefined;
      status.lastOkAt = Date.now();
      status.intervalMs = NORMAL_INTERVAL_MS;
      status.throttled = false;
      status.reason = "ok";
      emit(price);
      return price;
    } catch (err) {
      const { rateLimited, message } = classifyError(err);
      status.consecutiveErrors += 1;
      status.lastError = message;
      // Exponential backoff: start at RATE_LIMIT_BACKOFF for 429s, otherwise
      // 2x the normal interval, doubling each consecutive failure.
      const base = rateLimited ? RATE_LIMIT_BACKOFF_MS : NORMAL_INTERVAL_MS * 2;
      const next = Math.min(MAX_INTERVAL_MS, base * Math.pow(2, status.consecutiveErrors - 1));
      status.intervalMs = next;
      status.throttled = next > NORMAL_INTERVAL_MS;
      status.reason = rateLimited ? "rate-limited" : "error";
      emit(null);
      return null;
    } finally {
      inFlight = null;
      scheduleNext();
    }
  })();

  return inFlight;
}

/**
 * Subscribe to centralized BTC spot polling. The first subscriber starts
 * the poll loop; the loop stops when the last subscriber unsubscribes.
 * Returns an unsubscribe function.
 */
export function subscribeSpot(cb: Listener): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    // First subscriber — fire an immediate poll, then schedule.
    void poll();
  } else {
    // Otherwise replay last status so the new subscriber gets context.
    cb(null, getSpotPollStatus());
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer != null) {
      window.clearTimeout(timer);
      timer = null;
      status.reason = "idle";
    }
  };
}

/** Force an immediate refresh, respecting the minimum interval. */
export function refreshSpotNow(): Promise<number | null> {
  return poll();
}