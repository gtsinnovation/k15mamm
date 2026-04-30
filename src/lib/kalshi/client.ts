import { signRequest } from "./signer";
import { supabase } from "@/integrations/supabase/client";
import type {
  KalshiBalance,
  KalshiCredentials,
  KalshiFill,
  KalshiMarket,
  KalshiOrderbook,
  KalshiOrder,
  KalshiPosition,
} from "./types";

const BASE_URLS: Record<KalshiCredentials["env"], string> = {
  demo: "https://demo-api.kalshi.co/trade-api/v2",
  prod: "https://api.elections.kalshi.com/trade-api/v2",
};

/** Marker value for the built-in Lovable Cloud edge-function proxy. */
export const CLOUD_PROXY = "lovable-cloud";

function cloudProxyUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  return `${base.replace(/\/$/, "")}/functions/v1/kalshi-proxy`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff with jitter, capped at 8s. */
function backoffMs(attempt: number, baseMs = 400): number {
  const exp = Math.min(8000, baseMs * Math.pow(2, attempt));
  return Math.floor(exp * (0.7 + Math.random() * 0.6));
}

/**
 * "Price and Above" hourly BTC market detector. We accept a market if:
 *  - it's BTC (ticker or event_ticker contains BTC), and
 *  - it has a floor_strike but NO cap_strike (single-strike "above"),
 *    OR strike_type is one of the known "above" markers, and
 *  - it closes within the next ~6 hours (hourly cadence).
 */
function isBtcAboveHourly(m: import("./types").KalshiMarket): boolean {
  const isBtc =
    m.ticker.toUpperCase().includes("BTC") ||
    (m.event_ticker ?? "").toUpperCase().includes("BTC");
  if (!isBtc) return false;
  const st = (m.strike_type ?? "").toLowerCase();
  const isAbove =
    (m.floor_strike != null && m.cap_strike == null) ||
    st === "greater" ||
    st === "above" ||
    st === "greater_or_equal";
  if (!isAbove) return false;
  const closeMs = m.close_time ? new Date(m.close_time).getTime() : 0;
  if (closeMs === 0) return true; // keep if no close info — better than dropping
  const sixHours = 6 * 60 * 60 * 1000;
  return closeMs - Date.now() <= sixHours;
}

export class KalshiClient {
  constructor(private creds: KalshiCredentials) {}

  private buildUrl(path: string): string {
    const fullUrl = `${BASE_URLS[this.creds.env]}${path}`;
    // Default to the built-in Lovable Cloud edge-function proxy when no
    // proxy is configured. Calling Kalshi directly from the browser is
    // always blocked by CORS — there is no scenario where a missing
    // proxy is the right choice, so fall back instead of failing.
    const proxy = this.creds.corsProxy?.trim() || CLOUD_PROXY;
    // Built-in Lovable Cloud edge-function proxy.
    if (proxy === CLOUD_PROXY) {
      const apiSubPath = `/trade-api/v2${path}`;
      return `${cloudProxyUrl()}?env=${this.creds.env}&path=${encodeURIComponent(apiSubPath)}`;
    }
    // Two proxy styles:
    //  - "raw append" (target URL appended as-is): corsproxy.io style — proxy ends with `?`
    //  - "url-encoded query value": codetabs/allorigins/etc. — proxy ends with `=`
    // Anything else: assume path-style and url-encode the target.
    if (/\?$/.test(proxy)) return `${proxy}${fullUrl}`;
    if (/=$/.test(proxy)) return `${proxy}${encodeURIComponent(fullUrl)}`;
    return `${proxy}${encodeURIComponent(fullUrl)}`;
  }

  private async request<T>(
    method: string,
    pathWithQuery: string,
    body?: unknown
  ): Promise<T> {
    // Path used in signature must be the API path (not the proxy URL),
    // and Kalshi signs only the path portion (no query string).
    const pathOnly = pathWithQuery.split("?")[0];
    const apiSubPath = `/trade-api/v2${pathOnly}`;
    const url = this.buildUrl(pathWithQuery);
    const serializedBody = body ? JSON.stringify(body) : undefined;

    // Retry on 429 / 5xx with exponential backoff + jitter. Each retry
    // re-signs the request (timestamp must be fresh).
    const maxAttempts = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { timestamp, signature } = await signRequest(
        this.creds.privateKeyPem,
        method,
        apiSubPath,
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "KALSHI-ACCESS-KEY": this.creds.keyId,
        "KALSHI-ACCESS-SIGNATURE": signature,
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
      };
      const effectiveProxy = this.creds.corsProxy?.trim() || CLOUD_PROXY;
      if (effectiveProxy === CLOUD_PROXY) {
        // Attach the signed-in user's JWT so the edge function can verify
        // the email allowlist server-side. Falls back to anon key for
        // `apikey` (required by the gateway) but Authorization MUST be the
        // user session token, otherwise the edge function returns 401/403.
        const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
        let { data: { session } } = await supabase.auth.getSession();
        // If the access token is expired or near expiry, force a refresh so
        // the edge function never sees a stale JWT.
        const nowSec = Math.floor(Date.now() / 1000);
        if (!session || (session.expires_at != null && session.expires_at - nowSec < 30)) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          session = refreshed.session ?? session;
        }
        const userJwt = session?.access_token;
        if (!userJwt) {
          throw new Error("Not signed in — please sign in with Google to use the trade API.");
        }
        if (anon) headers["apikey"] = anon;
        headers["Authorization"] = `Bearer ${userJwt}`;
      }
      let res: Response;
      try {
        res = await fetch(url, { method, headers, body: serializedBody });
      } catch (e) {
        lastErr = e;
        // Network error — backoff and retry.
        await sleep(backoffMs(attempt));
        continue;
      }
      if (res.ok) return res.json() as Promise<T>;

