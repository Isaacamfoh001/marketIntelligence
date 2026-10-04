// ---------------------------------------------------------------------------
// Investment / Dealer-Quote Calculator — hold-to-maturity scenario only
// (M7 §15, extended in M7.3 §13 with acquisition costs).
//
// A bond is a linear instrument: buying `faceValueAcquired` nominal of a
// bond whose contractual terms are defined per `terms.faceValue` (the
// market's par-quoting convention, typically 100) scales every cash flow
// by the same factor (faceValueAcquired / terms.faceValue). This lets the
// calculator reuse generateCashFlows/computeYtm exactly as-is rather than
// re-deriving bond cash-flow math a second time for a "scaled" bond.
//
// `investmentAmount` is the TOTAL cash outlay — settlement consideration
// plus purchase charges (transaction-costs.ts). With no charges this is
// identical to the original M7 behaviour (amount buys face at dirty price).
//
// Nothing here presents a result as a guaranteed return — every figure is
// labeled by what it assumes (hold to maturity, at today's known contractual
// terms, gross of tax) per M7 §15/§23 and M7.3 §15/§29.
// ---------------------------------------------------------------------------

import { computeAccruedInterest } from "./accrued";
import { generateCashFlows } from "./cashflow";
import { computeYtm } from "./yield";
import { toEffectiveAnnualPct } from "./price-scenarios";
import { chargesMultiplier, NO_CHARGES, validateCharges, type TransactionCharges } from "./transaction-costs";
import { unavailable, type BondTerms, type CashFlow, type Result } from "./types";

export interface InvestmentEvaluation {
  investmentAmount: number;
  cleanPrice: number;
  /** Accrued interest per `terms.faceValue` (per-100 convention) — see accruedInterestPaid for the position total. */
  accruedInterest: number;
  /** Clean + accrued, per `terms.faceValue`. */
  dirtyPrice: number;
  /** Total nominal/face value of the bond this investment amount buys, after charges. */
  faceValueAcquired: number;
  /** faceValueAcquired × clean price — what the dealer's quoted price alone costs. */
  cleanConsideration: number;
  /** Accrued interest paid to the seller for this position. */
  accruedInterestPaid: number;
  /** cleanConsideration + accruedInterestPaid. */
  settlementConsideration: number;
  regulatoryLevy: number;
  dealerFee: number;
  /** settlementConsideration + regulatoryLevy + dealerFee — equals investmentAmount by construction. */
  totalAcquisitionCost: number;
  /** Remaining cash flows of this position, scaled to faceValueAcquired. */
  cashFlows: CashFlow[];
  /** Sum of all remaining coupon payments (excluding final principal), scaled to faceValueAcquired. */
  totalCouponsReceived: number;
  /** Principal repaid at maturity — equals faceValueAcquired by construction. */
  principalRedemption: number;
  /** totalCouponsReceived + principalRedemption. */
  totalNominalCashReceived: number;
  /** totalNominalCashReceived − investmentAmount. Nominal (not time-value-of-money-adjusted) profit. */
  nominalProfit: number;
  /** Yield to maturity at the dirty price alone, before any charges. */
  ytmBeforeChargesPct: number;
  /** Annualised hold-to-maturity return on the total acquisition cost — gross of tax, after charges. Equals ytmBeforeChargesPct when there are no charges. */
  annualisedReturnPct: number;
  /** annualisedReturnPct restated with annual compounding (XIRR basis) — see price-scenarios.ts toEffectiveAnnualPct. */
  effectiveAnnualReturnPct: number | null;
}

export function evaluateInvestment(
  terms: BondTerms,
  settlementDate: Date,
  investmentAmount: number,
  cleanPrice: number,
  charges: TransactionCharges = NO_CHARGES,
): Result<InvestmentEvaluation> {
  if (!(investmentAmount > 0)) return unavailable("INVALID_PRICE", "Investment amount must be greater than zero.");
  if (!(cleanPrice > 0)) return unavailable("INVALID_PRICE", "A positive purchase price is required to evaluate an investment.");
  const chargeError = validateCharges(charges);
  if (chargeError) return unavailable("INVALID_PRICE", chargeError);

  const accruedResult = computeAccruedInterest(terms, settlementDate);
  if (!accruedResult.ok) return accruedResult;

  const dirtyPrice = cleanPrice + accruedResult.accruedInterest;
  const allInPrice = dirtyPrice * chargesMultiplier(charges);

  const schedule = generateCashFlows(terms, settlementDate);
  if (!schedule.ok) return schedule;

  const ytmResult = computeYtm(terms, settlementDate, dirtyPrice);
  if (!ytmResult.ok) return ytmResult;
  const allInResult = computeYtm(terms, settlementDate, allInPrice);
  if (!allInResult.ok) return allInResult;

  // Price is quoted per `terms.faceValue` nominal (the market's par-quoting
  // convention) — the nominal this investment amount buys scales inversely
  // with the all-in price relative to that convention.
  const faceValueAcquired = (investmentAmount * terms.faceValue) / allInPrice;
  const multiplier = faceValueAcquired / terms.faceValue;

  const cleanConsideration = cleanPrice * multiplier;
  const accruedInterestPaid = accruedResult.accruedInterest * multiplier;
  const settlementConsideration = cleanConsideration + accruedInterestPaid;
  const regulatoryLevy = settlementConsideration * (charges.regulatoryLevyPct / 100);
  const dealerFee = settlementConsideration * (charges.dealerFeePct / 100);

  const cashFlows = schedule.flows.map((f) => ({ date: f.date, coupon: f.coupon * multiplier, principal: f.principal * multiplier, total: f.total * multiplier }));
  const totalCouponsReceived = cashFlows.reduce((sum, f) => sum + f.coupon, 0);
  const principalRedemption = terms.faceValue * multiplier; // == faceValueAcquired
  const totalNominalCashReceived = totalCouponsReceived + principalRedemption;

  return {
    ok: true,
    investmentAmount,
    cleanPrice,
    accruedInterest: accruedResult.accruedInterest,
    dirtyPrice,
    faceValueAcquired,
    cleanConsideration,
    accruedInterestPaid,
    settlementConsideration,
    regulatoryLevy,
    dealerFee,
    totalAcquisitionCost: settlementConsideration + regulatoryLevy + dealerFee,
    cashFlows,
    totalCouponsReceived,
    principalRedemption,
    totalNominalCashReceived,
    nominalProfit: totalNominalCashReceived - investmentAmount,
    ytmBeforeChargesPct: ytmResult.ytmPct,
    annualisedReturnPct: allInResult.ytmPct,
    effectiveAnnualReturnPct: toEffectiveAnnualPct(terms, settlementDate, allInResult.ytmPct),
  };
}
