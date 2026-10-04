import { describe, it, expect } from "vitest";
import { buildSovereignYieldCurve, selectBenchmark, computeSpreadBps, WIDE_TENOR_GAP_DAYS, type YieldCurvePoint } from "../benchmark";

function point(tenorDays: number, yieldPct: number): YieldCurvePoint {
  return { tenorDays, tenorLabel: `${tenorDays}D`, yieldPct, instrumentLabel: `${tenorDays}D bill`, instrumentCode: null, isGovernmentBond: false, observationDate: "2026-01-01" };
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
});

describe("computeSpreadBps", () => {
  it("is positive when the corporate bond yields more than the benchmark", () => {
    expect(computeSpreadBps(28, 25)).toBe(300);
  });

  it("is negative when the corporate bond yields less than the benchmark", () => {
    expect(computeSpreadBps(24, 25)).toBe(-100);
  });
});
