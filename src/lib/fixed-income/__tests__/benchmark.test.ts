import { describe, it, expect } from "vitest";
import { buildSovereignYieldCurve, selectBenchmark, selectBenchmarkForObservation, isWithinCurveWindow, computeSpreadBps, WIDE_TENOR_GAP_DAYS, BENCHMARK_DATE_WINDOW_DAYS, CURVE_MAX_AGE_DAYS, type YieldCurvePoint, type YieldCurvePointKind } from "../benchmark";

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

describe("selectBenchmarkForObservation — date-matched (M7.3.1)", () => {
  const p = (tenorDays: number, yieldPct: number, observationDate: string, kind: YieldCurvePointKind, label: string): YieldCurvePoint => ({
    tenorDays,
    tenorLabel: `${tenorDays}D`,
    yieldPct,
    instrumentLabel: label,
    instrumentCode: label,
    isGovernmentBond: kind === "SECONDARY_MARKET",
    observationDate,
    observationKind: kind,
  });

  const pool = [
    p(700, 20.06, "2026-09-16", "SECONDARY_MARKET", "GoG Jun-28"),
    p(690, 22.52, "2026-04-16", "SECONDARY_MARKET", "GoG Aug-27 (April)"),
    p(364, 11.59, "2026-08-24", "AUCTION_PRIMARY", "364D bill"),
    p(91, 5.08, "2026-09-20", "AUCTION_PRIMARY", "91D bill"),
  ];

  it("only considers sovereign observations dated within the window of the target observation", () => {
    const may = selectBenchmarkForObservation(860, "2026-05-07", pool)!;
    expect(may.benchmark.instrumentLabel).toBe("GoG Aug-27 (April)"); // the September print is ~4 months away
    expect(may.observationGapDays).toBe(21);
    expect(may.observationGapDays).toBeLessThanOrEqual(BENCHMARK_DATE_WINDOW_DAYS);
  });

  it("prefers a valid secondary observation over a closer-tenor primary auction rate", () => {
    const sel = selectBenchmarkForObservation(400, "2026-09-20", pool)!;
    expect(sel.benchmark.instrumentLabel).toBe("GoG Jun-28");
    expect(sel.isSecondaryBenchmark).toBe(true);
  });

  it("falls back to a primary auction rate only when no secondary observation is in the window", () => {
    const onlyPrimary = pool.filter((x) => x.observationKind === "AUCTION_PRIMARY");
    const sel = selectBenchmarkForObservation(120, "2026-09-25", onlyPrimary)!;
    expect(sel.benchmark.instrumentLabel).toBe("91D bill");
    expect(sel.isSecondaryBenchmark).toBe(false);
  });

  it("returns null — no spread — when no eligible sovereign observation is within the window", () => {
    expect(selectBenchmarkForObservation(700, "2025-01-15", pool)).toBeNull();
    expect(selectBenchmarkForObservation(700, "2026-09-16", [])).toBeNull();
  });

  it("is deterministic on ties (tenor, then date proximity, then label)", () => {
    const tied = [p(500, 20, "2026-09-10", "SECONDARY_MARKET", "B"), p(500, 21, "2026-09-10", "SECONDARY_MARKET", "A")];
    expect(selectBenchmarkForObservation(500, "2026-09-12", tied)!.benchmark.instrumentLabel).toBe("A");
    expect(selectBenchmarkForObservation(500, "2026-09-12", [...tied].reverse())!.benchmark.instrumentLabel).toBe("A");
  });
});

describe("isWithinCurveWindow", () => {
  it("keeps points up to the curve age limit, never future-dated ones", () => {
    expect(isWithinCurveWindow("2026-09-30", "2026-10-04")).toBe(true);
    expect(isWithinCurveWindow("2026-07-04", "2026-10-04")).toBe(true); // 92 days
    expect(CURVE_MAX_AGE_DAYS).toBe(92);
    expect(isWithinCurveWindow("2026-07-03", "2026-10-04")).toBe(false);
    expect(isWithinCurveWindow("2026-10-05", "2026-10-04")).toBe(false);
  });
});
