import { describe, it, expect } from "vitest";
import { buildYieldLandscape, describeBenchmarkContext, describeMarketState, remainingTenorAtObservationDays, summarizeSegment, benchmarkLabeller, type IntelligenceSecurity } from "../landscape";
import type { ComparableRow } from "../comparables";
import type { BenchmarkSelection } from "../benchmark";

const VALUATION = new Date("2026-10-04T00:00:00.000Z");

function bench(yieldPct: number, extra: Partial<BenchmarkSelection["benchmark"]> = {}): BenchmarkSelection {
  return {
    benchmark: { tenorDays: 300, tenorLabel: "10M", yieldPct, instrumentLabel: "GoG bond", instrumentCode: null, isGovernmentBond: true, observationDate: "2026-09-09", observationKind: "SECONDARY_MARKET", ...extra },
    tenorGapDays: 12,
    isWideGap: false,
    isSecondaryBenchmark: true,
    observationGapDays: 3,
  };
}

function sec(o: Omit<Partial<IntelligenceSecurity>, "analytics"> & { analytics?: Partial<IntelligenceSecurity["analytics"]> }): IntelligenceSecurity {
  const { analytics, ...rest } = o;
  return {
    instrumentCode: "X",
    instrumentName: "X Bond",
    issuerName: "Acme Plc",
    classification: "CORPORATE",
    couponRatePct: 20,
    maturityDate: "2028-01-01",
    lifecycle: "ACTIVE",
    latestObservationDate: "2026-10-01",
    observationFreshness: "CURRENT",
    observationAgeDays: 3,
    analyticsEligible: true,
    analytics: { tenorDays: 450, ytmPct: 21, cleanPrice: 99, observationKind: "SECONDARY_MARKET", ytmSource: "SOLVED_FROM_PRICE", sourceQuotedYieldPct: null, quality: { status: "VALID", issues: [] }, ...analytics },
    carriedPrice: null,
    noTradeRecordedSince: null,
    termsIssues: [],
    benchmark: null,
    spreadBps: null,
    currentBenchmark: null,
    ...rest,
  };
}

describe("describeMarketState", () => {
  it("separates recent, stale, needs-review, carried-only and never-quoted", () => {
    expect(describeMarketState(sec({}))).toBe("RECENT");
    expect(describeMarketState(sec({ observationFreshness: "STALE" }))).toBe("STALE");
    // A trade that failed data-quality checks is not "recent" even if it traded yesterday.
    expect(describeMarketState(sec({ analyticsEligible: false, observationFreshness: "CURRENT" }))).toBe("NEEDS_REVIEW");
    expect(describeMarketState(sec({ latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false, noTradeRecordedSince: "2025-07-21" }))).toBe("CARRIED_ONLY");
    expect(describeMarketState(sec({ latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false }))).toBe("NO_QUOTE");
  });
});

describe("describeBenchmarkContext — observed spread vs reference yield stay distinct (M7.3.2 §8)", () => {
  const label = benchmarkLabeller([]);
  it("a reliable corporate trade with a date-matched benchmark is an OBSERVED_SPREAD", () => {
    const c = describeBenchmarkContext(sec({ benchmark: bench(12.5), spreadBps: 102 }), label);
    expect(c.type).toBe("OBSERVED_SPREAD");
    if (c.type === "OBSERVED_SPREAD") expect(c.spreadBps).toBe(102);
  });
  it("a corporate with NO reliable observation gets a REFERENCE_ONLY yield and never a spread", () => {
    const c = describeBenchmarkContext(sec({ latestObservationDate: null, analyticsEligible: false, currentBenchmark: bench(14.95) }), label);
    expect(c.type).toBe("REFERENCE_ONLY");
    expect(c).not.toHaveProperty("spreadBps");
  });
  it("a stale-but-reliable trade without a date-matched sovereign has no benchmark — it does NOT fall back to today's yield", () => {
    const c = describeBenchmarkContext(sec({ currentBenchmark: bench(14.95) }), label);
    expect(c.type).toBe("NO_DATE_MATCHED_BENCHMARK");
  });
  it("sovereigns are the benchmark; nothing available is UNAVAILABLE", () => {
    expect(describeBenchmarkContext(sec({ classification: "SOVEREIGN" }), label).type).toBe("SOVEREIGN");
    expect(describeBenchmarkContext(sec({ latestObservationDate: null, analyticsEligible: false }), label).type).toBe("UNAVAILABLE");
  });
});