      const text = await res.text().catch(() => "");
      // Retry on rate-limit and transient server errors.
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs(attempt, res.status === 429 ? 800 : 400);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Kalshi ${method} ${pathOnly} → ${res.status}: ${text}`);
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Kalshi ${method} ${pathOnly}: retries exhausted`);
  }

  getBalance(): Promise<KalshiBalance> {
    return this.request<KalshiBalance>("GET", "/portfolio/balance");
  }

  async getMarkets(eventTicker?: string): Promise<KalshiMarket[]> {
    const q = new URLSearchParams({ status: "open", limit: "200" });
    if (eventTicker) q.set("event_ticker", eventTicker);
    const r = await this.request<{ markets: KalshiMarket[] }>(
      "GET",
      `/markets?${q.toString()}`
    );
    return r.markets ?? [];
  }

  /**
   * Fetch hourly BTC "Price and Above" markets — single-strike YES/NO
   * contracts that pay YES if BTC ≥ floor_strike at expiry. These have a
   * floor_strike and NO cap_strike (strike_type = "greater" / "above").
   * Range contracts (both floor & cap) are excluded.
   */
  async getBtcHourlyMarkets(): Promise<KalshiMarket[]> {
    // Kalshi's BTC "above" hourly series tickers. KXBTC is the current
    // hourly above-series; the others are kept for backwards compatibility.
    const candidateSeries = ["KXBTC", "KXBTCD", "KXBTCH"];
    const collected = new Map<string, KalshiMarket>();

    for (const series of candidateSeries) {
      try {
        const q = new URLSearchParams({
          status: "open",
          series_ticker: series,
          limit: "200",
        });
        const r = await this.request<{ markets: KalshiMarket[] }>(
          "GET",
          `/markets?${q.toString()}`
        );
        for (const m of r.markets ?? []) {
          if (isBtcAboveHourly(m)) collected.set(m.ticker, m);
        }
      } catch {
        // some series tickers may 404 — keep trying
      }
    }

    // Fallback: broad scan of open markets, then filter to BTC hourly "above".
    if (collected.size === 0) {
      try {
        const q = new URLSearchParams({ status: "open", limit: "1000" });
        const r = await this.request<{ markets: KalshiMarket[] }>(
          "GET",
          `/markets?${q.toString()}`
        );
        for (const m of r.markets ?? []) {
          if (isBtcAboveHourly(m)) collected.set(m.ticker, m);
        }
      } catch {
        // ignore — return whatever we have
      }
    }

    return Array.from(collected.values());
  }

  getOrderbook(ticker: string): Promise<{ orderbook: KalshiOrderbook }> {
    return this.request("GET", `/markets/${ticker}/orderbook?depth=5`);
  }

  async getPositions(): Promise<KalshiPosition[]> {
    const r = await this.request<{ market_positions: KalshiPosition[] }>(
      "GET",
      "/portfolio/positions"
    );
    return r.market_positions ?? [];
  }

  async getOpenOrders(ticker?: string): Promise<KalshiOrder[]> {
    const q = new URLSearchParams({ status: "resting" });
    if (ticker) q.set("ticker", ticker);
    const r = await this.request<{ orders: KalshiOrder[] }>(
      "GET",
      `/portfolio/orders?${q.toString()}`
    );
    return r.orders ?? [];
  }

  placeOrder(params: {
    ticker: string;
    side: "yes" | "no";
    action: "buy" | "sell";
    count: number;
    yes_price?: number; // cents 1..99
    no_price?: number;
    type?: "limit" | "market";
    client_order_id?: string;
  }): Promise<{ order: KalshiOrder }> {
    const type = params.type ?? "limit";
    // Kalshi requires *exactly one* of yes_price / no_price for limit orders,
    // and *none* for market orders. Strip undefined keys so we never send
    // `yes_price: undefined` (which JSON-serializes away but still trips
    // some validation paths when both fields are present).
    const payload: Record<string, unknown> = {
      ticker: params.ticker,
      side: params.side,
      action: params.action,
      count: params.count,
      type,
      client_order_id: params.client_order_id ?? crypto.randomUUID(),
    };
    if (type === "limit") {
      if (params.yes_price != null && params.no_price != null) {
        throw new Error("placeOrder: provide exactly one of yes_price / no_price");
      }
      if (params.yes_price != null) payload.yes_price = params.yes_price;
      else if (params.no_price != null) payload.no_price = params.no_price;
      else throw new Error("placeOrder: limit order requires yes_price or no_price");
    }
    return this.request("POST", "/portfolio/orders", payload);
  }

  cancelOrder(orderId: string): Promise<unknown> {
    return this.request("DELETE", `/portfolio/orders/${orderId}`);
  }

  async getFills(opts?: { ticker?: string; min_ts?: number; limit?: number }): Promise<KalshiFill[]> {
    const q = new URLSearchParams({ limit: String(opts?.limit ?? 100) });
    if (opts?.ticker) q.set("ticker", opts.ticker);
    if (opts?.min_ts) q.set("min_ts", String(Math.floor(opts.min_ts / 1000)));
    const r = await this.request<{ fills: KalshiFill[] }>(
      "GET",
      `/portfolio/fills?${q.toString()}`
    );
    return r.fills ?? [];
  }
}

export async function fetchBtcSpot(): Promise<number> {
  // Coinbase public ticker — no auth, public CORS-friendly endpoint.
  const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
  if (!res.ok) throw new Error("Coinbase spot fetch failed");
  const j = (await res.json()) as { data: { amount: string } };
  return parseFloat(j.data.amount);
}
