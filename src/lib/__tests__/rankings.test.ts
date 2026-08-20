import { describe, it, expect } from "vitest";
import { topGainers, topLosers, mostTraded, type RankableSecurity } from "../rankings";

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function sec(overrides: Partial<RankableSecurity> & { ticker: string }): RankableSecurity {
  return {
    securityId: overrides.ticker,
    companyName: `${overrides.ticker} Co`,
    priceHistory: [],
    latestVolume: null,
    latestValueTradedGhs: null,
    ...overrides,
  };
}

describe("topGainers / topLosers", () => {
  it("ranks gainers by 1D percentage move, largest first", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "A", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 10.5 }] }), // +5%
      sec({ ticker: "B", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 12 }] }), // +20%
      sec({ ticker: "C", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 9 }] }), // -10%
    ];
    const gainers = topGainers(securities);
    expect(gainers.map((g) => g.ticker)).toEqual(["B", "A"]);
  });

  it("ranks losers by 1D percentage move, largest loss first", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "A", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 9.5 }] }), // -5%
      sec({ ticker: "B", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 8 }] }), // -20%
    ];
    const losers = topLosers(securities);
    expect(losers.map((l) => l.ticker)).toEqual(["B", "A"]);
  });

  it("excludes a flat security from both gainers and losers rather than filling space with it", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "FLAT", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 10 }] }),
      sec({ ticker: "UP", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 10.5 }] }),
    ];
    expect(topGainers(securities).map((g) => g.ticker)).toEqual(["UP"]);
    expect(topLosers(securities).map((l) => l.ticker)).toEqual([]);
  });

  it("excludes a security with insufficient history (no computable 1D return) instead of treating it as flat", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "NEW", priceHistory: [{ date: d("2026-08-17"), value: 10 }] }), // only one observation
      sec({ ticker: "UP", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 10.5 }] }),
    ];
    expect(topGainers(securities).map((g) => g.ticker)).toEqual(["UP"]);
  });

  it("respects the limit parameter", () => {
    const securities: RankableSecurity[] = Array.from({ length: 10 }, (_, i) =>
      sec({ ticker: `T${i}`, priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 10 + i }] }),
    );
    expect(topGainers(securities, 3)).toHaveLength(3);
  });

  it("breaks ties deterministically by ticker", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "ZZZ", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 11 }] }),
      sec({ ticker: "AAA", priceHistory: [{ date: d("2026-08-14"), value: 10 }, { date: d("2026-08-17"), value: 11 }] }),
    ];
    expect(topGainers(securities).map((g) => g.ticker)).toEqual(["AAA", "ZZZ"]);
  });
});

describe("mostTraded", () => {
  it("ranks by value traded (the institutional default), highest first", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "A", latestValueTradedGhs: 500_000, priceHistory: [{ date: d("2026-08-17"), value: 10 }] }),
      sec({ ticker: "B", latestValueTradedGhs: 2_000_000, priceHistory: [{ date: d("2026-08-17"), value: 5 }] }),
    ];
    expect(mostTraded(securities, "value").map((m) => m.ticker)).toEqual(["B", "A"]);
  });

  it("ranks by volume when requested", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "A", latestVolume: 100_000, priceHistory: [{ date: d("2026-08-17"), value: 10 }] }),
      sec({ ticker: "B", latestVolume: 900_000, priceHistory: [{ date: d("2026-08-17"), value: 5 }] }),
    ];
    expect(mostTraded(securities, "volume").map((m) => m.ticker)).toEqual(["B", "A"]);
  });

  it("excludes a security whose value/volume was never published (missing, not zero)", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "NODATA", latestValueTradedGhs: null, priceHistory: [{ date: d("2026-08-17"), value: 10 }] }),
      sec({ ticker: "TRADED", latestValueTradedGhs: 500_000, priceHistory: [{ date: d("2026-08-17"), value: 10 }] }),
    ];
    expect(mostTraded(securities, "value").map((m) => m.ticker)).toEqual(["TRADED"]);
  });

  it("includes a security with an explicit 0 value traded (a real no-trade day), ranked last", () => {
    const securities: RankableSecurity[] = [
      sec({ ticker: "ZERO", latestValueTradedGhs: 0, priceHistory: [{ date: d("2026-08-17"), value: 10 }] }),
      sec({ ticker: "TRADED", latestValueTradedGhs: 500_000, priceHistory: [{ date: d("2026-08-17"), value: 10 }] }),
    ];
    const ranked = mostTraded(securities, "value");
    expect(ranked.map((m) => m.ticker)).toEqual(["TRADED", "ZERO"]);
  });
});
