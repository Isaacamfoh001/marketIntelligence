// ---------------------------------------------------------------------------
// "Find Alternatives" — deterministic comparable-security ranking (M7 §14).
//
// Deliberately no invented composite score: every filter sorts by one real,
// already-displayed metric (YTM difference, maturity difference, or raw
// YTM) rather than blending factors into an opaque number (M7 §14: "It is
// preferable to transparently show Security A / YTM X / Maturity X ...
// than to produce an unexplained score of 87/100").
//
// M7.3.1: (1) only analytics-eligible observations (observation-quality.ts
// VALID) can be alternatives — a carried, post-maturity or contradictory
// print never appears as "similar"; (2) yield similarity alone is not
// comparability — a 2027 corporate and a 2039 GoG can share a yield while
// being very different exposures — so SIMILAR_RETURN lists alternatives
// within COMPARABLE_TENOR_BAND_DAYS of the target's tenor first, labelled
// as such, before similar-yield alternatives at different tenors. Two
// transparent sort keys, not a composite score.
// ---------------------------------------------------------------------------

export type ComparableFilter = "SIMILAR_RETURN" | "SIMILAR_MATURITY" | "HIGHER_YIELD" | "GOVERNMENT_ONLY" | "CORPORATE_ONLY";

export interface ComparableRow {
  instrumentCode: string;
  instrumentName: string;
  issuerName: string;
  classification: "SOVEREIGN" | "CORPORATE";
  instrumentType: string;
  maturityDate: string;
  /** Contractual coupon, for human-readable labels — null for T-bills (discount instruments). */
  couponRatePct?: number | null;
  tenorDays: number;
  ytmPct: number | null;
  currentYieldPct: number | null;
  modifiedDurationYears: number | null;
  dv01: number | null;
  spreadBps: number | null;
  /** When this YTM was observed, and whether it came from a real secondary-market trade or a primary auction (M7.2 §8/§11) — never implied by the YTM figure alone. */
  observationDate: string | null;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null;
  /** Cadence-aware freshness of the observation behind ytmPct (M7.3 §18) — a stale quote is shown as stale, never as current. */
  freshness: "CURRENT" | "STALE" | "MISSING";
  /** False when the observation behind ytmPct failed a data-quality check (M7.3.1) — such rows are never offered as alternatives. Omitted = eligible (Treasury-bill auction results). */
  analyticsEligible?: boolean;
}

/** Alternatives whose remaining tenor is within this many days of the target's are "similar tenor" and listed first (one year — the width of a single point on Ghana's sovereign curve beyond the T-bill tenors). */
export const COMPARABLE_TENOR_BAND_DAYS = 365;

export type Comparability = "SIMILAR_YIELD_AND_TENOR" | "SIMILAR_YIELD_DIFFERENT_TENOR";

export const COMPARABILITY_LABEL: Record<Comparability, string> = {
  SIMILAR_YIELD_AND_TENOR: "Similar yield & tenor",
  SIMILAR_YIELD_DIFFERENT_TENOR: "Similar yield · different tenor",
};

/** Tenor-based comparability of `tenorDays` to the closest of `referenceTenorDays`. */
export function comparability(tenorDays: number, referenceTenorDays: number[]): Comparability {
  const nearest = referenceTenorDays.reduce((min, t) => Math.min(min, Math.abs(tenorDays - t)), Infinity);
  return nearest <= COMPARABLE_TENOR_BAND_DAYS ? "SIMILAR_YIELD_AND_TENOR" : "SIMILAR_YIELD_DIFFERENT_TENOR";
}

function isEligible(r: ComparableRow): boolean {
  return r.ytmPct !== null && r.tenorDays > 0 && r.analyticsEligible !== false;
}

/** Deterministic final tie-breakers: more recent observation first, then instrument code. */
function tieBreak(a: ComparableRow, b: ComparableRow): number {
  return (b.observationDate ?? "").localeCompare(a.observationDate ?? "") || a.instrumentCode.localeCompare(b.instrumentCode);
}

export const COMPARABLE_FILTER_LABEL: Record<ComparableFilter, string> = {
  SIMILAR_RETURN: "Similar Return",
  SIMILAR_MATURITY: "Similar Maturity",
  HIGHER_YIELD: "Higher Yield",
  GOVERNMENT_ONLY: "Government Only",
  CORPORATE_ONLY: "Corporate Only",
};

/**
 * Ranks `universe` (which must exclude `target` itself) against `target`
 * under `filter`. Rows with no computable YTM are always excluded — they
 * cannot be meaningfully compared on return, and silently ranking them as
 * "0% different" would misrepresent missing data as a match (CLAUDE.md:
 * missing is never treated as a real value).
 */
