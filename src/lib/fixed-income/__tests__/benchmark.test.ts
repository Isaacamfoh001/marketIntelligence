import { describe, it, expect } from "vitest";
import { buildSovereignYieldCurve, selectBenchmark, computeSpreadBps, WIDE_TENOR_GAP_DAYS, type YieldCurvePoint, type YieldCurvePointKind } from "../benchmark";

function point(tenorDays: number, yieldPct: number, observationKind: YieldCurvePointKind = "AUCTION_PRIMARY"): YieldCurvePoint {
  return { tenorDays, tenorLabel: `${tenorDays}D`, yieldPct, instrumentLabel: `${tenorDays}D bill`, instrumentCode: null, isGovernmentBond: false, observationDate: "2026-01-01", observationKind };
}

describe("buildSovereignYieldCurve", () => {
  it("sorts points ascending by tenor", () => {
    const curve = buildSovereignYieldCurve([point(364, 25), point(91, 22), point(182, 23)]);
    expect(curve.map((p) => p.tenorDays)).toEqual([91, 182, 364]);
  });
});

describe("selectBenchmark", () => {
  const curve = buildSovereignYieldCurve([point(91, 22), point(182, 23), point(364, 25), point(1095, 27)]);

  it("picks the closest observed tenor, not an interpolated value", () => {
    const selection = selectBenchmark(200, curve);
    expect(selection).not.toBeNull();
    expect(selection!.benchmark.tenorDays).toBe(182);
    expect(selection!.tenorGapDays).toBe(18);
  });

  it("flags a wide gap when no close sovereign tenor exists", () => {
    const selection = selectBenchmark(3000, curve);
    expect(selection!.tenorGapDays).toBeGreaterThan(WIDE_TENOR_GAP_DAYS);
    expect(selection!.isWideGap).toBe(true);
  });

  it("returns null when the curve has no points at all", () => {
    expect(selectBenchmark(365, [])).toBeNull();
  });

  it("falls back to an AUCTION_PRIMARY point and flags it as such when no secondary point exists", () => {
    const selection = selectBenchmark(200, curve);
    expect(selection!.isSecondaryBenchmark).toBe(false);
  });

  it("prefers a SECONDARY_MARKET point over a closer-tenor AUCTION_PRIMARY point (M7.2 §11)", () => {
    const mixedCurve = buildSovereignYieldCurve([
      point(180, 22, "AUCTION_PRIMARY"), // closer tenor to target (200) but primary
      point(400, 26, "SECONDARY_MARKET"), // farther tenor but a real secondary trade
    ]);
    const selection = selectBenchmark(200, mixedCurve);
    expect(selection!.benchmark.tenorDays).toBe(400);
    expect(selection!.isSecondaryBenchmark).toBe(true);
  });

  it("uses the nearest secondary point among several, not just the first secondary point found", () => {
    const mixedCurve = buildSovereignYieldCurve([
      point(91, 22, "AUCTION_PRIMARY"),
      point(1095, 27, "SECONDARY_MARKET"),
      point(200, 24, "SECONDARY_MARKET"),
    ]);
    const selection = selectBenchmark(210, mixedCurve);
    expect(selection!.benchmark.tenorDays).toBe(200);
    expect(selection!.isSecondaryBenchmark).toBe(true);
  });
});

describe("computeSpreadBps", () => {
  it("is positive when the corporate bond yields more than the benchmark", () => {
    expect(computeSpreadBps(28, 25)).toBe(300);
  });

  it("is negative when the corporate bond yields less than the benchmark", () => {
    expect(computeSpreadBps(24, 25)).toBe(-100);
  });
});
