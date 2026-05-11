/**
 * Avellaneda–Stoikov market-maker — TypeScript port of the reference
 * Python class (`AvellanedaStoikovMM.generate_quotes`). Operates in
 * dollar-price space (0..1) and emits one Quote per market.
 *
 * The scheduler loop builds `MarketState` from live Kalshi data
 * (best_bid/best_ask in dollars from yes_bid/yes_ask cents, current
 * YES position, seconds to expiry) and submits orders at the resulting
 * bid_price/ask_price × bid_size/ask_size.
 */

export interface MarketState {
  ticker: string;
  strike: number;
  /** Seconds until contract expiry. */
  timeToExpirySec: number;
  /** Best bid in dollars (e.g. 0.47), or null if no book. */
  bestBid: number | null;
  /** Best ask in dollars (e.g. 0.49), or null if no book. */
  bestAsk: number | null;
  /** +N = long YES, -N = short YES. */
  positionYes: number;
  /** Epoch seconds when the book snapshot was last updated. */
  lastBookTs: number;
  /** Current BTC spot price (USD). Used by per-strike pricing model. */
  spotBtc: number;
}

export interface AsMmConfig {
  gamma: number;
  sigmaAnnual: number;
  k: number;
  minEdgeCents: number;
  maxQuoteSize: number;
  maxInventoryPerMarket: number;
  maxGlobalInventory: number;
  /** Max age (seconds) of book snapshot before we skip quoting. */
  maxBookAgeSec: number;
  /** Minimum ask/bid price ratio enforced on quotes. Default 4. */
  askBidRatio?: number;
}

export interface QuoteDebug {
  mid: number;
  reservation: number;
  askBidRatio: number;
  rawBid: number;
  rawAsk: number;
  finalBid: number;
  finalAsk: number;
  /** Set when the ratio-enforced quote is judged non-fillable. */
  unfillableReason?: string;
}

export interface AsMmQuote {
  ticker: string;
  /** Dollars, rounded to 2dp; null = do not quote this side. */
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number;
  askSize: number;
  /** Diagnostics for the scheduler/UI. Optional — empty quotes may omit. */
  debug?: QuoteDebug;
}

const SECONDS_PER_YEAR = 365 * 24 * 3600;

