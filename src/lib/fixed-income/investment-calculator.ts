// ---------------------------------------------------------------------------
// Investment / Return Calculator — hold-to-maturity scenario only (M7 §15).
//
// A bond is a linear instrument: buying `faceValueAcquired` nominal of a
// bond whose contractual terms are defined per `terms.faceValue` (the
// market's par-quoting convention, typically 100) scales every cash flow
// by the same factor (faceValueAcquired / terms.faceValue). This lets the
// calculator reuse generateCashFlows/computeYtm exactly as-is rather than
// re-deriving bond cash-flow math a second time for a "scaled" bond.
//
// Nothing here presents a result as a guaranteed return — every figure is
// labeled by what it assumes (hold to maturity, at today's known contractual
// terms) per M7 §15/§23.
// ---------------------------------------------------------------------------

import { computeAccruedInterest, cleanToDirty } from "./accrued";
import { generateCashFlows } from "./cashflow";
import { computeYtm } from "./yield";
import { unavailable, type BondTerms, type Result } from "./types";

export interface InvestmentEvaluation {
  investmentAmount: number;
  cleanPrice: number;
  accruedInterest: number;
  dirtyPrice: number;
  /** Total nominal/face value of the bond this investment amount buys, at the given dirty price. */
  faceValueAcquired: number;
  /** Sum of all remaining coupon payments (excluding final principal), scaled to faceValueAcquired. */
  totalCouponsReceived: number;
  /** Principal repaid at maturity — equals faceValueAcquired by construction. */
  principalRedemption: number;
  /** totalCouponsReceived + principalRedemption. */
  totalNominalCashReceived: number;
  /** totalNominalCashReceived − investmentAmount. Nominal (not time-value-of-money-adjusted) profit. */
  nominalProfit: number;
  /** Annualised return assuming hold-to-maturity at the given price — i.e. this investment's yield to maturity. */
  annualisedReturnPct: number;
}

export function evaluateInvestment(
  terms: BondTerms,
  settlementDate: Date,
  investmentAmount: number,
  cleanPrice: number,
): Result<InvestmentEvaluation> {
  if (!(investmentAmount > 0)) return unavailable("INVALID_PRICE", "Investment amount must be greater than zero.");
  if (!(cleanPrice > 0)) return unavailable("INVALID_PRICE", "A positive market price is required to evaluate an investment.");

  const accruedResult = computeAccruedInterest(terms, settlementDate);
  if (!accruedResult.ok) return accruedResult;

  const dirtyPrice = cleanToDirty(cleanPrice, accruedResult.accruedInterest);

  const schedule = generateCashFlows(terms, settlementDate);
  if (!schedule.ok) return schedule;

  const ytmResult = computeYtm(terms, settlementDate, dirtyPrice);
  if (!ytmResult.ok) return ytmResult;

  // Price is quoted per `terms.faceValue` nominal (the market's par-quoting
  // convention) — the nominal this investment amount buys scales inversely
  // with the dirty price relative to that convention.
  const faceValueAcquired = (investmentAmount * terms.faceValue) / dirtyPrice;
  const multiplier = faceValueAcquired / terms.faceValue;

  const totalCouponsReceived = schedule.flows.reduce((sum, f) => sum + f.coupon * multiplier, 0);
  const principalRedemption = terms.faceValue * multiplier; // == faceValueAcquired
  const totalNominalCashReceived = totalCouponsReceived + principalRedemption;

  return {
    ok: true,
    investmentAmount,
    cleanPrice,
    accruedInterest: accruedResult.accruedInterest,
    dirtyPrice,
    faceValueAcquired,
    totalCouponsReceived,
    principalRedemption,
    totalNominalCashReceived,
    nominalProfit: totalNominalCashReceived - investmentAmount,
    annualisedReturnPct: ytmResult.ytmPct,
  };
}
