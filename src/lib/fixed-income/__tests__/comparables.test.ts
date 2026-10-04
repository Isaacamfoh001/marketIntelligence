import { describe, it, expect } from "vitest";
import { findComparables, findInYieldRange, relativeValue, comparability, COMPARABLE_TENOR_BAND_DAYS, type ComparableRow } from "../comparables";

function row(overrides: Partial<ComparableRow>): ComparableRow {
  return {
    instrumentCode: "X",
    instrumentName: "X Bond",
    issuerName: "X Co",
    classification: "CORPORATE",
    instrumentType: "CORPORATE_BOND",
    maturityDate: "2028-01-01",
    tenorDays: 730,
    ytmPct: 25,
    currentYieldPct: 24,
    modifiedDurationYears: 1.8,
    dv01: 0.02,
    spreadBps: 300,
    observationDate: "2026-01-01",
    observationKind: "AUCTION_PRIMARY",
    freshness: "CURRENT",
    ...overrides,
  };
}

describe("findComparables", () => {
  const target = row({ instrumentCode: "KASA-BND", ytmPct: 26, tenorDays: 700 });
  const universe: ComparableRow[] = [
    row({ instrumentCode: "A", ytmPct: 26.2, tenorDays: 690 }), // closest return
    row({ instrumentCode: "B", ytmPct: 30, tenorDays: 710 }), // far on return, close on maturity
    row({ instrumentCode: "C", ytmPct: 20, tenorDays: 90, classification: "SOVEREIGN", instrumentType: "GOVERNMENT_BOND" }),
    row({ instrumentCode: "D", ytmPct: null, tenorDays: 700 }), // no computable YTM — must be excluded everywhere
  ];

  it("SIMILAR_RETURN sorts by closest YTM and excludes rows with no computable YTM", () => {
    const result = findComparables(target, universe, "SIMILAR_RETURN");
    expect(result.map((r) => r.instrumentCode)).toEqual(["A", "B", "C"]);
  });

  it("SIMILAR_MATURITY sorts by closest tenor", () => {
    const result = findComparables(target, universe, "SIMILAR_MATURITY");
    expect(result.map((r) => r.instrumentCode)).toEqual(["A", "B", "C"]);
  });

  it("HIGHER_YIELD excludes anything not strictly higher, sorted ascending", () => {
    const result = findComparables(target, universe, "HIGHER_YIELD");
    expect(result.map((r) => r.instrumentCode)).toEqual(["A", "B"]);
  });

  it("GOVERNMENT_ONLY filters to sovereign rows", () => {
    const result = findComparables(target, universe, "GOVERNMENT_ONLY");
    expect(result.map((r) => r.instrumentCode)).toEqual(["C"]);
  });

  it("CORPORATE_ONLY filters to corporate rows", () => {
    const result = findComparables(target, universe, "CORPORATE_ONLY");
    expect(result.map((r) => r.instrumentCode)).toEqual(["A", "B"]);
  });

  it("returns nothing when the target itself has no computable YTM", () => {
    const noYtmTarget = row({ ytmPct: null });
    expect(findComparables(noYtmTarget, universe, "SIMILAR_RETURN")).toEqual([]);
  });

  it("never offers a matured security as an alternative", () => {
    const withMatured = [...universe, row({ instrumentCode: "M", ytmPct: 26, tenorDays: 0 })];
    expect(findComparables(target, withMatured, "SIMILAR_RETURN").map((r) => r.instrumentCode)).not.toContain("M");
  });

  it("recentOnly excludes stale observations; by default they are kept for the UI to badge", () => {
    const withStale = [...universe, row({ instrumentCode: "S", ytmPct: 26.05, freshness: "STALE" })];
    expect(findComparables(target, withStale, "SIMILAR_RETURN")[0].instrumentCode).toBe("S");
    expect(findComparables(target, withStale, "SIMILAR_RETURN", { recentOnly: true }).map((r) => r.instrumentCode)).not.toContain("S");
  });
});

describe("relativeValue (M7.3 §18)", () => {
  it("reports yield difference in bps and tenor difference in days, signed against the reference", () => {
    expect(relativeValue(23.58, 709, { ytmPct: 20.06, tenorDays: 617 })).toEqual({ ytmDiffBps: -352, tenorDiffDays: -92 });
    expect(relativeValue(23.58, 709, { ytmPct: 24.4, tenorDays: 1000 })).toEqual({ ytmDiffBps: 82, tenorDiffDays: 291 });
  });

  it("is null on yield when the alternative has no YTM", () => {
    expect(relativeValue(23.58, 709, { ytmPct: null, tenorDays: 700 }).ytmDiffBps).toBeNull();
  });
});

