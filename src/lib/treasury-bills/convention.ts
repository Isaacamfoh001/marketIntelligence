// ---------------------------------------------------------------------------
// Ghana Treasury-bill pricing convention (M8.5). Pure — no I/O.
//
// A Treasury bill is a DISCOUNT instrument with ONE payment: face value at
// maturity. It is NOT valued with the M7 ZERO_COUPON routine, because that
// routine annualises a yield by COMPOUNDING ((1+y)^(−d/365)) whereas BoG's
// published bill rates are SIMPLE-interest, Actual/365 quantities. Verified
// against every stored BoG auction row (see treasury-bills.integration test +
// treasury-rate-convention.ts): price = Face / (1 + r × d/365) reproduces the
// published discount-rate/interest-rate pairs to within 0.015 points of face,
// whereas compounding is off by up to 0.7 points of face at 91 and 182 days.
//
// RATE USED: BoG's "interest rate" (the return on the price actually paid —
// the same field the Overview and Fixed Income curve already use), in PERCENT
// (9.8339 means 9.8339%).
//
//   priceFactor      = 1 / (1 + r × d/365)                 (value per 1 of face)
//   referenceValue   = face × priceFactor
//   modifiedDuration = t / (1 + r·t),            t = d/365 (years)
//   DV01 (GHS/bp)    = face × t / (1 + r·t)² × 0.0001      (positive magnitude)
//
// Provenance of the convention: INFERRED from the published data, not from a
// BoG definition — the BoG page defines neither rate nor day count. See
// BILL_CONVENTION_EVIDENCE.
// ---------------------------------------------------------------------------

export const BILL_DAY_COUNT_BASIS = 365;
/** Tenors BoG auctions and Korbly stores (TreasuryInstrument.tenorDays). */
export const BILL_TENORS = [91, 182, 364] as const;
export type BillTenorDays = (typeof BILL_TENORS)[number];

export const BILL_CONVENTION_LABEL = "Simple interest, Actual/365";

export const BILL_CONVENTION_EVIDENCE =
  "Bank of Ghana does not publish a definition on its Treasury-bill rates page. Korbly infers the convention from the published numbers: price = face ÷ (1 + rate × days ÷ 365) reproduces every stored BoG discount-rate / interest-rate pair to within 0.015 points of face value.";

export const BILL_FORMULA = "Reference value = face value ÷ (1 + rate × days remaining ÷ 365)";

const yearsOf = (days: number) => days / BILL_DAY_COUNT_BASIS;

/** Value per 1 of face. Undefined (null) when the denominator is not positive. */
export function billPriceFactor(ratePct: number, days: number): number | null {
  const denom = 1 + (ratePct / 100) * yearsOf(days);
  return denom > 0 && Number.isFinite(denom) ? 1 / denom : null;
}

/** Price per 100 of face. */
export function billPricePer100(ratePct: number, days: number): number | null {
  const f = billPriceFactor(ratePct, days);
  return f === null ? null : 100 * f;
}

/** The rate (percent) that makes the bill worth `price` per 100 of face — inverse of billPricePer100. */
export function billRateFromPricePer100(pricePer100: number, days: number): number | null {
  if (!(pricePer100 > 0) || !(days > 0)) return null;
  return ((100 / pricePer100 - 1) / yearsOf(days)) * 100;
}

export function billModifiedDurationYears(ratePct: number, days: number): number | null {
  const t = yearsOf(days);
  const denom = 1 + (ratePct / 100) * t;
  return denom > 0 ? t / denom : null;
}

/** Analytic DV01 per 1 of face for a +1bp rise in the rate (positive magnitude). */
export function billDv01PerUnitFace(ratePct: number, days: number): number | null {
  const t = yearsOf(days);
  const denom = 1 + (ratePct / 100) * t;
  return denom > 0 ? (t / (denom * denom)) * 0.0001 : null;
}

/** BoG discount rate (% of FACE) → interest-rate equivalent (% of price paid). Same relation as treasury-rate-convention.ts. */
export function billInterestRateFromDiscount(discountRatePct: number, days: number): number | null {
  const denom = 1 - (discountRatePct / 100) * yearsOf(days);
  return denom > 0 ? (discountRatePct / 100 / denom) * 100 : null;
}
