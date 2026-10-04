// ---------------------------------------------------------------------------
// Ghana sovereign yield curve and corporate-spread benchmarking (M7 §11/§12).
//
// Pure functions over already-fetched observed points — no interpolation is
// computed or stored anywhere in this module (M7 §11: "do not fabricate
// interpolation precision unsupported by the data"). The benchmark for a
// corporate bond is always the single OBSERVED sovereign point with the
// closest remaining tenor, with the tenor gap always reported alongside the
// spread so a wide, poorly-matched comparison is visible rather than
// presented as precise (M7 §12).
// ---------------------------------------------------------------------------

export interface YieldCurvePoint {
  tenorDays: number;
  tenorLabel: string;
  yieldPct: number;
  instrumentLabel: string;
  instrumentCode: string | null;
  isGovernmentBond: boolean;
  observationDate: string;
}

/** Beyond this tenor gap, a sovereign benchmark comparison is flagged as wide rather than presented as a close match (M7 §12). */
export const WIDE_TENOR_GAP_DAYS = 365;

export function buildSovereignYieldCurve(points: YieldCurvePoint[]): YieldCurvePoint[] {
  return [...points].sort((a, b) => a.tenorDays - b.tenorDays);
}

export interface BenchmarkSelection {
  benchmark: YieldCurvePoint;
  tenorGapDays: number;
  isWideGap: boolean;
}

/** Nearest-tenor sovereign benchmark for a given remaining tenor. Returns null only when the curve has no observed points at all. */
export function selectBenchmark(targetTenorDays: number, curve: YieldCurvePoint[]): BenchmarkSelection | null {
  if (curve.length === 0) return null;
  let best = curve[0];
  let bestGap = Math.abs(curve[0].tenorDays - targetTenorDays);
  for (const point of curve.slice(1)) {
    const gap = Math.abs(point.tenorDays - targetTenorDays);
    if (gap < bestGap) {
      best = point;
      bestGap = gap;
    }
  }
  return { benchmark: best, tenorGapDays: bestGap, isWideGap: bestGap > WIDE_TENOR_GAP_DAYS };
}

/** Corporate YTM minus the selected sovereign benchmark yield, in basis points. Positive means the corporate bond yields more than the benchmark. */
export function computeSpreadBps(corporateYtmPct: number, benchmarkYieldPct: number): number {
  return Math.round((corporateYtmPct - benchmarkYieldPct) * 100);
}