/** Standard normal CDF via erf approximation (Abramowitz & Stegun 7.1.26). */
function normCdf(x: number): number {
  // erf approximation
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Fair probability that BTC settles ≥ strike at expiry, using a
 * lognormal/Black–Scholes-style approximation: P ≈ N(d2).
 * Placeholder model — replace with a richer one (drift, smile) later.
 */
export function fairPriceProbAbove(m: MarketState, cfg: AsMmConfig): number {
  const S = m.spotBtc;
  const K = m.strike;
  const T = Math.max(m.timeToExpirySec, 1) / SECONDS_PER_YEAR;
  const sigma = cfg.sigmaAnnual;
  if (S <= 0 || K <= 0 || sigma <= 0 || T <= 0) return 0.5;
  const denom = sigma * Math.sqrt(T);
  if (denom === 0) return 0.5;
  const d2 = (Math.log(S / K) - 0.5 * sigma * sigma * T) / denom;
  const prob = normCdf(d2);
  return Math.min(0.99, Math.max(0.01, prob));
}

function computeMid(m: MarketState, cfg: AsMmConfig): number | null {
  const bid = m.bestBid;
  const ask = m.bestAsk;

  // Per-strike model probability — used as fallback or blend partner.
  const modelMid = fairPriceProbAbove(m, cfg);

  // Both sides present and sane → blend 70% book, 30% model
  if (bid != null && ask != null && bid > 0 && ask > 0 && bid < ask) {
    const bookMid = 0.5 * (bid + ask);
    return 0.7 * bookMid + 0.3 * modelMid;
  }
  // One-sided book → shade then blend lightly toward model
  if (bid != null && bid > 0) {
    const shaded = Math.min(0.99, bid + 0.02);
    return 0.7 * shaded + 0.3 * modelMid;
  }
  if (ask != null && ask > 0) {
    const shaded = Math.max(0.01, ask - 0.02);
    return 0.7 * shaded + 0.3 * modelMid;
  }
  // No book → fall back to pure model estimate
  return modelMid;
}

function inventorySkew(posYes: number, globalInventory: number): number {
  const invScale = 0.01;
  const globalScale = 0.005;
  return invScale * posYes + globalScale * globalInventory;
}

function clampPrice(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

function quoteCore(
  m: MarketState,
  globalInventory: number,
  cfg: AsMmConfig,
): { bid: number; ask: number; size: number } | null {
  const mid = computeMid(m, cfg);
  if (mid == null) return null;

  const T = Math.max(m.timeToExpirySec, 1) / SECONDS_PER_YEAR;
  const sigma = cfg.sigmaAnnual;
  const spread = cfg.gamma * sigma * sigma * T + 2.0 / Math.max(cfg.k, 1e-6);
  const half = spread / 2;
  const skew = inventorySkew(m.positionYes, globalInventory);

  // Reservation price = inventory-adjusted "fair" price. Quoting symmetrically
  // around `r` (not `mid`) is what lets the skew actually flatten inventory:
  // when we're long YES, r < mid, so the ask drops toward the market and
  // becomes fillable. Anchoring minEdge to `mid` instead of `r` (the previous
  // behavior) defeats the skew on the ask side and causes one-sided fills.
  const r = mid - skew;

  let bid = r - half;
  let ask = r + half;

  const minEdge = cfg.minEdgeCents / 100;
  // Enforce minimum edge around the reservation price, not the raw mid.
  bid = Math.min(bid, r - minEdge);
  ask = Math.max(ask, r + minEdge);

  // Profitability constraint: ask must be at least ASK_BID_RATIO × bid so any
  // contract we buy can be resold at a guaranteed multiple inside the cycle.
  // If the natural spread doesn't satisfy this, widen by lowering the bid
  // (preferred: keeps the ask reachable) and only raise the ask if the bid
  // is already at the floor.
  const ASK_BID_RATIO = Math.max(1, cfg.askBidRatio ?? 4);
  bid = clampPrice(bid);
  ask = clampPrice(ask);
  if (bid > 0 && ask < ASK_BID_RATIO * bid) {
    // Try lowering bid first so ask = ASK_BID_RATIO * bid stays ≤ 0.99.
    const maxBidForAsk = ask / ASK_BID_RATIO;
    if (maxBidForAsk >= 0.01) {
      bid = maxBidForAsk;
    } else {
      bid = 0.01;
      ask = Math.min(0.99, ASK_BID_RATIO * bid);
    }
  }

  return {
    bid: clampPrice(bid),
    ask: clampPrice(ask),
    size: cfg.maxQuoteSize,
  };
}

function emptyQuote(ticker: string): AsMmQuote {
  return { ticker, bidPrice: null, askPrice: null, bidSize: 0, askSize: 0 };
}

/** True if the book snapshot is older than cfg.maxBookAgeSec. */
export function isBookStale(m: MarketState, cfg: AsMmConfig, nowSec = Date.now() / 1000): boolean {
  if (!Number.isFinite(m.lastBookTs) || m.lastBookTs <= 0) return true;
  return nowSec - m.lastBookTs > cfg.maxBookAgeSec;
}

/**
 * Freshness score in [0, 1]: 1.0 = perfect, 0.0 = unusable.
 * Combines book age and spread quality (50/50 blend).
 * Useful for diagnostics and "only quote on healthy markets" selection.
 */
export function computeFreshnessScore(
  m: MarketState,
  cfg: AsMmConfig,
  nowSec = Date.now() / 1000,
): number {
  // Age component
  let ageScore = 0;
  if (Number.isFinite(m.lastBookTs) && m.lastBookTs > 0) {
    const age = nowSec - m.lastBookTs;
    const denom = Math.max(cfg.maxBookAgeSec, 1.0);
    ageScore = Math.max(0, 1 - age / denom);
  }

  // Spread component: 0–10¢ spread maps to 1.0–0.0
  let spreadScore = 0;
  if (m.bestBid != null && m.bestAsk != null && m.bestBid < m.bestAsk) {
    const spread = m.bestAsk - m.bestBid;
    spreadScore = Math.max(0, 1 - spread / 0.10);
  }

  return 0.5 * ageScore + 0.5 * spreadScore;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Quote one market normally (both sides). */
export function quoteNormal(
  m: MarketState,
  globalInventory: number,
  cfg: AsMmConfig,
): AsMmQuote {
  const c = quoteCore(m, globalInventory, cfg);
  if (!c) return emptyQuote(m.ticker);
  return {
    ticker: m.ticker,
    bidPrice: round2(c.bid),
    askPrice: round2(c.ask),
    bidSize: c.size,
    askSize: c.size,
  };
}

/** Quote only the side that reduces exposure when per-market cap is hit. */
export function quoteWithInventoryCap(
  m: MarketState,
  globalInventory: number,
  cfg: AsMmConfig,
): AsMmQuote {
  const c = quoteCore(m, globalInventory, cfg);
  if (!c) return emptyQuote(m.ticker);
  if (m.positionYes > 0) {
    return { ticker: m.ticker, bidPrice: null, askPrice: round2(c.ask), bidSize: 0, askSize: c.size };
  }
  if (m.positionYes < 0) {
    return { ticker: m.ticker, bidPrice: round2(c.bid), askPrice: null, bidSize: c.size, askSize: 0 };
  }
  return emptyQuote(m.ticker);
}

/**
 * Batch entrypoint mirroring the Python `generate_quotes` API.
 */
export function generateQuotes(markets: MarketState[], cfg: AsMmConfig): AsMmQuote[] {
  const globalInventory = markets.reduce((s, m) => s + m.positionYes, 0);
  const nowSec = Date.now() / 1000;
  return markets.map((m) => {
    // Combined freshness gate (covers staleness + wide spreads).
    const freshness = computeFreshnessScore(m, cfg, nowSec);
    if (freshness < 0.3) {
      return emptyQuote(m.ticker);
    }
    if (Math.abs(m.positionYes) >= cfg.maxInventoryPerMarket) {
      return quoteWithInventoryCap(m, globalInventory, cfg);
    }
    return quoteNormal(m, globalInventory, cfg);
  });
}