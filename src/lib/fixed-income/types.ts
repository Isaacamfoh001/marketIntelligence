// ---------------------------------------------------------------------------
// Shared types for the fixed-income analytics engine (M7).
//
// Deliberately decoupled from Prisma's generated model shape: callers pass
// plain numbers/Dates (already `Number()`-converted from Decimal), so these
// pure functions have no I/O and can be unit-tested without a database
// (CLAUDE.md §19: "financial calculations must live in reusable
// domain/service functions... never buried inside React components").
// ---------------------------------------------------------------------------

export type CouponFrequency = "ANNUAL" | "SEMI_ANNUAL" | "QUARTERLY" | "MONTHLY";
export type CouponType = "FIXED" | "FLOATING" | "ZERO_COUPON";
export type FixedIncomeInstrumentType = "GOVERNMENT_BOND" | "CORPORATE_BOND";
export type FixedIncomeClassification = "SOVEREIGN" | "CORPORATE";

/** Contractual terms needed by the cash-flow/yield/duration engine — a subset of FixedIncomeSecurity's fields. */
export interface BondTerms {
  issueDate: Date;
  maturityDate: Date;
  couponType: CouponType;
  /** Annual coupon rate in percentage points (e.g. 19.5 means 19.5%/year). Null only for ZERO_COUPON. */
  couponRatePct: number | null;
  couponFrequency: CouponFrequency | null;
  /** Par/face value the coupon percentage and redemption are computed against (GHS 100 is the market convention this product uses). */
  faceValue: number;
}

export interface CashFlow {
  date: Date;
  /** Coupon portion of this cash flow (0 for a pure principal-only flow, which cannot happen for a conventional bond but kept explicit for clarity). */
  coupon: number;
  /** Principal/redemption portion — non-zero only on the final cash flow. */
  principal: number;
  /** coupon + principal. */
  total: number;
}

export interface CashFlowSchedule {
  settlementDate: Date;
  flows: CashFlow[];
  /** Payments per year implied by couponFrequency (0 for ZERO_COUPON — a single bullet repayment, not a "0 payments/year" coupon). */
  paymentsPerYear: number;
}

/** Why a cash-flow/yield/duration calculation could not be produced — shown to the user instead of a silently wrong number (CLAUDE.md §26). */
export type FixedIncomeUnavailableReason =
  | "MATURED"
  | "FLOATING_RATE_UNSUPPORTED"
  | "INVALID_PRICE"
  | "MISSING_MARKET_DATA"
  | "NON_CONVERGENT";

export interface Unavailable {
  ok: false;
  reason: FixedIncomeUnavailableReason;
  message: string;
}

export type Result<T> = ({ ok: true } & T) | Unavailable;

export function unavailable(reason: FixedIncomeUnavailableReason, message: string): Unavailable {
  return { ok: false, reason, message };
}
