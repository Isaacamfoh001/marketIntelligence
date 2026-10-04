// ---------------------------------------------------------------------------
// Purchase-price sensitivity (M7.3 §9–§12/§26).
//
// "How does my annualized hold-to-maturity return change with the price I
// pay?" — answered with the SAME engine the rest of Fixed Income uses:
//
//   hypothetical clean price
//   + accrued interest at the valuation date      (accrued.ts)
//   = settlement consideration
//   + purchase charges                            (transaction-costs.ts)
//   = total acquisition cost per 100 face
//   → solve the flat annual yield that discounts the remaining contractual
//     cash flows back to that cost              (yield.ts computeYtm)
//
// Never coupon ÷ price. The annualization convention is the engine's own:
// a nominal annual rate compounded at the coupon frequency (bond-equivalent
// for semi-annual bonds), with the fractional first period priced exactly.
//
// Every scenario price is HYPOTHETICAL — callers must label it so (§30).
// ---------------------------------------------------------------------------

import { computeAccruedInterest } from "./accrued";
import { generateCashFlows } from "./cashflow";
import { computeYtm } from "./yield";
import { buildPricingPoints } from "./pricing";
import { chargesMultiplier, computeAcquisitionCost, validateCharges, type TransactionCharges } from "./transaction-costs";
import { unavailable, type BondTerms, type Result } from "./types";

/** The CFO workflow's standard scenario prices (M7.3 §9) — always easy to evaluate, never the only prices supported. */
export const DEFAULT_SCENARIO_PRICES = [100, 105, 110] as const;

/** Rows of the per-security sensitivity table: a band around par that always contains the default 100/105/110. */
export const SENSITIVITY_TABLE_PRICES = [95, 100, 105, 110, 115] as const;

export interface PriceScenario {
  /** Hypothetical clean purchase price, per 100 face. */
  cleanPrice: number;
  accruedInterest: number;
  /** Clean + accrued, per 100 face. */
  dirtyPrice: number;
  regulatoryLevy: number;
  dealerFee: number;
  /** Total acquisition cost per 100 face (dirty + charges). */
  allInCost: number;
  /** Yield to maturity at the dirty price, BEFORE charges. Null when the solver has no root (cannot happen for positive prices of a conventional bond, but never assumed). */
  ytmPct: number | null;
  /** Annualized hold-to-maturity return on the all-in cost — gross of tax, after the given charges. */
  returnPct: number | null;
  /**
   * returnPct restated as an effective annual rate (annual compounding — the
   * basis of a spreadsheet XIRR). Same cash flows, different annualization
   * convention; shown so the engine's bond-equivalent figure can be
   * reconciled with XIRR-based analyses.
   */
  effectiveAnnualReturnPct: number | null;
  /** Undiscounted remaining cash (coupons + principal) per 100 face. */
  remainingCashPer100: number;
  /** remainingCashPer100 − allInCost. Negative means less cash back than paid, before time value. */
  nominalProfitPer100: number;
}

function sumRemainingCash(terms: BondTerms, settlementDate: Date): Result<{ total: number }> {
  const schedule = generateCashFlows(terms, settlementDate);
  if (!schedule.ok) return schedule;
  return { ok: true, total: schedule.flows.reduce((s, f) => s + f.total, 0) };
}

/**
 * Converts a yield from the engine's convention (pricing.ts: nominal annual
 * rate compounded at the coupon frequency, or simple interest in the final
 * coupon period) to an effective annual rate. Null when the conversion is
 * undefined (a total loss of value).
 */
export function toEffectiveAnnualPct(terms: BondTerms, settlementDate: Date, yieldPct: number): number | null {
  const model = buildPricingPoints(terms, settlementDate);
  if (!model.ok) return null;
  const y = yieldPct / 100;
  if (model.simpleFinalPeriod) {
    const t = model.points[0].exponent / model.freq;
    const growth = 1 + y * t;
    return growth > 0 && t > 0 ? (Math.pow(growth, 1 / t) - 1) * 100 : null;
  }
  const periodic = 1 + y / model.freq;
  return periodic > 0 ? (Math.pow(periodic, model.freq) - 1) * 100 : null;
}

