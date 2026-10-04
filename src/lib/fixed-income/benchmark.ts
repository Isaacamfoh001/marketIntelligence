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
//
// M7.2 §11: a corporate security's YTM is now sometimes itself a real
// SECONDARY_MARKET observation (GFIM trading report), so the sovereign
// benchmark must say which kind of rate it is — a weekly T-bill/auction
// PRIMARY rate is not the same thing as a bond's actual secondary-market
// trade yield. selectBenchmark prefers a SECONDARY_MARKET sovereign point
// at the nearest tenor when one exists, falling back to the nearest point
// of any kind (including AUCTION_PRIMARY) only when no secondary sovereign
// point exists at all — never silently comparing secondary vs primary when
// a secondary alternative was available.
// ---------------------------------------------------------------------------

export type YieldCurvePointKind = "AUCTION_PRIMARY" | "SECONDARY_MARKET";

export interface YieldCurvePoint {
  tenorDays: number;
  tenorLabel: string;
  yieldPct: number;
  instrumentLabel: string;
  instrumentCode: string | null;
  isGovernmentBond: boolean;
  observationDate: string;
  observationKind: YieldCurvePointKind;
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
  /** True when a SECONDARY_MARKET sovereign point existed and was preferred; false means the curve had no secondary points at all and an AUCTION_PRIMARY point was used instead. */
  isSecondaryBenchmark: boolean;
}

function nearestPoint(targetTenorDays: number, curve: YieldCurvePoint[]): { point: YieldCurvePoint; gap: number } | null {
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
  return { point: best, gap: bestGap };
}

/**
 * Nearest-tenor sovereign benchmark for a given remaining tenor. Returns
 * null only when the curve has no observed points at all. Prefers a
 * SECONDARY_MARKET point when the curve has any (M7.2 §11: "prefer
 * secondary vs secondary when available"); only falls back to the nearest
 * AUCTION_PRIMARY point when no secondary sovereign point exists.
 */
export function selectBenchmark(targetTenorDays: number, curve: YieldCurvePoint[]): BenchmarkSelection | null {
  const secondaryCurve = curve.filter((p) => p.observationKind === "SECONDARY_MARKET");
  const nearestSecondary = nearestPoint(targetTenorDays, secondaryCurve);
  if (nearestSecondary) {
    return { benchmark: nearestSecondary.point, tenorGapDays: nearestSecondary.gap, isWideGap: nearestSecondary.gap > WIDE_TENOR_GAP_DAYS, isSecondaryBenchmark: true };
  }

  const nearestAny = nearestPoint(targetTenorDays, curve);
  if (!nearestAny) return null;
  return { benchmark: nearestAny.point, tenorGapDays: nearestAny.gap, isWideGap: nearestAny.gap > WIDE_TENOR_GAP_DAYS, isSecondaryBenchmark: false };
}

/** Corporate YTM minus the selected sovereign benchmark yield, in basis points. Positive means the corporate bond yields more than the benchmark. */
export function computeSpreadBps(corporateYtmPct: number, benchmarkYieldPct: number): number {
  return Math.round((corporateYtmPct - benchmarkYieldPct) * 100);
}
