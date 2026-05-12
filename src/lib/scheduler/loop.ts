import { KalshiClient, fetchBtcSpot } from "../kalshi/client";
import { generateQuotes, type MarketState as AsMarketState } from "../strategy/asMm";
import { useBotStore, type MarketQuote, type LastQuoteRecord } from "../store";
import type { KalshiMarket } from "../kalshi/types";
import { reservedForQuote, actualReservedFromOpenOrders } from "../strategy/collateral";
import { mapLimit } from "../utils/mapLimit";

/** Max parallel Kalshi requests during bulk cancel — protects against 429s. */
const CANCEL_CONCURRENCY = 5;

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message?.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message");
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage.trim();
    const maybeName = Reflect.get(error, "name");
    if (typeof maybeName === "string" && maybeName.trim()) return maybeName.trim();
  }
  return "Unknown error";
}

let timer: number | null = null;
let ticking = false;

/** Per-ticker mutex to prevent overlapping quote operations. */
const tickerLocks = new Set<string>();

/** In-flight client_order_ids — avoid double-submitting the same logical order. */
const inFlightClientIds = new Set<string>();

async function makeClientId(
  ticker: string,
  side: "bid" | "ask",
  priceCents: number,
  size: number,
): Promise<string> {
  // Kalshi requires client_order_id to be a UUID. We derive a deterministic
  // UUID-v4-shaped value from (ticker, side, price, size, minute-bucket) via
  // SHA-256 so duplicate submissions within the same bucket get the same id
  // and Kalshi rejects them as duplicates (hard idempotency).
  const bucket = Math.floor(Date.now() / 60_000);
  const seed = `mm|${ticker}|${side}|${priceCents}|${size}|${bucket}`;
  const buf = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  );
  // Format as UUID v4 (set version=4 and variant=10xx).
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const h = Array.from(buf.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function waitForCancels(client: KalshiClient, ticker: string, maxWaitMs = 3000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const remaining = await client.getOpenOrders(ticker);
      if (remaining.length === 0) return true;
    } catch {
      // ignore transient errors and retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function refreshMarkets(client: KalshiClient) {
  try {
    const markets = await client.getBtc15MinMarkets();
    useBotStore.getState().setMarkets(markets);
    useBotStore
      .getState()
      .log("info", `loaded ${markets.length} BTC 15-min markets`);
  } catch (e) {
    useBotStore.getState().log("warn", `refreshMarkets: ${errorMessage(e)}`);
  }
}

async function syncAccount(client: KalshiClient) {
  try {
    const [bal, positions, openOrders] = await Promise.all([
      client.getBalance(),
      client.getPositions(),
      client.getOpenOrders().catch(() => []),
    ]);
    useBotStore.getState().setBalance(bal.balance / 100);
    useBotStore.getState().setPositions(positions);
    const snap = actualReservedFromOpenOrders(openOrders);
    useBotStore.getState().setActualReserved({
      totalCents: snap.totalCents,
      perTicker: snap.perTicker,
      orderCount: openOrders.length,
      ts: Date.now(),
    });
  } catch (e) {
    useBotStore.getState().log("warn", `syncAccount: ${errorMessage(e)}`);
  }
}

async function pollFills(client: KalshiClient) {
  const s = useBotStore.getState();
  // Look back from the last fill we saw, with a 60s overlap to be safe.
  const sinceMs = s.lastFillTs > 0 ? s.lastFillTs - 60_000 : Date.now() - 5 * 60_000;
  try {
    const fills = await client.getFills({ min_ts: sinceMs, limit: 100 });
    if (fills.length === 0) return;
    const seen = new Set(s.seenFillIds);
    const fresh = fills.filter((f) => !seen.has(f.trade_id));
    if (fresh.length === 0) return;
    let maxTs = s.lastFillTs;
    for (const f of fresh) {
      const price = f.side === "yes" ? f.yes_price : f.no_price;
      const ts = new Date(f.created_time).getTime();
      if (ts > maxTs) maxTs = ts;
      s.log(
        "fill",
        `${f.action.toUpperCase()} ${f.count} @ ${price}¢ ${f.is_taker ? "(taker)" : "(maker)"} order=${f.order_id}`,
        f.ticker
      );
      // Mark the order as filled in the ledger (releases collateral row).
      s.closeOrderLedger(f.order_id, "filled", price);
    }
    s.addSeenFillIds(fresh.map((f) => f.trade_id));
    s.setLastFillTs(maxTs);
  } catch (e) {
    s.log("warn", `pollFills: ${errorMessage(e)}`);
  }
}

async function quoteMarket(
  client: KalshiClient,
  market: KalshiMarket,
  spot: number
) {
  const s = useBotStore.getState();

  // Per-ticker mutex
  if (tickerLocks.has(market.ticker)) {
    s.log("warn", "skipped — quote in progress", market.ticker);
    return;
  }
  tickerLocks.add(market.ticker);

  try {
  const pos = s.positions[market.ticker]?.position ?? 0;

  // Risk: per-market position cap
  if (Math.abs(pos) >= s.risk.perMarketPositionCap) {
    s.log("warn", `position cap reached (${pos})`, market.ticker);
    return;
  }

  // Risk: global cap on total resting orders.
  if (s.risk.maxOpenOrders > 0) {
    const restingCount = s.orderLedger.filter((e) => e.status === "resting").length;
    if (restingCount >= s.risk.maxOpenOrders) {
      s.log("warn", `max open orders reached (${restingCount}/${s.risk.maxOpenOrders})`, market.ticker);
      return;
    }
  }

  // Skip markets that are closed or about to close — Kalshi rejects new
  // orders on closed markets with 409 market_closed. Use a small safety
  // buffer so we don't race the closing tick.
  const CLOSE_BUFFER_SEC = 15;
  const closeMs = market.close_time ? new Date(market.close_time).getTime() : 0;
  if (closeMs > 0 && closeMs - Date.now() <= CLOSE_BUFFER_SEC * 1000) {
    s.log(
      "info",
      `market closed or closing within ${CLOSE_BUFFER_SEC}s — skipping quote`,
      market.ticker,
    );
    return;
  }
  if (market.status && market.status !== "open" && market.status !== "active") {
    s.log("info", `market status=${market.status} — skipping quote`, market.ticker);
    return;
  }

  // Build MarketState for the AS market-maker. Book prices come from
  // Kalshi in cents (1..99); the strategy operates in dollars (0.01..0.99).
  const expMs = new Date(market.expiration_time).getTime();
  const secsToExpiry = Math.max(1, Math.floor((expMs - Date.now()) / 1000));
  const globalInventory = Object.values(s.positions).reduce((a, p) => a + (p.position ?? 0), 0);
  const asState: AsMarketState = {
    ticker: market.ticker,
    strike: market.floor_strike ?? market.cap_strike ?? 0,
    timeToExpirySec: secsToExpiry,
    bestBid: market.yes_bid > 0 ? market.yes_bid / 100 : null,
    bestAsk: market.yes_ask > 0 && market.yes_ask < 100 ? market.yes_ask / 100 : null,
    positionYes: pos,
    // Kalshi REST returns a fresh snapshot per call; treat fetch time as book ts.
    lastBookTs: Date.now() / 1000,
    spotBtc: spot,
  };
  const [asQuote] = generateQuotes([asState], {
    gamma: s.strategy.gamma,
    sigmaAnnual: s.strategy.sigmaAnnual,
    k: s.strategy.k,
    minEdgeCents: s.strategy.minEdgeCents,
    maxQuoteSize: s.strategy.maxQuoteSize,
    maxInventoryPerMarket: s.risk.perMarketPositionCap,
    maxGlobalInventory: Number.MAX_SAFE_INTEGER,
    // Configurable freshness threshold; fall back to one tick interval (min 5s).
    maxBookAgeSec:
      s.strategy.maxBookAgeSec ??
      Math.max(5, (s.strategy.tickIntervalMs ?? 5000) / 1000),
    askBidRatio:
      s.marketRatioOverrides?.[market.ticker] ?? s.strategy.askBidRatio,
    fillability: {
      ...s.strategy.fillability,
      ...(s.marketFillabilityOverrides?.[market.ticker] ?? {}),
    },
  });

  // Debug log every generated quote: mid, reservation, askBidRatio, raw vs final.
  if (asQuote.debug) {
    const d = asQuote.debug;
    const fmt = (x: number) => (x * 100).toFixed(1);
    s.log(
      "quote",
      `quote-debug mid=${fmt(d.mid)}¢ r=${fmt(d.reservation)}¢ ratio=${d.askBidRatio.toFixed(2)}× ` +
        `raw[${fmt(d.rawBid)}¢/${fmt(d.rawAsk)}¢] final[${fmt(d.finalBid)}¢/${fmt(d.finalAsk)}¢]` +
        (d.unfillableReason ? ` UNFILLABLE: ${d.unfillableReason}` : ""),
      market.ticker,
    );
    if (d.unfillableReason) {
      s.recordUnfillableQuote(market.ticker, d.unfillableReason);
    } else {
      s.recordFillableQuote(market.ticker);
    }
  }

  // If neither side is quotable (no book, no position to reduce, or ratio-blocked), skip.
  if (asQuote.bidPrice == null && asQuote.askPrice == null) {
    s.log("info", asQuote.debug?.unfillableReason ?? "no quote (insufficient book)", market.ticker);
    return;
  }

  // Adapt to the existing cents-based downstream code. Use a fairValue
  // derived from the book mid for logging/UI continuity.
  const midDollars =
    asState.bestBid != null && asState.bestAsk != null
      ? 0.5 * (asState.bestBid + asState.bestAsk)
      : asState.bestBid ?? asState.bestAsk ?? 0.5;
  const quote = {
    bidCents: asQuote.bidPrice != null ? Math.round(asQuote.bidPrice * 100) : 0,
    askCents: asQuote.askPrice != null ? Math.round(asQuote.askPrice * 100) : 100,
    fairValue: midDollars,
  };
  const size = s.strategy.maxQuoteSize;
  const placeBid = asQuote.bidPrice != null && asQuote.bidSize > 0;
  const placeAsk = asQuote.askPrice != null && asQuote.askSize > 0;

    // Re-quote threshold: skip if previous quote within threshold and still resting.
    const prev = s.lastQuotes[market.ticker];
    const threshold = s.strategy.requoteThresholdCents;
    if (
      prev &&
      Math.abs(prev.bidCents - quote.bidCents) < threshold &&
      Math.abs(prev.askCents - quote.askCents) < threshold &&
      prev.size === size
    ) {
      // Verify orders are still resting; if so, skip.
      try {
        const open = await client.getOpenOrders(market.ticker);
        const stillResting = open.length > 0;
        if (stillResting) {
          s.log("info", `no re-quote (Δ < ${threshold}¢)`, market.ticker);
          return;
        }
      } catch {
        // fall through and re-quote
      }
    }

  // Cancel existing open orders on this ticker, then place new bid/ask.
    let cancelledCount = 0;
    let releasedCents = 0;
  try {
    const open = await client.getOpenOrders(market.ticker);
      // Compute collateral that will be released by cancelling these orders.
      for (const o of open) {
        const price = o.yes_price ?? o.no_price ?? 0;
        if (o.action === "buy") releasedCents += price * o.count;
        else releasedCents += (100 - price) * o.count;
      }
      const results = await Promise.allSettled(
        open.map((o) =>
          client
            .cancelOrder(o.order_id)
            .then(() => {
              s.log("info", `cancelled ${o.order_id} (${o.action} ${o.yes_price ?? o.no_price}¢ × ${o.count})`, market.ticker);
              s.closeOrderLedger(o.order_id, "cancelled");
              return true;
            })
        )
      );
      cancelledCount = results.filter((r) => r.status === "fulfilled").length;
      if (cancelledCount > 0 && releasedCents > 0) {
        s.log(
          "info",
          `collateral released: ${fmtUsd(releasedCents)} (${cancelledCount} order${cancelledCount === 1 ? "" : "s"} cancelled)`,
          market.ticker
        );
      }
  } catch (e) {
    s.log("warn", `cancel: ${(e as Error).message}`, market.ticker);
  }

    // Wait until cancellations are confirmed by the API before placing new orders.
    if (cancelledCount > 0) {
      const ok = await waitForCancels(client, market.ticker);
      if (!ok) {
        s.log("warn", "cancel-confirm timeout — skipping place", market.ticker);
        return;
      }
    }

  // Skip side if it would exceed cap after fill.
  const canBuy = placeBid && pos + size <= s.risk.perMarketPositionCap;
  const canSell = placeAsk && pos - size >= -s.risk.perMarketPositionCap;

    let bidOrderId: string | undefined;
    let askOrderId: string | undefined;
    let bidClientId: string | undefined;
    let askClientId: string | undefined;

  try {
    if (canBuy) {
        bidClientId = await makeClientId(market.ticker, "bid", quote.bidCents, size);
        if (!inFlightClientIds.has(bidClientId)) {
          inFlightClientIds.add(bidClientId);
          try {
            const r = await client.placeOrder({
              ticker: market.ticker,
              side: "yes",
              action: "buy",
              count: size,
              yes_price: quote.bidCents,
              type: "limit",
              client_order_id: bidClientId,
            });
            bidOrderId = r.order?.order_id;
            const bidColl = quote.bidCents * size;
            s.log(
              "info",
              `placed BID ${quote.bidCents}¢ × ${size} → reserves ${fmtUsd(bidColl)} → ${bidOrderId ?? "?"}`,
              market.ticker
            );
            if (bidOrderId) {
              s.appendOrderLedger({
                orderId: bidOrderId,
                clientOrderId: bidClientId,
                ticker: market.ticker,
                side: "bid",
                action: "buy",
                priceCents: quote.bidCents,
                size,
                reservedCents: bidColl,
                releasedCents: 0,
                status: "resting",
                placedAt: Date.now(),
              });
            }
          } finally {
            inFlightClientIds.delete(bidClientId);
          }
        }
    }
    if (canSell) {
        askClientId = await makeClientId(market.ticker, "ask", quote.askCents, size);
        if (!inFlightClientIds.has(askClientId)) {
          inFlightClientIds.add(askClientId);
          try {
            const r = await client.placeOrder({
              ticker: market.ticker,
              side: "yes",
              action: "sell",
              count: size,
              yes_price: quote.askCents,
              type: "limit",
              client_order_id: askClientId,
            });
            askOrderId = r.order?.order_id;
            const sellOpensShort = Math.max(0, size - Math.max(0, pos));
            const askColl = (100 - quote.askCents) * sellOpensShort;
            s.log(
              "info",
              `placed ASK ${quote.askCents}¢ × ${size} → reserves ${fmtUsd(askColl)} → ${askOrderId ?? "?"}`,
              market.ticker
            );
            if (askOrderId) {
              s.appendOrderLedger({
                orderId: askOrderId,
                clientOrderId: askClientId,
                ticker: market.ticker,
                side: "ask",
                action: "sell",
                priceCents: quote.askCents,
                size,
                reservedCents: askColl,
                releasedCents: 0,
                status: "resting",
                placedAt: Date.now(),
              });
            }
          } finally {
            inFlightClientIds.delete(askClientId);
          }
        }
    }
    // Net collateral delta vs. what was just released by the cancellations above.
    const newReserved = reservedForQuote(quote.bidCents, quote.askCents, size, pos);
    const deltaCents = newReserved.totalReservedCents - releasedCents;
    const deltaSign = deltaCents > 0 ? "+" : deltaCents < 0 ? "−" : "±";
    s.log(
      "quote",
      `bid ${quote.bidCents}¢ × ${size} / ask ${quote.askCents}¢ × ${size} (fv ${(quote.fairValue * 100).toFixed(1)}¢) · reserves ${fmtUsd(newReserved.totalReservedCents)} (Δ ${deltaSign}${fmtUsd(Math.abs(deltaCents))})`,
      market.ticker
    );

      const lastQ: LastQuoteRecord = {
        bidCents: quote.bidCents,
        askCents: quote.askCents,
        size,
        bidOrderId,
        askOrderId,
        bidClientId,
        askClientId,
        ts: Date.now(),
      };
      s.setLastQuote(market.ticker, lastQ);
  } catch (e) {
    s.log("error", `placeOrder: ${(e as Error).message}`, market.ticker);
  }

  const mq: MarketQuote = {
    ticker: market.ticker,
    fairValue: quote.fairValue,
    ourBid: quote.bidCents,
    ourAsk: quote.askCents,
    bookBid: market.yes_bid,
    bookAsk: market.yes_ask,
    position: pos,
    unrealizedPnl: 0,
    lastUpdated: Date.now(),
  };
  s.upsertMarketQuote(mq);
  } finally {
    tickerLocks.delete(market.ticker);
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  const s = useBotStore.getState();
  if (s.runState !== "running" || !s.credentials) {
    ticking = false;
    return;
  }
  const client = new KalshiClient(s.credentials);
  try {
    s.setLastTickAt(Date.now());

    // Refresh BTC spot
    try {
      const spot = await fetchBtcSpot();
      s.setBtcSpot(spot);
    } catch (e) {
      s.log("warn", `spot: ${(e as Error).message}`);
    }

    // Refresh markets every tick so the book (yes_bid/yes_ask) shown in
    // MarketsPanel updates in realtime. Kalshi's /markets endpoint returns
    // a fresh snapshot per call and is cheap enough at our tick rate.
    await refreshMarkets(client);
    await syncAccount(client);
    await pollFills(client);

    const spot = useBotStore.getState().btcSpot;
    const tracked = useBotStore.getState().trackedTickers;
    const markets = useBotStore.getState().markets.filter((m) => tracked.includes(m.ticker));

    if (spot > 0) {
      for (const m of markets) {
        await quoteMarket(client, m, spot);
      }
    }

    // Push P&L snapshot
    const st = useBotStore.getState();
    const positions = Object.values(st.positions);
    const realized = positions.reduce((acc, p) => acc + p.realized_pnl / 100, 0);
    const equity = st.balance + realized;
    st.pushPnl({ ts: Date.now(), realized, unrealized: 0, equity });

    // Daily stop-loss
    if (st.sessionStartEquity > 0) {
      const dayPnl = equity - st.sessionStartEquity;
      if (dayPnl <= -st.risk.dailyStopLossDollars) {
        st.log("error", `daily stop-loss hit (${dayPnl.toFixed(2)})`);
        st.setCircuitBreakerTrip({
          type: "daily-stop-loss",
          reason: `Daily stop-loss hit: $${dayPnl.toFixed(2)} (limit -$${st.risk.dailyStopLossDollars})`,
          equityAtTrip: equity,
          limitDollars: st.risk.dailyStopLossDollars,
          ts: Date.now(),
        });
        await killAll(true);
      }
    }

    // Circuit breaker: max loss within a rolling 60-second window. Uses the
    // pnlHistory we just pushed to find the highest equity in the last 60s
    // and trips if the current draw from that peak exceeds the limit.
    {
      const cutoff = Date.now() - 60_000;
      const window = useBotStore
        .getState()
        .pnlHistory.filter((p) => p.ts >= cutoff);
      if (window.length >= 2) {
        const peak = window.reduce((m, p) => (p.equity > m ? p.equity : m), -Infinity);
        const drop = Math.max(0, peak - equity);
        st.setLastMinuteDropDollars(drop);
        if (st.risk.maxLossPerMinuteDollars > 0 && drop >= st.risk.maxLossPerMinuteDollars) {
          const reason = `Max-loss/min circuit breaker: $${drop.toFixed(2)} drop in last 60s (limit $${st.risk.maxLossPerMinuteDollars})`;
          st.log("error", `circuit breaker: ${reason}`);
          st.setCircuitBreakerTrip({
            type: "max-loss-per-minute",
            reason,
            dropDollars: drop,
            limitDollars: st.risk.maxLossPerMinuteDollars,
            equityAtTrip: equity,
            ts: Date.now(),
          });
          await killAll(st.risk.autoFlattenOnStop);
        }
      } else {
        st.setLastMinuteDropDollars(0);
      }
    }

    // 15-minute cycle stops. Cycles align to wall-clock quarter hours
    // (:00, :15, :30, :45) — same cadence as Kalshi's BTC 15-min markets.
    const QUARTER_MS = 15 * 60 * 1000;
    const nowMs = Date.now();
    const currentCycleStart = Math.floor(nowMs / QUARTER_MS) * QUARTER_MS;
    if (st.cycleStartTs !== currentCycleStart) {
      // First tick of a new cycle. Settle the previous cycle's P&L (if any),
      // update the consecutive-losing-cycles counter, then snapshot equity
      // for the new cycle.
      if (st.cycleStartTs > 0) {
        const cyclePnl = equity - st.cycleStartEquity;
        const lost = cyclePnl < 0;
        st.recordCycleResult(lost);
        st.log(
          lost ? "warn" : "info",
          `cycle settled: ${cyclePnl >= 0 ? "+" : ""}$${cyclePnl.toFixed(2)} ` +
            `(${useBotStore.getState().consecutiveLosingCycles} consecutive losing)`,
        );
        const consec = useBotStore.getState().consecutiveLosingCycles;
        const limit = st.risk.maxConsecutiveLosingCycles;
        if (limit > 0 && consec >= limit) {
          const reason = `${consec} consecutive losing 15-min cycles (limit ${limit})`;
          st.log("error", `cycle stop: ${reason}`);
          st.setCircuitBreakerTrip({
            type: "consecutive-losing-cycles",
            reason,
            equityAtTrip: equity,
            limitDollars: limit,
            ts: Date.now(),
          });
          await killAll(true);
        }
      }
      st.setCycleSnapshot(equity, currentCycleStart);
    } else if (st.cycleStartEquity > 0 && st.risk.intraCycleDrawdownDollars > 0) {
      // Mid-cycle: enforce intra-cycle drawdown.
      const intraPnl = equity - st.cycleStartEquity;
      if (intraPnl <= -st.risk.intraCycleDrawdownDollars) {
        const reason = `Intra-cycle drawdown $${intraPnl.toFixed(2)} (limit -$${st.risk.intraCycleDrawdownDollars})`;
        st.log("error", `intra-cycle drawdown stop: ${reason}`);
        st.setCircuitBreakerTrip({
          type: "intra-cycle-drawdown",
          reason,
          equityAtTrip: equity,
          limitDollars: st.risk.intraCycleDrawdownDollars,
          ts: Date.now(),
        });
        await killAll(true);
      }
    }
    // Tick completed without throwing — clear watchdog error streak.
    s.recordTickSuccess();
  } catch (e) {
    const msg = errorMessage(e);
    s.log("error", `tick: ${msg}`);
    s.recordTickError(msg);
    handleWatchdog();
  } finally {
    ticking = false;
  }
}

/**
 * Watchdog policy:
 *  - 1–2 consecutive tick errors → no action (transient: network blip, 429,
 *    Kalshi 5xx). The next tick will retry naturally.
 *  - 3rd consecutive error → restart the interval timer (defensive: covers
 *    cases where setInterval drift / a hung promise has made ticks stop
 *    firing) and log a warning.
 *  - 5th consecutive error → give up auto-restart, pause the bot, and raise
 *    a user-visible alert. Real-money safety: never keep retrying blindly.
 */
function handleWatchdog() {
  const s = useBotStore.getState();
  const errs = s.watchdog.consecutiveErrors;
  if (s.runState !== "running") return;
  if (errs === 3) {
    s.log("warn", `watchdog: restarting tick timer after ${errs} consecutive errors`);
    s.recordWatchdogRestart();
    if (timer != null) {
      window.clearInterval(timer);
    }
    timer = window.setInterval(tick, s.strategy.tickIntervalMs);
  } else if (errs >= 5) {
    const reason = `Bot paused: ${errs} consecutive tick errors. Last error: ${s.watchdog.lastError ?? "unknown"}`;
    s.log("error", `watchdog: ${reason}`);
    s.raiseWatchdogAlert(reason);
    pause();
  }
}

export function start() {
  const s = useBotStore.getState();
  if (!s.credentials) {
    s.log("error", "Cannot start: credentials missing");
    return;
  }
  if (s.circuitBreakerTrip && !s.circuitBreakerTrip.acknowledgedAt) {
    s.log("error", "Cannot start: circuit breaker tripped — re-arm first");
    return;
  }
  if (s.sessionStartEquity === 0) s.setSessionStartEquity(s.balance);
  s.resetCycleStats();
  s.setRunState("running");
  s.log("info", "Bot started");
  if (timer != null) window.clearInterval(timer);
  timer = window.setInterval(tick, s.strategy.tickIntervalMs);
  // Run immediately
  void tick();
}

export function pause() {
  const s = useBotStore.getState();
  s.setRunState("paused");
  s.log("info", "Bot paused");
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

export async function killAll(flatten: boolean) {
  const s = useBotStore.getState();
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  s.setRunState("killed");
  s.log("error", "KILL SWITCH ACTIVATED");
  if (!s.credentials) return;
  const client = new KalshiClient(s.credentials);
  try {
    const open = await client.getOpenOrders();
    let killReleasedCents = 0;
    for (const o of open) {
      const price = o.yes_price ?? o.no_price ?? 0;
      if (o.action === "buy") killReleasedCents += price * o.count;
      else killReleasedCents += (100 - price) * o.count;
    }
    await mapLimit(open, CANCEL_CONCURRENCY, async (o) => {
      try {
        await client.cancelOrder(o.order_id);
        s.closeOrderLedger(o.order_id, "cancelled");
      } catch {
        // swallow per-order errors; kill switch is best-effort
      }
    });
    s.log(
      "info",
      `cancelled ${open.length} open orders → released ${fmtUsd(killReleasedCents)} of collateral`
    );
    if (flatten) {
      const positions = await client.getPositions();
      for (const p of positions) {
        if (p.position === 0) continue;
        const action = p.position > 0 ? "sell" : "buy";
        await client
          .placeOrder({
            ticker: p.ticker,
            side: "yes",
            action,
            count: Math.abs(p.position),
            type: "market",
          })
          .catch((e) => s.log("error", `flatten: ${e.message}`, p.ticker));
      }
      s.log("info", "Positions flattened");
    }
  } catch (e) {
    s.log("error", `kill: ${(e as Error).message}`);
  }
}

export function restartTimerIfRunning() {
  const s = useBotStore.getState();
  if (s.runState === "running") {
    if (timer != null) window.clearInterval(timer);
    timer = window.setInterval(tick, s.strategy.tickIntervalMs);
  }
}

/**
 * Re-arm the bot after a circuit-breaker stop. Clears the trip record,
 * resets the rolling-drop snapshot and cycle stats, returns the bot to the
 * idle state so the user can press Start again. Called only after the user
 * has reviewed and confirmed the (possibly updated) risk limits.
 */
export function rearm() {
  const s = useBotStore.getState();
  s.setCircuitBreakerTrip(null);
  s.setLastMinuteDropDollars(0);
  s.resetCycleStats();
  s.setSessionStartEquity(0);
  s.resetPnlHistory();
  s.setRunState("idle");
  s.log("info", "Bot re-armed after circuit-breaker stop");
}
