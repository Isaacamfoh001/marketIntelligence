// ---------------------------------------------------------------------------
// Present-value pricing given a yield — the core primitive the YTM solver,
// duration, and DV01 all reuse (M7 §9/§10). Returns the DIRTY (full,
// invoice) price: the standard bond-math convention of discounting each
// remaining cash flow back to settlement, generalized from the classic
// "semiannual bond basis" formula (as used by Excel's PRICE/YIELD
// functions) to any supported coupon frequency.
//
// For a cash flow i periods away (i = 0, 1, 2, ... for the 1st, 2nd, 3rd
// remaining coupon), the discount exponent is (i + w), where w is the
// fraction of the CURRENT coupon period still remaining until the next
// coupon (w = daysToNextCoupon / periodDays). This single formula prices
// the fractional first (stub) period correctly without a separate accrued-
// interest add-on — the result already IS the dirty price at settlement.
// ---------------------------------------------------------------------------

import { paymentsPerYear } from "./classification";
import { fullCouponSchedule, periodBoundary, daysBetween } from "./cashflow";
import { unavailable, type BondTerms, type Result } from "./types";

const DAYS_PER_YEAR = 365;

interface PricingPoint {
  /** Discount exponent — periods from settlement, including the fractional stub. */
  exponent: number;
  cashFlow: number;
}

/** Builds the (exponent, cashFlow) pairs once so the YTM solver, duration, and DV01 don't each re-derive the schedule/period-boundary per iteration. */
export function buildPricingPoints(terms: BondTerms, settlementDate: Date): Result<{ points: PricingPoint[]; freq: number }> {
  if (terms.maturityDate.getTime() <= settlementDate.getTime()) {
    return unavailable("MATURED", "This security's maturity date has passed — it has no remaining cash flows.");
  }
  if (terms.couponType === "FLOATING") {
    return unavailable("FLOATING_RATE_UNSUPPORTED", "Pricing is not computed for floating-rate instruments — the future reset path is unknown.");
  }

  if (terms.couponType === "ZERO_COUPON") {
    const years = daysBetween(settlementDate, terms.maturityDate) / DAYS_PER_YEAR;
    return { ok: true, freq: 1, points: [{ exponent: years, cashFlow: terms.faceValue }] };
  }

  if (terms.couponRatePct === null || terms.couponFrequency === null) {
    return unavailable("MISSING_MARKET_DATA", "This fixed-rate instrument is missing its coupon rate or frequency.");
  }

  const freq = paymentsPerYear(terms.couponFrequency);
  const fullSchedule = fullCouponSchedule(terms.issueDate, terms.maturityDate, freq);
  const remaining = fullSchedule.filter((d) => d.getTime() > settlementDate.getTime());
  const boundary = periodBoundary(fullSchedule, terms.issueDate, settlementDate);
  const w = boundary.periodDays === 0 ? 0 : boundary.daysToNextCoupon / boundary.periodDays;
  const couponPerPeriod = (terms.faceValue * (terms.couponRatePct / 100)) / freq;

  const points: PricingPoint[] = remaining.map((_, i) => {
    const isFinal = i === remaining.length - 1;
    return { exponent: i + w, cashFlow: couponPerPeriod + (isFinal ? terms.faceValue : 0) };
  });

  return { ok: true, freq, points };
}

/** Dirty price for a given flat annual yield (percent, e.g. 19.5 for 19.5%). */
export function priceFromPoints(points: PricingPoint[], freq: number, annualYieldPct: number): number {
  const periodRate = annualYieldPct / 100 / freq;
  return points.reduce((sum, p) => sum + p.cashFlow / Math.pow(1 + periodRate, p.exponent), 0);
}

/** Convenience wrapper combining buildPricingPoints + priceFromPoints for callers that just want a dirty price at a given yield. */
export function priceFromYield(terms: BondTerms, settlementDate: Date, annualYieldPct: number): Result<{ dirtyPrice: number }> {
  const built = buildPricingPoints(terms, settlementDate);
  if (!built.ok) return built;
  return { ok: true, dirtyPrice: priceFromPoints(built.points, built.freq, annualYieldPct) };
}
