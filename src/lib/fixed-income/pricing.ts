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
//
// FINAL COUPON PERIOD (M7.3 §26): when a fixed-coupon bond has exactly one
// remaining cash flow (coupon + principal), it is discounted with SIMPLE
// interest — P = CF / (1 + y·t), t = DSR / (E × freq) years — the market
// "street" convention used by ICMA, Bloomberg and Excel's PRICE/YIELD for
// bonds in their last period. Compounding a fractional period of a few days
// to an annual rate produces meaningless extremes (and cannot represent a
// large loss at all), which is exactly the near-maturity premium case the
// purchase-price scenarios must show honestly. `simpleFinalPeriod` flags
// this so yield/duration stay on the same convention.
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
export interface PricingModel {
  points: PricingPoint[];
  freq: number;
  /** True when a FIXED-coupon bond is in its final coupon period (one remaining cash flow) and is priced with simple interest — see module header. */
  simpleFinalPeriod: boolean;
}

export function buildPricingPoints(terms: BondTerms, settlementDate: Date): Result<PricingModel> {
  if (terms.maturityDate.getTime() <= settlementDate.getTime()) {
    return unavailable("MATURED", "This security's maturity date has passed — it has no remaining cash flows.");
  }
  if (terms.couponType === "FLOATING") {
    return unavailable("FLOATING_RATE_UNSUPPORTED", "Pricing is not computed for floating-rate instruments — the future reset path is unknown.");
  }

  if (terms.couponType === "ZERO_COUPON") {
    const years = daysBetween(settlementDate, terms.maturityDate) / DAYS_PER_YEAR;
    return { ok: true, freq: 1, simpleFinalPeriod: false, points: [{ exponent: years, cashFlow: terms.faceValue }] };
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

  return { ok: true, freq, points, simpleFinalPeriod: points.length === 1 };
}

/** Dirty price for a given flat annual yield (percent, e.g. 19.5 for 19.5%). */
export function priceFromPoints(points: PricingPoint[], freq: number, annualYieldPct: number, simpleFinalPeriod = false): number {
  if (simpleFinalPeriod && points.length === 1) {
    const years = points[0].exponent / freq;
    return points[0].cashFlow / (1 + (annualYieldPct / 100) * years);
  }
  const periodRate = annualYieldPct / 100 / freq;
  return points.reduce((sum, p) => sum + p.cashFlow / Math.pow(1 + periodRate, p.exponent), 0);
}

/** Convenience wrapper combining buildPricingPoints + priceFromPoints for callers that just want a dirty price at a given yield. */
export function priceFromYield(terms: BondTerms, settlementDate: Date, annualYieldPct: number): Result<{ dirtyPrice: number }> {
  const built = buildPricingPoints(terms, settlementDate);
  if (!built.ok) return built;
  return { ok: true, dirtyPrice: priceFromPoints(built.points, built.freq, annualYieldPct, built.simpleFinalPeriod) };
}
