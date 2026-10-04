// ---------------------------------------------------------------------------
// "Find Alternatives" — deterministic comparable-security ranking (M7 §14).
//
// Deliberately no invented composite score: every filter sorts by one real,
// already-displayed metric (YTM difference, maturity difference, or raw
// YTM) rather than blending factors into an opaque number (M7 §14: "It is
// preferable to transparently show Security A / YTM X / Maturity X ...
// than to produce an unexplained score of 87/100").
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
  // Matured instruments are never investable alternatives, whatever yield they last printed.
  let withYtm = universe.filter((r) => r.ytmPct !== null && r.tenorDays > 0);
  if (options.recentOnly) withYtm = withYtm.filter((r) => r.freshness === "CURRENT");
  if (target.ytmPct === null) return [];

  let candidates = withYtm;
  if (filter === "GOVERNMENT_ONLY") candidates = candidates.filter((r) => r.classification === "SOVEREIGN");
  if (filter === "CORPORATE_ONLY") candidates = candidates.filter((r) => r.classification === "CORPORATE");
  if (filter === "HIGHER_YIELD") candidates = candidates.filter((r) => r.ytmPct! > target.ytmPct!);

  if (filter === "SIMILAR_MATURITY") {
    return [...candidates].sort((a, b) => Math.abs(a.tenorDays - target.tenorDays) - Math.abs(b.tenorDays - target.tenorDays));
  }
  if (filter === "HIGHER_YIELD") {
    return [...candidates].sort((a, b) => a.ytmPct! - b.ytmPct!);
  }
  // SIMILAR_RETURN, GOVERNMENT_ONLY, CORPORATE_ONLY all default to closest-YTM ordering.
  return [...candidates].sort((a, b) => Math.abs(a.ytmPct! - target.ytmPct!) - Math.abs(b.ytmPct! - target.ytmPct!));
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
 * similar returns elsewhere in the market?". Sorted by YTM descending
 * (a factual ordering, not a ranking of merit). Excludes matured rows, rows
 * without a YTM, and `excludeCodes` (the securities being compared).
 */
export function findInYieldRange(universe: ComparableRow[], lowPct: number, highPct: number, excludeCodes: ReadonlySet<string>, bandBps = SIMILAR_RETURN_BAND_BPS): ComparableRow[] {
  const lo = Math.min(lowPct, highPct) - bandBps / 100;
  const hi = Math.max(lowPct, highPct) + bandBps / 100;
  return universe
    .filter((r) => !excludeCodes.has(r.instrumentCode) && r.tenorDays > 0 && r.ytmPct !== null && r.ytmPct >= lo && r.ytmPct <= hi)
    .sort((a, b) => b.ytmPct! - a.ytmPct!);
}
