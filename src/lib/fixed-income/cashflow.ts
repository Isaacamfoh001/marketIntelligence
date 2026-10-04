// ---------------------------------------------------------------------------
// Deterministic cash-flow engine for conventional fixed-rate coupon bonds
// (M7 §8). Coupon dates are anchored to the maturity date and stepped
// backward in calendar months — the same convention real bond coupon
// schedules use (a bond maturing on the 15th pays on the 15th every period,
// not on a day-count-derived date) — so a schedule generated here always
// lands on the instrument's real payment dates, not an approximation.
//
// Pure, no I/O: every date/number comes from the caller (already converted
// out of Prisma Decimal), so this is independently unit-testable and never
// touches the database (CLAUDE.md §19).
// ---------------------------------------------------------------------------

import { paymentsPerYear } from "./classification";
import { unavailable, type BondTerms, type CashFlowSchedule, type Result } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Shifts a UTC calendar date by `deltaMonths` (may be negative), clamping
 * the day-of-month to the target month's last day when it would otherwise
 * overflow (e.g. 31 Jan − 1 month → 28/29 Feb, not an invalid date rolling
 * into March). This is the standard "end-of-month" bond-schedule rule.
 */
export function shiftMonths(date: Date, deltaMonths: number): Date {
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12;
  const clampedDay = Math.min(date.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Every coupon payment date across the bond's full life, ascending, anchored to maturity. The last element is always exactly `maturityDate`. */
export function fullCouponSchedule(issueDate: Date, maturityDate: Date, frequency: number): Date[] {
  const monthsPerPeriod = 12 / frequency;
  const dates: Date[] = [];
  let cursor = new Date(maturityDate);
  while (cursor.getTime() > issueDate.getTime()) {
    dates.push(cursor);
    cursor = shiftMonths(cursor, -monthsPerPeriod);
  }
  return dates.reverse();
}

export interface PeriodBoundary {
  previousCouponDate: Date;
  nextCouponDate: Date;
  /** Actual calendar days in the current coupon period. */
  periodDays: number;
  /** Actual calendar days from settlement to the next coupon. */
  daysToNextCoupon: number;
  /** Actual calendar days accrued since the previous coupon (periodDays - daysToNextCoupon). */
  daysAccrued: number;
}

/** Locates settlementDate within the full coupon schedule — needed for accrued interest and the fractional first discount period in YTM/duration. */
export function periodBoundary(fullSchedule: Date[], issueDate: Date, settlementDate: Date): PeriodBoundary {
  let previousCouponDate = issueDate;
  let nextCouponDate: Date | null = null;
  for (const d of fullSchedule) {
    if (d.getTime() <= settlementDate.getTime()) {
      previousCouponDate = d;
    } else {
      nextCouponDate = d;
      break;
    }
  }
  if (!nextCouponDate) throw new Error("periodBoundary called with no remaining coupon dates (bond has matured)");
  const periodDays = daysBetween(previousCouponDate, nextCouponDate);
  const daysToNextCoupon = daysBetween(settlementDate, nextCouponDate);
  return { previousCouponDate, nextCouponDate, periodDays, daysToNextCoupon, daysAccrued: periodDays - daysToNextCoupon };
}

/**
 * Generates the remaining contractual cash flows for a FIXED-coupon bond as
 * of `settlementDate`. Returns MATURED when the bond's maturity is on or
 * before settlement, and FLOATING_RATE_UNSUPPORTED for a floating coupon
 * (no deterministic future reset path exists to schedule — M7 §8/§21).
 */
export function generateCashFlows(terms: BondTerms, settlementDate: Date): Result<CashFlowSchedule> {
  if (terms.maturityDate.getTime() <= settlementDate.getTime()) {
    return unavailable("MATURED", "This security's maturity date has passed — it has no remaining cash flows.");
  }
  if (terms.couponType === "FLOATING") {
    return unavailable("FLOATING_RATE_UNSUPPORTED", "Floating-rate coupons have no deterministic future reset path — a cash-flow schedule cannot be projected.");
  }

  if (terms.couponType === "ZERO_COUPON") {
    return {
      ok: true,
      settlementDate,
      paymentsPerYear: 0,
      flows: [{ date: terms.maturityDate, coupon: 0, principal: terms.faceValue, total: terms.faceValue }],
    };
  }

  // FIXED
  if (terms.couponRatePct === null || terms.couponFrequency === null) {
    return unavailable("MISSING_MARKET_DATA", "This fixed-rate instrument is missing its coupon rate or frequency.");
  }
  const freq = paymentsPerYear(terms.couponFrequency);
  const fullSchedule = fullCouponSchedule(terms.issueDate, terms.maturityDate, freq);
  const remaining = fullSchedule.filter((d) => d.getTime() > settlementDate.getTime());
  const couponPerPeriod = (terms.faceValue * (terms.couponRatePct / 100)) / freq;

  const flows = remaining.map((date, i) => {
    const isFinal = i === remaining.length - 1;
    const principal = isFinal ? terms.faceValue : 0;
    return { date, coupon: couponPerPeriod, principal, total: couponPerPeriod + principal };
  });

  return { ok: true, settlementDate, paymentsPerYear: freq, flows };
}
