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
//
// M7.3.1 hardening — a spread is only meaningful when both yields describe
// the same market moment and both observations pass integrity checks:
//   - candidates are ANALYTICS-ELIGIBLE sovereign observations only
//     (observation-quality.ts VALID; never a carried, post-maturity, or
//     contradictory print);
//   - selectBenchmarkForObservation matches the corporate observation's
//     DATE: only sovereign observations within BENCHMARK_DATE_WINDOW_DAYS
//     of it qualify, each with its tenor measured at its own date;
//   - if nothing qualifies, there is NO benchmark and NO spread ("Suitable
//     benchmark unavailable") rather than a misleading number.
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

/**
 * A sovereign observation may benchmark a corporate observation only if
 * the two are dated within this many days of each other. One month: GFIM
 * sovereign bonds trade sporadically, but most outstanding GoG bonds print
 * within a month of each other (10 of the 17 bonds on GFIM's OLD GOG sheet traded in Sep 2026), while yields
 * genuinely moved several hundred bps within weeks in 2026 (e.g. GoG Jan-27
 * traded at 64.02% on 31 Jul and 19.12% on 13 Aug) — so a wider window
 * would compare different market conditions.
 */
export const BENCHMARK_DATE_WINDOW_DAYS = 31;

/**
 * The displayed Ghana sovereign yield curve uses each security's latest
 * eligible point observed within this many days of the valuation date
 * (one quarter). Older prints are listed as excluded-from-curve rather
 * than drawn as though they described today's curve.
 */
export const CURVE_MAX_AGE_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDiff(aIso: string, bIso: string): number {
  return Math.round(Math.abs(new Date(`${aIso}T00:00:00.000Z`).getTime() - new Date(`${bIso}T00:00:00.000Z`).getTime()) / DAY_MS);
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
  /** Days between the benchmark's observation and the observation it benchmarks (0 when not date-matched). */
  observationGapDays: number;
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
    return { benchmark: nearestSecondary.point, tenorGapDays: nearestSecondary.gap, isWideGap: nearestSecondary.gap > WIDE_TENOR_GAP_DAYS, isSecondaryBenchmark: true, observationGapDays: 0 };
  }

  const nearestAny = nearestPoint(targetTenorDays, curve);
  if (!nearestAny) return null;
  return { benchmark: nearestAny.point, tenorGapDays: nearestAny.gap, isWideGap: nearestAny.gap > WIDE_TENOR_GAP_DAYS, isSecondaryBenchmark: false, observationGapDays: 0 };
}

/**
 * Date-matched benchmark (M7.3.1). `candidates` is the pool of
 * ANALYTICS-ELIGIBLE sovereign observations (any date — typically full
 * history), each with `tenorDays` measured at its own observation date.
 * Only candidates dated within `windowDays` of `targetObservationDate`
 * qualify. Among those: prefer SECONDARY_MARKET, then the nearest tenor,
 * then the closest date, then instrument label — fully deterministic.
 * Falls back to AUCTION_PRIMARY only when no secondary point qualifies.
 * Returns null when nothing qualifies — callers must then show no spread.
 */
export function selectBenchmarkForObservation(
  targetTenorDays: number,
  targetObservationDate: string,
  candidates: YieldCurvePoint[],
  windowDays: number = BENCHMARK_DATE_WINDOW_DAYS,
): BenchmarkSelection | null {
  const inWindow = candidates.filter((p) => dayDiff(p.observationDate, targetObservationDate) <= windowDays);
  const rank = (pool: YieldCurvePoint[]) =>
    [...pool].sort(
      (a, b) =>
        Math.abs(a.tenorDays - targetTenorDays) - Math.abs(b.tenorDays - targetTenorDays) ||
        dayDiff(a.observationDate, targetObservationDate) - dayDiff(b.observationDate, targetObservationDate) ||
        a.instrumentLabel.localeCompare(b.instrumentLabel),
    )[0];
  const secondary = inWindow.filter((p) => p.observationKind === "SECONDARY_MARKET");
  const chosen = secondary.length > 0 ? rank(secondary) : inWindow.length > 0 ? rank(inWindow) : undefined;
  if (!chosen) return null;
  const tenorGapDays = Math.abs(chosen.tenorDays - targetTenorDays);
  return {
    benchmark: chosen,
    tenorGapDays,
    isWideGap: tenorGapDays > WIDE_TENOR_GAP_DAYS,
    isSecondaryBenchmark: chosen.observationKind === "SECONDARY_MARKET",
    observationGapDays: dayDiff(chosen.observationDate, targetObservationDate),
  };
}

/** True when an eligible curve point is recent enough to be drawn on today's curve. */
export function isWithinCurveWindow(observationDate: string, valuationDateIso: string, maxAgeDays: number = CURVE_MAX_AGE_DAYS): boolean {
  return observationDate <= valuationDateIso && dayDiff(observationDate, valuationDateIso) <= maxAgeDays;
}

/** Corporate YTM minus the selected sovereign benchmark yield, in basis points. Positive means the corporate bond yields more than the benchmark. */
export function computeSpreadBps(corporateYtmPct: number, benchmarkYieldPct: number): number {
  return Math.round((corporateYtmPct - benchmarkYieldPct) * 100);
}
