// ---------------------------------------------------------------------------
// Portfolio domain types (M8.1). Pure — no I/O, no Prisma — so every rule here
// is deterministic and unit-testable independent of the UI and the database
// (CLAUDE.md §19). Mirrors src/lib/fixed-income/types.ts's convention of plain
// numbers/ISO strings rather than Prisma shapes.
//
// What is recorded: ONLY what the analyst holds — nominal GHS for a bond,
// whole shares for an equity. There is no generic "quantity", no cost basis,
// no lots, no short/negative size, no non-GHS instrument.
//
// What a "Reference value" is: a transparent, dated, quality-labelled estimate
// of what a position is worth at the valuation date from the most recent
// reliable observed market input. It is NOT a market value, NAV or tradable
// price, and every position states exactly which input it rests on.
// ---------------------------------------------------------------------------

export type PortfolioAssetClass = "BOND" | "EQUITY" | "TREASURY_BILL";

/**
 * Whether the observed input behind a valuation is recent or stale at the
 * valuation date. "Stale" inputs still value the position — they are labelled,
 * never silently treated as current (CLAUDE.md §11).
 */
export type InputRecency = "RECENT" | "STALE";

/**
 * What KIND of value a position is being carried at (M9.0.1). Distinct from
 * data quality (how recent the evidence is): a recent analyst assumption is still
 * an assumption, and a stale observed yield is still a Reference value.
 *
 *   REFERENCE           Korbly-supported value built from accepted observed evidence (bond yield, GSE trade).
 *   INDICATIVE          Korbly model-derived value where the method is defensible but there is no instrument-level quote
 *                       (a Treasury bill valued from the interpolated BoG auction curve).
 *   ANALYST_ASSUMPTION  value that rests on an explicit analyst-supplied assumption — never an observation.
 *   (UNVALUED           no value; that is `status: "UNVALUED"`, not a basis.)
 *
 * Hierarchy, strongest first: REFERENCE > INDICATIVE > ANALYST_ASSUMPTION > unvalued.
 */
export type ValuationBasis = "REFERENCE" | "INDICATIVE" | "ANALYST_ASSUMPTION";
export const VALUATION_BASIS_ORDER: ValuationBasis[] = ["REFERENCE", "INDICATIVE", "ANALYST_ASSUMPTION"];

/** Recency of the evidence behind a value. An analyst assumption has no observation, so it is NOT_APPLICABLE — never "recent". */
export type ValuationRecency = InputRecency | "NOT_APPLICABLE";

/**
 * What the analyst may assume, by asset class. Each maps onto an EXISTING engine:
 *   BOND          YIELD_PCT (→ M7 priceFromYield) | PRICE_PER_100 (clean price → M7 computeYtm) | PAR (explicit clean price = face)
 *   TREASURY_BILL RATE_PCT (→ M8.5 bill formula) | PRICE_PER_100
 *   EQUITY        SHARE_PRICE_GHS
 * Percent values are entered and stored as percent (28 = 28%).
 */
export type AssumptionKind = "YIELD_PCT" | "RATE_PCT" | "PRICE_PER_100" | "PAR" | "SHARE_PRICE_GHS";

/** An assumption as stored for a position. */
export interface StoredAssumption {
  kind: AssumptionKind;
  /** null only for PAR. */
  value: number | null;
  overridesReference: boolean;
}

/** An assumption that was applied to a value, with everything needed to trace it. */
export interface AppliedAssumption extends StoredAssumption {
  /** There is no analyst identity yet; provenance is stated, not invented. */
  provenance: "Analyst assumption";
  /** What was assumed, in the analyst's terms: "28.00% yield". */
  summary: string;
  /** How the starting value follows from it, in one sentence. */
  method: string;
  /** The calculation, step by step, for the expert. */
  calculation: string[];
}

/** Bond: M7's weekly tolerance (observationFreshness("WEEKLY")) — kept in sync by a test. */
export const BOND_RECENT_WINDOW_DAYS = 10;
/** Treasury bill: BoG auctions weekly, so the same weekly tolerance as bonds (observationFreshness("WEEKLY")) — kept in sync by a test. */
export const BILL_RECENT_WINDOW_DAYS = 10;
/** Equity: an input observed within this many calendar days of the valuation date is recent (M8 decision 3). */
export const EQUITY_RECENT_WINDOW_DAYS = 7;

/** A recorded holding, as the analyst entered it. */
export type PositionHolding =
  | { assetClass: "BOND"; positionId: string; fixedIncomeSecurityId: string; nominalGhs: number }
  | { assetClass: "EQUITY"; positionId: string; securityId: string; shares: number }
  /** `faceValueGhs` is the amount the government pays at maturity — NOT what was paid, NOT today's value. */
  | { assetClass: "TREASURY_BILL"; positionId: string; treasuryBillId: string; faceValueGhs: number };

/** Which instrument a (candidate) position refers to — the key of the one-position-per-instrument rule. */
export type InstrumentRef = { assetClass: "BOND"; fixedIncomeSecurityId: string } | { assetClass: "EQUITY"; securityId: string } | { assetClass: "TREASURY_BILL"; treasuryBillId: string };

/** Why a position cannot be given a reference value. Always paired with a human reason — never a silent zero. */
export type UnvaluedCode =
  | "NOT_GHS"
  | "MATURED"
  | "FLOATING_RATE"
  | "NOT_OUTSTANDING"
  | "TERMS_UNSUPPORTED"
  | "TERMS_CONFLICT"
  | "NO_OBSERVATION"
  | "NO_REFERENCE_RATE"
  | "NO_TRADE"
  | "UNDER_REVIEW"
  | "OBSERVATION_EXCLUDED"
  | "INACTIVE"
  | "NO_PRICE"
  | "CALCULATION_FAILED";

/**
 * Why a position has no Reference value, and whether an analyst assumption could
 * responsibly stand in. Contractual problems stay unvalued — Korbly never
 * manufactures missing instrument terms:
 *   NOT ASSUMABLE  NOT_GHS, MATURED, FLOATING_RATE, NOT_OUTSTANDING, TERMS_UNSUPPORTED, TERMS_CONFLICT, INACTIVE
 *   ASSUMABLE      NO_OBSERVATION, NO_REFERENCE_RATE, NO_TRADE, UNDER_REVIEW, OBSERVATION_EXCLUDED, NO_PRICE, CALCULATION_FAILED
 * (the assumable ones lack MARKET EVIDENCE, not contractual terms).
 */
export interface Unvalued {
  available: false;
  code: UnvaluedCode;
  reason: string;
}
