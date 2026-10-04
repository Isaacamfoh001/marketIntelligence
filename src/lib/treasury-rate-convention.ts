// ---------------------------------------------------------------------------
// Bank of Ghana Treasury-bill rate conventions (M7.1 §9) — documents and
// verifies what `discountRate` and `interestRate` on TreasuryRate actually
// mean, and which one is the correct comparator for a coupon bond's YTM.
//
// BoG publishes Treasury bills as discount instruments. Two rates are
// published together for every auction:
//
//   discountRate  — the annualized discount off FACE value (Actual/365),
//                   the rate the auction itself clears on: the issue
//                   price is Face x (1 - discountRate x days/365).
//   interestRate  — ("interest rate equivalent" / "true yield") the
//                   annualized return on the amount actually INVESTED
//                   (the price paid), satisfying
//                   Price x (1 + interestRate x days/365) = Face.
//
// Because discountRate is a percentage of face value and interestRate is a
// percentage of the (smaller) price paid, interestRate is always the
// larger of the two — and critically, interestRate is the measure that
// answers "what annualized return do I actually earn on my money", which
// is exactly what a coupon bond's YTM also answers. discountRate is NOT
// directly comparable to YTM (different denominator). This is why the
// platform already used `interestRate` for the Overview headline, the
// Macro & Rates page, and the Fixed Income sovereign yield curve/spread —
// verified correct below, not changed.
//
// Verified against real published BoG auction data (M7.1 research,
// 2026-10-04): 91-day auction on 28 Sep 2026 published discountRate
// 4.6244 / interestRate 4.6785 — this module's formula reproduces
// 4.6785 to within 0.001 percentage points. See
// src/lib/__tests__/treasury-rate-convention.test.ts, including a check
// against live TreasuryRate rows already in the database.
// ---------------------------------------------------------------------------

const DAYS_PER_YEAR = 365;

/**
 * Converts a face-value discount rate (percentage points, e.g. 4.6244
 * meaning 4.6244%) into the equivalent annualized return on the price
 * actually paid ("interest rate equivalent" / true yield), for a given
 * tenor in days. This is the BoG money-market discount-to-yield
 * conversion, not a Korbly invention — it is the standard relationship
 * between a face-value discount and a price-based yield for any
 * zero-coupon discount instrument.
 */
export function interestRateFromDiscountRate(discountRatePct: number, tenorDays: number): number {
  const d = discountRatePct / 100;
  const denominator = 1 - d * (tenorDays / DAYS_PER_YEAR);
  return (d / denominator) * 100;
}

/**
 * The reverse conversion — recovers the discount rate implied by a given
 * interest-rate-equivalent, for symmetry/testing.
 */
export function discountRateFromInterestRate(interestRatePct: number, tenorDays: number): number {
  const r = interestRatePct / 100;
  const denominator = 1 + r * (tenorDays / DAYS_PER_YEAR);
  return (r / denominator) * 100;
}
