import { describe, it, expect } from "vitest";
import { evaluateEquityMomentumCondition, computeMarketBreadth } from "../equities";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("evaluateEquityMomentumCondition", () => {
  it("is UNAVAILABLE with no GSE-CI data — never defaults to NEUTRAL", () => {
    const result = evaluateEquityMomentumCondition({ latest: null, history: [] });
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.headline).toContain("Awaiting");
  });

  it("is POSITIVE on a meaningful 1M rise", () => {
    const history = [
      { date: "2026-07-19", value: 4700 },
      { date: "2026-08-19", value: 4888 }, // +4%
    ];
    const result = evaluateEquityMomentumCondition({ latest: { observationDate: d("2026-08-19"), level: 4888 }, history });
    expect(result.state).toBe("POSITIVE");
    expect(result.sentiment).toBe("positive");
  });

  it("is NEGATIVE on a meaningful 1M fall", () => {
    const history = [
      { date: "2026-07-19", value: 4888 },
      { date: "2026-08-19", value: 4700 },
    ];
    const result = evaluateEquityMomentumCondition({ latest: { observationDate: d("2026-08-19"), level: 4700 }, history });
    expect(result.state).toBe("NEGATIVE");
    expect(result.sentiment).toBe("negative");
  });

  it("is NEUTRAL for a sub-noise-band move", () => {
    const history = [
      { date: "2026-07-19", value: 4880 },
      { date: "2026-08-19", value: 4888 }, // +0.16%
    ];
    const result = evaluateEquityMomentumCondition({ latest: { observationDate: d("2026-08-19"), level: 4888 }, history });
    expect(result.state).toBe("NEUTRAL");
  });
});

describe("computeMarketBreadth", () => {
  it("returns null when no security has a computable 1D return", () => {
    expect(computeMarketBreadth([])).toBeNull();
  });

  it("counts advancers/decliners/unchanged from 1D returns", () => {
    const rankable = [
      { securityId: "a", ticker: "A", companyName: "A", priceHistory: [{ date: d("2026-08-18"), value: 10 }, { date: d("2026-08-19"), value: 10.5 }], latestVolume: null, latestValueTradedGhs: null },
      { securityId: "b", ticker: "B", companyName: "B", priceHistory: [{ date: d("2026-08-18"), value: 10 }, { date: d("2026-08-19"), value: 9.5 }], latestVolume: null, latestValueTradedGhs: null },
      { securityId: "c", ticker: "C", companyName: "C", priceHistory: [{ date: d("2026-08-18"), value: 10 }, { date: d("2026-08-19"), value: 10 }], latestVolume: null, latestValueTradedGhs: null },
    ];
    const breadth = computeMarketBreadth(rankable);
    expect(breadth).toEqual({ advancers: 1, decliners: 1, unchanged: 1, total: 3 });
  });
});