describe("buildYieldLandscape", () => {
  const bill: ComparableRow = {
    instrumentCode: "TBILL-91D",
    instrumentName: "91-Day Treasury Bill",
    issuerName: "Government of Ghana",
    classification: "SOVEREIGN",
    instrumentType: "TREASURY_BILL",
    maturityDate: "2026-11-23",
    tenorDays: 91,
    ytmPct: 5.08,
    currentYieldPct: null,
    modifiedDurationYears: null,
    dv01: null,
    spreadBps: null,
    observationDate: "2026-08-24",
    observationKind: "AUCTION_PRIMARY",
    freshness: "STALE",
    analyticsEligible: true,
  };

  const securities = [
    sec({ instrumentCode: "REC" }),
    sec({ instrumentCode: "OLD", observationFreshness: "STALE", observationAgeDays: 150, latestObservationDate: "2026-05-07" }),
    // Legitimate unusual yield stays plotted when VALID.
    sec({ instrumentCode: "OUT", classification: "SOVEREIGN", issuerName: "Government of Ghana", analytics: { ytmPct: 58.68 } }),
    sec({ instrumentCode: "REV", analyticsEligible: false, analytics: { ytmPct: 61, quality: { status: "REVIEW", issues: [{ code: "YIELD_MISMATCH", severity: "REVIEW", label: "Yield mismatch", detail: "x" }] } } }),
    sec({ instrumentCode: "CAR", latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false, noTradeRecordedSince: "2025-07-21", carriedPrice: { cleanPrice: 101, asOf: "2026-10-01" }, analytics: { ytmPct: null, cleanPrice: null, observationKind: null, quality: null } }),
    sec({ instrumentCode: "NEV", latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false, analytics: { ytmPct: null, cleanPrice: null, observationKind: null, quality: null } }),
    sec({ instrumentCode: "MAT", lifecycle: "MATURED" }),
  ];
  const landscape = buildYieldLandscape(securities, [bill], VALUATION);

  it("plots only reliable observations (plus T-bills); review/excluded are withheld with reasons, never plotted", () => {
    expect(landscape.points.map((p) => p.id).sort()).toEqual(["OLD", "OUT", "REC", "TBILL-91D"]);
    expect(landscape.withheld).toHaveLength(1);
    expect(landscape.withheld[0]).toMatchObject({ id: "REV", status: "REVIEW", reason: "Yield mismatch" });
  });

  it("keeps stale observations marked stale and never promotes them to recent", () => {
    expect(landscape.points.find((p) => p.id === "OLD")).toMatchObject({ freshness: "STALE", observationDate: "2026-05-07" });
    expect(landscape.points.find((p) => p.id === "REC")?.freshness).toBe("CURRENT");
    expect(landscape.points.find((p) => p.id === "TBILL-91D")).toMatchObject({ freshness: "STALE", group: "TBILL", observationKind: "AUCTION_PRIMARY" });
  });

  it("preserves a legitimate unusual government yield", () => {
    expect(landscape.points.find((p) => p.id === "OUT")?.yieldPct).toBe(58.68);
  });

  it("counts carried-price-only and never-quoted securities without drawing them; matured are ignored entirely", () => {
    expect(landscape.notPlotted).toEqual({ carriedOnly: 1, neverQuoted: 1 });
    expect([...landscape.points, ...landscape.withheld].some((p) => p.id === "MAT")).toBe(false);
  });
});