/** One hypothetical purchase price → full cost breakdown and annualized hold-to-maturity return. */
export function computePriceScenario(terms: BondTerms, settlementDate: Date, cleanPrice: number, charges: TransactionCharges): Result<PriceScenario> {
  if (!(cleanPrice > 0) || !Number.isFinite(cleanPrice)) return unavailable("INVALID_PRICE", "A positive purchase price is required.");
  const chargeError = validateCharges(charges);
  if (chargeError) return unavailable("INVALID_PRICE", chargeError);

  const accrued = computeAccruedInterest(terms, settlementDate);
  if (!accrued.ok) return accrued;
  const cash = sumRemainingCash(terms, settlementDate);
  if (!cash.ok) return cash;

  const cost = computeAcquisitionCost(cleanPrice, accrued.accruedInterest, charges);
  const ytm = computeYtm(terms, settlementDate, cost.settlementConsideration);
  const allIn = computeYtm(terms, settlementDate, cost.totalAcquisitionCost);

  return {
    ok: true,
    cleanPrice,
    accruedInterest: accrued.accruedInterest,
    dirtyPrice: cost.settlementConsideration,
    regulatoryLevy: cost.regulatoryLevy,
    dealerFee: cost.dealerFee,
    allInCost: cost.totalAcquisitionCost,
    ytmPct: ytm.ok ? ytm.ytmPct : null,
    returnPct: allIn.ok ? allIn.ytmPct : null,
    effectiveAnnualReturnPct: allIn.ok ? toEffectiveAnnualPct(terms, settlementDate, allIn.ytmPct) : null,
    remainingCashPer100: cash.total,
    nominalProfitPer100: cash.total - cost.totalAcquisitionCost,
  };
}

export interface PriceSensitivity {
  accruedInterest: number;
  remainingCashPer100: number;
  scenarios: PriceScenario[];
}

/** Evaluates many hypothetical prices at once; prices are de-duplicated and returned ascending. Fails as a whole only when the BOND cannot be analysed (matured, floating, missing terms). */
export function computePriceSensitivity(terms: BondTerms, settlementDate: Date, prices: readonly number[], charges: TransactionCharges): Result<PriceSensitivity> {
  const unique = [...new Set(prices.filter((p) => p > 0 && Number.isFinite(p)).map((p) => Math.round(p * 10000) / 10000))].sort((a, b) => a - b);
  const accrued = computeAccruedInterest(terms, settlementDate);
  if (!accrued.ok) return accrued;
  const cash = sumRemainingCash(terms, settlementDate);
  if (!cash.ok) return cash;
  const chargeError = validateCharges(charges);
  if (chargeError) return unavailable("INVALID_PRICE", chargeError);

  const scenarios: PriceScenario[] = [];
  for (const price of unique) {
    const s = computePriceScenario(terms, settlementDate, price, charges);
    if (s.ok) scenarios.push(s);
  }
  return { ok: true, accruedInterest: accrued.accruedInterest, remainingCashPer100: cash.total, scenarios };
}

/**
 * The clean price at which the undiscounted remaining cash flows exactly
 * repay the all-in acquisition cost — i.e. annualized return = 0%. Paying
 * more than this produces a NEGATIVE hold-to-maturity return. Exact (no
 * solver): at a 0% yield every discount factor is 1, so the break-even all-in
 * cost IS the sum of remaining cash flows.
 */
export function computeBreakEvenCleanPrice(terms: BondTerms, settlementDate: Date, charges: TransactionCharges): Result<{ breakEvenCleanPrice: number }> {
  const chargeError = validateCharges(charges);
  if (chargeError) return unavailable("INVALID_PRICE", chargeError);
  const accrued = computeAccruedInterest(terms, settlementDate);
  if (!accrued.ok) return accrued;
  const cash = sumRemainingCash(terms, settlementDate);
  if (!cash.ok) return cash;
  return { ok: true, breakEvenCleanPrice: cash.total / chargesMultiplier(charges) - accrued.accruedInterest };
}

/**
 * How many basis points of annualized return one extra point of clean
 * price costs, measured between `aroundPrice` and `aroundPrice + 1`. A
 * positive number (return falls as price rises). Large values identify
 * securities whose return is dominated by the price paid — typically
 * because little time remains to amortise any premium (M7.3 §12).
 */
export function returnSensitivityBpsPerPoint(terms: BondTerms, settlementDate: Date, charges: TransactionCharges, aroundPrice = 100): number | null {
  const lo = computePriceScenario(terms, settlementDate, aroundPrice, charges);
  const hi = computePriceScenario(terms, settlementDate, aroundPrice + 1, charges);
  if (!lo.ok || !hi.ok || lo.returnPct === null || hi.returnPct === null) return null;
  return Math.round((lo.returnPct - hi.returnPct) * 100);
}

/** Price grid for the sensitivity chart: covers 90–115 and any observed price ±5, in 0.5 steps. */
export function sensitivityChartPrices(observedCleanPrice: number | null): number[] {
  let lo = 90;
  let hi = 115;
  if (observedCleanPrice !== null && observedCleanPrice > 0) {
    lo = Math.min(lo, Math.floor(observedCleanPrice - 5));
    hi = Math.max(hi, Math.ceil(observedCleanPrice + 5));
  }
  lo = Math.max(lo, 1);
  const prices: number[] = [];
  for (let p = lo; p <= hi + 1e-9; p += 0.5) prices.push(Math.round(p * 2) / 2);
  return prices;
}
