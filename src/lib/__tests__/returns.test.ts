import { describe, it, expect } from "vitest";
import { computeReturn, computeAllReturns, type DatedValue } from "../returns";

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function series(pairs: [string, number][]): DatedValue[] {
  return pairs.map(([iso, value]) => ({ date: d(iso), value }));
}

describe("computeReturn — 1D", () => {
  it("computes the percentage move vs the immediately prior stored observation", () => {
    const result = computeReturn(series([["2026-08-14", 2.50], ["2026-08-17", 2.55]]), "1D");
    expect(result).not.toBeNull();
    expect(result!.pct).toBeCloseTo(2.0, 5);
    expect(result!.comparisonDate).toBe("2026-08-14");
  });

  it("returns null with only one observation (insufficient history)", () => {
    expect(computeReturn(series([["2026-08-17", 2.50]]), "1D")).toBeNull();
  });

  it("returns null with zero observations", () => {
    expect(computeReturn([], "1D")).toBeNull();
  });

  it("returns exactly 0%, not null, for an unchanged price", () => {
    const result = computeReturn(series([["2026-08-14", 2.50], ["2026-08-17", 2.50]]), "1D");
    expect(result!.pct).toBe(0);
  });

  it("does not divide by zero when the prior observation was 0", () => {
    expect(computeReturn(series([["2026-08-14", 0], ["2026-08-17", 2.50]]), "1D")).toBeNull();
  });

  it("uses the prior stored observation across a weekend gap without treating the gap as missing data", () => {
    // Friday -> Monday, no Saturday/Sunday rows at all (non-trading days).
    const result = computeReturn(series([["2026-08-14", 2.50], ["2026-08-17", 2.60]]), "1D");
    expect(result!.pct).toBeCloseTo(4.0, 5);
  });

  it("still computes 1D across a long-weekend/holiday gap of exactly the documented tolerance (5 days)", () => {
    const result = computeReturn(series([["2026-08-12", 2.50], ["2026-08-17", 2.60]]), "1D");
    expect(result).not.toBeNull();
  });

  it("refuses to label a multi-week gap as 1D — returns null rather than a misleading percentage", () => {
    // ~7.5 months apart, e.g. a thinly-traded security's only two rows on record.
    const result = computeReturn(series([["2026-01-02", 0.70], ["2026-08-17", 0.75]]), "1D");
    expect(result).toBeNull();
  });

  it("returns null just past the documented gap tolerance (6 days)", () => {
    const result = computeReturn(series([["2026-08-11", 2.50], ["2026-08-17", 2.60]]), "1D");
    expect(result).toBeNull();
  });
});

describe("computeReturn — 1M/YTD/1Y: latest observation on or before the target date", () => {
  it("1M uses the latest observation on or before exactly one calendar month prior", () => {
    const s = series([["2026-07-15", 2.00], ["2026-07-20", 2.10], ["2026-08-17", 2.20]]);
    const result = computeReturn(s, "1M");
    // Target = 2026-07-17; latest on/before is 2026-07-15 (07-20 is AFTER the target).
    expect(result!.comparisonDate).toBe("2026-07-15");
    expect(result!.pct).toBeCloseTo(10.0, 5);
  });

  it("1M falls back to the latest available observation on/before target when the target itself isn't a trading date (weekend)", () => {
    // Target date 2026-07-18 is a Saturday; no observation that day.
    const s = series([["2026-07-17", 2.00], ["2026-08-18", 2.10]]);
    const result = computeReturn(s, "1M");
    expect(result!.comparisonDate).toBe("2026-07-17");
  });

  it("YTD compares against the latest observation on or before the prior year-end", () => {
    const s = series([["2025-12-30", 100], ["2026-01-05", 105], ["2026-08-17", 120]]);
    const result = computeReturn(s, "YTD");
    expect(result!.comparisonDate).toBe("2025-12-30");
    expect(result!.pct).toBeCloseTo(20.0, 5);
  });

  it("YTD returns null when history doesn't reach back to the prior year at all", () => {
    const s = series([["2026-01-05", 105], ["2026-08-17", 120]]);
    expect(computeReturn(s, "YTD")).toBeNull();
  });

  it("1Y compares against the latest observation on or before exactly one calendar year prior", () => {
    const s = series([["2025-08-15", 90], ["2025-08-18", 92], ["2026-08-17", 120]]);
    const result = computeReturn(s, "1Y");
    // Target = 2025-08-17; 08-18 is after the target, so 08-15 must be used.
    expect(result!.comparisonDate).toBe("2025-08-15");
  });

  it("returns null when there isn't enough history for the requested window at all", () => {
    const s = series([["2026-08-10", 2.00], ["2026-08-17", 2.20]]);
    expect(computeReturn(s, "1Y")).toBeNull();
    expect(computeReturn(s, "YTD")).toBeNull();
  });

  it("never returns the current point compared against itself when history starts after the target date", () => {
    // Only one observation exists, and it happens to be >= any shifted target — must not self-compare.
    const s = series([["2026-08-17", 2.00]]);
    expect(computeReturn(s, "1M")).toBeNull();
  });

  it("handles a leap-year February correctly for 1Y (2028-02-29 back to 2027 has no Feb 29)", () => {
    const s = series([["2027-02-28", 10], ["2028-02-29", 12]]);
    const result = computeReturn(s, "1Y");
    expect(result!.comparisonDate).toBe("2027-02-28");
  });
});

describe("computeAllReturns", () => {
  it("computes all four windows independently, some available and some not", () => {
    const s = series([["2026-08-14", 2.50], ["2026-08-17", 2.55]]);
    const all = computeAllReturns(s);
    expect(all["1D"]).not.toBeNull();
    expect(all["1M"]).toBeNull();
    expect(all.YTD).toBeNull();
    expect(all["1Y"]).toBeNull();
  });
});
