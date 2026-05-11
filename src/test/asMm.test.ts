import { describe, it, expect } from "vitest";
import {
  generateQuotes,
  quoteNormal,
  type AsMmConfig,
  type MarketState,
} from "@/lib/strategy/asMm";

const baseCfg: AsMmConfig = {
  gamma: 0.5,
  sigmaAnnual: 0.6,
  k: 1.5,
  minEdgeCents: 2,
  maxQuoteSize: 5,
  maxInventoryPerMarket: 20,
  maxGlobalInventory: 1_000_000,
  maxBookAgeSec: 60,
  askBidRatio: 4,
};

const baseMarket: MarketState = {
  ticker: "TEST",
  strike: 100_000,
  timeToExpirySec: 600,
  bestBid: 0.45,
  bestAsk: 0.55,
  positionYes: 0,
  lastBookTs: Date.now() / 1000,
  spotBtc: 100_000,
};

describe("asMm fillability thresholds", () => {
  it("enforces ask = ratio * bid", () => {
    const q = quoteNormal(baseMarket, 0, { ...baseCfg, askBidRatio: 4 });
    if (q.bidPrice != null && q.askPrice != null) {
      expect(q.askPrice / q.bidPrice).toBeGreaterThanOrEqual(4 - 0.01);
    }
  });

  it("loose thresholds let a 4× quote through", () => {
    const q = quoteNormal(baseMarket, 0, {
      ...baseCfg,
      askBidRatio: 4,
      fillability: { pinnedBidMax: 0.001, pinnedAskMin: 0.999, outsideBookGap: 0.95 },
    });
    expect(q.debug?.unfillableReason).toBeUndefined();
  });

  it("tight outside-book gap marks quote unfillable", () => {
    const q = quoteNormal(baseMarket, 0, {
      ...baseCfg,
      askBidRatio: 20,
      fillability: { pinnedBidMax: 0.0101, pinnedAskMin: 0.9899, outsideBookGap: 0.01 },
    });
    expect(q.debug?.unfillableReason).toBeTruthy();
    expect(q.bidPrice).toBeNull();
    expect(q.askPrice).toBeNull();
  });

  it("generateQuotes returns one entry per market", () => {
    const out = generateQuotes([baseMarket, { ...baseMarket, ticker: "T2" }], baseCfg);
    expect(out).toHaveLength(2);
    expect(out.map((q) => q.ticker)).toEqual(["TEST", "T2"]);
  });
});