describe("findInYieldRange (M7.3 §16 — similar returns elsewhere)", () => {
  const universe: ComparableRow[] = [
    row({ instrumentCode: "SEL", ytmPct: 24 }), // selected — excluded
    row({ instrumentCode: "IN-HI", ytmPct: 25.9 }), // inside 23–25 + 100bp
    row({ instrumentCode: "IN-LO", ytmPct: 22.1, classification: "SOVEREIGN" }),
    row({ instrumentCode: "OUT", ytmPct: 26.5 }),
    row({ instrumentCode: "NOYTM", ytmPct: null }),
    row({ instrumentCode: "MATURED", ytmPct: 24, tenorDays: 0 }),
  ];

  it("returns non-selected outstanding rows within the band, highest yield first", () => {
    const r = findInYieldRange(universe, 23, 25, new Set(["SEL"]));
    expect(r.map((x) => x.instrumentCode)).toEqual(["IN-HI", "IN-LO"]);
  });

  it("accepts the band bounds in either order and a custom width", () => {
    expect(findInYieldRange(universe, 25, 23, new Set(["SEL"]), 0).map((x) => x.instrumentCode)).toEqual([]);
  });
});

describe("relative-value hardening (M7.3.1)", () => {
  const target = row({ instrumentCode: "KCP-SEP28", ytmPct: 23.5, tenorDays: 709, classification: "CORPORATE" });
  const universe: ComparableRow[] = [
    row({ instrumentCode: "GOG-2039", ytmPct: 23.45, tenorDays: 4683, classification: "SOVEREIGN", instrumentType: "GOVERNMENT_BOND" }), // closest yield, radically different tenor
    row({ instrumentCode: "LGH-OCT27", ytmPct: 24.3, tenorDays: 368, classification: "CORPORATE" }), // similar yield & tenor
    row({ instrumentCode: "GOG-MAY28", ytmPct: 24.66, tenorDays: 602, classification: "SOVEREIGN", instrumentType: "GOVERNMENT_BOND" }), // sovereign, similar tenor
    row({ instrumentCode: "STALE-1", ytmPct: 23.6, tenorDays: 700, freshness: "STALE", observationDate: "2026-05-07" }),
    row({ instrumentCode: "QUESTIONABLE", ytmPct: 23.5, tenorDays: 709, analyticsEligible: false }), // failed a quality check
  ];

  it("never offers an observation that failed a data-quality check", () => {
    for (const f of ["SIMILAR_RETURN", "SIMILAR_MATURITY", "HIGHER_YIELD", "GOVERNMENT_ONLY", "CORPORATE_ONLY"] as const) {
      expect(findComparables(target, universe, f).map((r) => r.instrumentCode)).not.toContain("QUESTIONABLE");
    }
    expect(findInYieldRange(universe, 23, 24, new Set()).map((r) => r.instrumentCode)).not.toContain("QUESTIONABLE");
  });

  it("lists similar-yield-and-tenor alternatives before a closer yield at a radically different tenor", () => {
    const order = findComparables(target, universe, "SIMILAR_RETURN").map((r) => r.instrumentCode);
    expect(order.indexOf("GOG-2039")).toBe(order.length - 1);
    expect(order.slice(0, 3)).toEqual(["STALE-1", "LGH-OCT27", "GOG-MAY28"]);
  });

  it("keeps stale alternatives (badged by the UI) unless recentOnly is requested", () => {
    expect(findComparables(target, universe, "SIMILAR_RETURN").map((r) => r.instrumentCode)).toContain("STALE-1");
    expect(findComparables(target, universe, "SIMILAR_RETURN", { recentOnly: true }).map((r) => r.instrumentCode)).not.toContain("STALE-1");
  });

  it("classifies comparability by tenor proximity to any reference security", () => {
    expect(comparability(368, [709])).toBe("SIMILAR_YIELD_AND_TENOR");
    expect(comparability(4683, [709])).toBe("SIMILAR_YIELD_DIFFERENT_TENOR");
    expect(comparability(709 + COMPARABLE_TENOR_BAND_DAYS, [709])).toBe("SIMILAR_YIELD_AND_TENOR");
    expect(comparability(4683, [709, 4500])).toBe("SIMILAR_YIELD_AND_TENOR");
  });

  it("findInYieldRange tiers by tenor proximity to the selected securities, then yield", () => {
    const order = findInYieldRange(universe, 23.5, 23.5, new Set(), 150, [709]).map((r) => r.instrumentCode);
    expect(order).toEqual(["GOG-MAY28", "LGH-OCT27", "STALE-1", "GOG-2039"]);
  });

  it("is deterministic regardless of input order", () => {
    const a = findComparables(target, universe, "SIMILAR_RETURN").map((r) => r.instrumentCode);
    const b = findComparables(target, [...universe].reverse(), "SIMILAR_RETURN").map((r) => r.instrumentCode);
    expect(a).toEqual(b);
  });
});