describe("summarizeSegment", () => {
  it("returns factual counts and the latest secondary trade", () => {
    const s = summarizeSegment([
      sec({ instrumentCode: "A", latestObservationDate: "2026-10-01" }),
      sec({ instrumentCode: "B", observationFreshness: "STALE", latestObservationDate: "2026-05-07" }),
      sec({ instrumentCode: "C", analyticsEligible: false, latestObservationDate: "2026-09-01" }),
      sec({ instrumentCode: "D", latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false, noTradeRecordedSince: "2025-07-21" }),
      sec({ instrumentCode: "E", latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false }),
      sec({ instrumentCode: "M", lifecycle: "MATURED" }),
    ]);
    expect(s).toMatchObject({ active: 5, reliable: 2, recent: 1, stale: 1, needsReview: 1, carriedOnly: 1, neverQuoted: 1 });
    expect(s.latestTrade).toEqual({ date: "2026-10-01", freshness: "CURRENT" });
  });
});

describe("Yield Landscape tenor semantics (M7.4 §A) — x = maturity − OBSERVATION date, never maturity − today", () => {
  it("remainingTenorAtObservationDays measures from the observation date", () => {
    // GoG 20.75% Mar-27 traded 2 Feb 2026: 399 days of life at that observation, 520 from the 4 Oct 2026 valuation date.
    expect(remainingTenorAtObservationDays("2027-03-08", "2026-02-02")).toBe(399);
    expect(remainingTenorAtObservationDays("2027-03-08", "2026-10-04")).toBe(155);
    expect(remainingTenorAtObservationDays("2026-01-01", "2026-02-02")).toBe(0); // never negative
  });

  const old = sec({ instrumentCode: "MAR27", classification: "SOVEREIGN", issuerName: "Government of Ghana", maturityDate: "2027-03-08", latestObservationDate: "2026-02-02", observationFreshness: "STALE", observationAgeDays: 244, analytics: { tenorDays: 155, ytmPct: 30.18 } });
  const fresh = sec({ instrumentCode: "MAR27B", classification: "SOVEREIGN", issuerName: "Government of Ghana", maturityDate: "2027-03-08", latestObservationDate: "2026-10-02", observationAgeDays: 2, analytics: { tenorDays: 155, ytmPct: 18 } });
  const bill: ComparableRow = {
    instrumentCode: "TBILL-364D",
    instrumentName: "364-Day Treasury Bill",
    issuerName: "Government of Ghana",
    classification: "SOVEREIGN",
    instrumentType: "TREASURY_BILL",
    // maturity = auction date + tenor, exactly as the query layer builds it
    maturityDate: "2027-08-23",
    tenorDays: 364,
    ytmPct: 11.59,
    currentYieldPct: null,
    modifiedDurationYears: null,
    dv01: null,
    spreadBps: null,
    observationDate: "2026-08-24",
    observationKind: "AUCTION_PRIMARY",
    freshness: "STALE",
    analyticsEligible: true,
  };
  const { points } = buildYieldLandscape([old, fresh], [bill], VALUATION);

  it("two observations of the SAME bond sit at different x positions because they were observed at different tenors", () => {
    const a = points.find((p) => p.id === "MAR27")!;
    const b = points.find((p) => p.id === "MAR27B")!;
    expect(a.tenorAtObservationDays).toBe(399);
    expect(b.tenorAtObservationDays).toBe(157);
    expect(a.tenorAtObservationDays).toBeGreaterThan(b.tenorAtObservationDays);
  });

  it("keeps today's tenor separately (for comparables only), never as the plotted position", () => {
    expect(points.find((p) => p.id === "MAR27")!.tenorTodayDays).toBe(155);
  });

  it("a Treasury bill's tenor at its auction date is its full auction tenor", () => {
    expect(points.find((p) => p.id === "TBILL-364D")!.tenorAtObservationDays).toBe(364);
  });
});
