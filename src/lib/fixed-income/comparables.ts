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
  tenorDays: number;
  ytmPct: number | null;
  currentYieldPct: number | null;
  modifiedDurationYears: number | null;
  dv01: number | null;
  spreadBps: number | null;
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
export function findComparables(target: ComparableRow, universe: ComparableRow[], filter: ComparableFilter): ComparableRow[] {
  const withYtm = universe.filter((r) => r.ytmPct !== null);
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
