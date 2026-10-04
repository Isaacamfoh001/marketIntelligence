// ---------------------------------------------------------------------------
// Accrued interest and clean/dirty price conversion (M7 §5/§15).
//
// Accrued interest is always derived from the bond's own coupon terms —
// never stored (CLAUDE.md §1: a value that is "obviously deterministically
// calculable" must not be persisted as though it were an independent fact).
// Actual/actual day-count within the current coupon period: the fraction of
// the period elapsed, times that period's coupon amount.
// ---------------------------------------------------------------------------

import { paymentsPerYear } from "./classification";
import { fullCouponSchedule, periodBoundary } from "./cashflow";
import { unavailable, type BondTerms, type Result } from "./types";

export interface AccruedInterestResult {
  accruedInterest: number;
  daysAccrued: number;
  periodDays: number;
}

export function computeAccruedInterest(terms: BondTerms, settlementDate: Date): Result<AccruedInterestResult> {
  if (terms.maturityDate.getTime() <= settlementDate.getTime()) {
    return unavailable("MATURED", "This security's maturity date has passed.");
  }
  if (terms.couponType === "ZERO_COUPON") {
    return { ok: true, accruedInterest: 0, daysAccrued: 0, periodDays: 0 };
  }
  if (terms.couponType === "FLOATING") {
    return unavailable("FLOATING_RATE_UNSUPPORTED", "Accrued interest is not computed for floating-rate instruments.");
  }
  if (terms.couponRatePct === null || terms.couponFrequency === null) {
    return unavailable("MISSING_MARKET_DATA", "This fixed-rate instrument is missing its coupon rate or frequency.");
  }

  const freq = paymentsPerYear(terms.couponFrequency);
  const fullSchedule = fullCouponSchedule(terms.issueDate, terms.maturityDate, freq);
  const boundary = periodBoundary(fullSchedule, terms.issueDate, settlementDate);
  const couponPerPeriod = (terms.faceValue * (terms.couponRatePct / 100)) / freq;
  const accruedInterest = boundary.periodDays === 0 ? 0 : couponPerPeriod * (boundary.daysAccrued / boundary.periodDays);

  return { ok: true, accruedInterest, daysAccrued: boundary.daysAccrued, periodDays: boundary.periodDays };
}

/** Dirty (invoice) price = clean price + accrued interest, both per the same face-value convention (typically per 100 face value). */
export function cleanToDirty(cleanPrice: number, accruedInterest: number): number {
  return cleanPrice + accruedInterest;
}

export function dirtyToClean(dirtyPrice: number, accruedInterest: number): number {
  return dirtyPrice - accruedInterest;
}
