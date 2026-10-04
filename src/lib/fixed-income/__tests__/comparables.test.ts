import { describe, it, expect } from "vitest";
import { findComparables, type ComparableRow } from "../comparables";

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
});
