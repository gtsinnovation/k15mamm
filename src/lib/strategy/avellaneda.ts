import type { KalshiMarket } from "../kalshi/types";
import type { StrategyParams } from "../store";

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Probability that S_T ≥ strike (a "Price and Above" YES contract) under
 * lognormal dynamics dS/S = sigma dW (drift assumed zero for short horizons).
 * If the market also has a cap (legacy range market), we fall back to
 * P(floor ≤ S_T ≤ cap) for safety.
 */
export function aboveProbability(
  spot: number,
  floorStrike: number | undefined,
  capStrike: number | undefined,
  sigmaAnnual: number,
  yearsToExpiry: number
): number {
  if (yearsToExpiry <= 0 || spot <= 0) return 0.5;
  const sigmaT = sigmaAnnual * Math.sqrt(yearsToExpiry);
  if (sigmaT <= 0) return floorStrike && spot >= floorStrike ? 1 : 0;
  // P(S_T ≥ K) = N( (ln(S/K) - 0.5 σ²T) / σ√T )
  const probAbove = (k: number) =>
    normCdf((Math.log(spot / k) - 0.5 * sigmaT * sigmaT) / sigmaT);
  const pFloor = floorStrike ? probAbove(floorStrike) : 1;
  const pCap = capStrike ? probAbove(capStrike) : 0;
  // For "above" markets (no cap) this collapses to pFloor.
  // For legacy range markets it gives P(floor ≤ S_T ≤ cap).
  return Math.max(0, Math.min(1, pFloor - pCap));
}

/** Back-compat alias for older imports. */
export const rangeProbability = aboveProbability;

export interface AsQuote {
  fairValue: number; // 0..1
  reservation: number; // 0..1
  halfSpread: number; // 0..1
  bidCents: number;
  askCents: number;
}

/**
 * Compute Avellaneda-Stoikov quotes for a binary contract.
 * Inventory `q` is contracts long (positive) or short (negative) on YES.
 */
export function computeQuotes(
  market: KalshiMarket,
  spot: number,
  inventoryYes: number,
  params: StrategyParams,
  nowMs: number
): AsQuote {
  const expMs = new Date(market.expiration_time).getTime();
  const T = Math.max((expMs - nowMs) / (1000 * 60 * 60 * 24 * 365), 1 / (365 * 24 * 60));
  const sigma = params.sigmaAnnual;
  const sig2 = sigma * sigma;

  const p = aboveProbability(spot, market.floor_strike, market.cap_strike, sigma, T);

  // Reservation price (probability units, bounded [0,1]).
  const r = p - inventoryYes * params.gamma * sig2 * T;

  // Optimal half-spread.
  const delta =
    (params.gamma * sig2 * T) / 2 +
    (1 / params.gamma) * Math.log(1 + params.gamma / params.k);

  // Convert to cents and clip to [1, 99] grid.
  const minEdge = params.minEdgeCents / 100;
  const halfSpread = Math.max(delta, minEdge);

  const bid = Math.max(0.01, Math.min(0.99, r - halfSpread));
  const ask = Math.max(0.01, Math.min(0.99, r + halfSpread));

  return {
    fairValue: p,
    reservation: Math.max(0, Math.min(1, r)),
    halfSpread,
    bidCents: Math.max(1, Math.min(99, Math.round(bid * 100))),
    askCents: Math.max(1, Math.min(99, Math.round(ask * 100))),
  };
}
