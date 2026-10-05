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

export interface Unvalued {
  available: false;
  code: UnvaluedCode;
  reason: string;
}