export interface ComparableOptions {
  /** Exclude rows whose observation is STALE (M7.3 §18). Default false: stale rows are kept but must be badged by the UI. */
  recentOnly?: boolean;
}

export function findComparables(target: ComparableRow, universe: ComparableRow[], filter: ComparableFilter, options: ComparableOptions = {}): ComparableRow[] {
  // Matured instruments and quality-failed observations are never alternatives, whatever yield they printed.
  let withYtm = universe.filter(isEligible);
  if (options.recentOnly) withYtm = withYtm.filter((r) => r.freshness === "CURRENT");
  if (target.ytmPct === null) return [];

  let candidates = withYtm;
  if (filter === "GOVERNMENT_ONLY") candidates = candidates.filter((r) => r.classification === "SOVEREIGN");
  if (filter === "CORPORATE_ONLY") candidates = candidates.filter((r) => r.classification === "CORPORATE");
  if (filter === "HIGHER_YIELD") candidates = candidates.filter((r) => r.ytmPct! > target.ytmPct!);

  if (filter === "SIMILAR_MATURITY") {
    return [...candidates].sort((a, b) => Math.abs(a.tenorDays - target.tenorDays) - Math.abs(b.tenorDays - target.tenorDays) || tieBreak(a, b));
  }
  if (filter === "HIGHER_YIELD") {
    return [...candidates].sort((a, b) => a.ytmPct! - b.ytmPct! || tieBreak(a, b));
  }
  // SIMILAR_RETURN, GOVERNMENT_ONLY, CORPORATE_ONLY: similar-tenor tier first, then closest YTM.
  const tier = (r: ComparableRow) => (comparability(r.tenorDays, [target.tenorDays]) === "SIMILAR_YIELD_AND_TENOR" ? 0 : 1);
  return [...candidates].sort((a, b) => tier(a) - tier(b) || Math.abs(a.ytmPct! - target.ytmPct!) - Math.abs(b.ytmPct! - target.ytmPct!) || tieBreak(a, b));
}

export interface RelativeValue {
  /** Alternative's YTM minus the reference yield, in basis points (negative = the alternative yields less). Null when the alternative has no YTM. */
  ytmDiffBps: number | null;
  /** Alternative's remaining tenor minus the reference's, in days (negative = the alternative matures sooner). */
  tenorDiffDays: number;
}

/** Relative-value deltas of `row` versus a reference yield/tenor — informational only, never a ranking of which is "better" (M7.3 §18). */
export function relativeValue(referenceYtmPct: number, referenceTenorDays: number, row: Pick<ComparableRow, "ytmPct" | "tenorDays">): RelativeValue {
  return {
    ytmDiffBps: row.ytmPct === null ? null : Math.round((row.ytmPct - referenceYtmPct) * 100),
    tenorDiffDays: row.tenorDays - referenceTenorDays,
  };
}

/** How far outside the selected securities' return band the "similar returns" search reaches (M7.3 §16/§31 step 10). */
export const SIMILAR_RETURN_BAND_BPS = 100;

/**
 * Other outstanding securities whose observed YTM falls within
 * [lowPct − band, highPct + band] — the deterministic answer to "can we get
 * similar returns elsewhere in the market?". Sorted by comparability tier
 * (within COMPARABLE_TENOR_BAND_DAYS of any of `referenceTenorDays` first),
 * then recent observations before stale ones, then YTM descending —
 * factual orderings, not a ranking of merit.
 * Excludes matured rows, rows without a YTM, quality-failed observations,
 * and `excludeCodes` (the securities being compared).
 */
export function findInYieldRange(
  universe: ComparableRow[],
  lowPct: number,
  highPct: number,
  excludeCodes: ReadonlySet<string>,
  bandBps = SIMILAR_RETURN_BAND_BPS,
  referenceTenorDays: number[] = [],
): ComparableRow[] {
  const lo = Math.min(lowPct, highPct) - bandBps / 100;
  const hi = Math.max(lowPct, highPct) + bandBps / 100;
  const tier = (r: ComparableRow) => (referenceTenorDays.length > 0 && comparability(r.tenorDays, referenceTenorDays) === "SIMILAR_YIELD_DIFFERENT_TENOR" ? 1 : 0);
  return universe
    .filter((r) => !excludeCodes.has(r.instrumentCode) && isEligible(r) && r.ytmPct! >= lo && r.ytmPct! <= hi)
    .sort((a, b) => tier(a) - tier(b) || Number(a.freshness !== "CURRENT") - Number(b.freshness !== "CURRENT") || b.ytmPct! - a.ytmPct! || tieBreak(a, b));
}
