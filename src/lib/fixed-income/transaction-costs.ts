// ---------------------------------------------------------------------------
// Purchase transaction costs (M7.3 §13/§14/§28).
//
//   Clean consideration
// + Accrued interest
// = Settlement consideration
// + Regulatory transaction levy
// + Dealer fee (optional, user-supplied)
// = Total acquisition cost
//
// Deliberately small: two percentage charges, both applied to the
// settlement consideration, expressed per 100 face value like every other
// price in the engine. Kept out of the UI so the scenario table, the
// dealer-quote calculator and any future trade evaluation all share it.
//
// REGULATORY LEVY — verified source (M7.3 §14):
// Securities and Exchange Commission, Ghana — "Guidelines on Market Levies
// for 2026", §4.0(1): "The transaction levy shall be paid by the purchaser
// and seller of securities"; §4.0(2)(b): "For Bonds, 0.01% of the value of
// trades", apportioned GFIM 0.0045% / CSD 0.0028% / SEC 0.0025% / Market
// Development 0.0002%.
//
// Assumption: "value of trades" is taken as the settlement (dirty)
// consideration. Applying it to the clean consideration instead differs by
// 0.01% × accrued interest — below 0.002 per 100 face for any bond here.
// Only the PURCHASE leg is charged: a hold-to-maturity redemption is a
// repayment by the issuer, not a trade.
//
// Tax is NOT modelled (M7.3 §15): every return built on these costs is a
// GROSS / pre-tax figure.
// ---------------------------------------------------------------------------

export interface TransactionCharges {
  /** Regulatory transaction levy, in percent of settlement consideration (0.01 means 0.01%). */
  regulatoryLevyPct: number;
  /** Dealer charge/fee, in percent of settlement consideration (0 when none is known). */
  dealerFeePct: number;
}

export const GFIM_BOND_TRANSACTION_LEVY = {
  ratePct: 0.01,
  label: "SEC bond transaction levy",
  source: "SEC Ghana — Guidelines on Market Levies for 2026, §4.0(1)–(2)(b)",
  sourceUrl: "https://sec.gov.gh/wp-content/uploads/Final-Regulatory-Laws/Guidelines/Guidelines_Market_Levies_2026.pdf",
  basis: "0.01% of the value of trades, paid by both purchaser and seller (GFIM 0.0045%, CSD 0.0028%, SEC 0.0025%, Market Development 0.0002%).",
} as const;

/** Buyer-side charges every scenario return includes by default: the verified regulatory levy and no dealer fee. */
export const DEFAULT_PURCHASE_CHARGES: TransactionCharges = { regulatoryLevyPct: GFIM_BOND_TRANSACTION_LEVY.ratePct, dealerFeePct: 0 };

export const NO_CHARGES: TransactionCharges = { regulatoryLevyPct: 0, dealerFeePct: 0 };

/** Upper bound for either charge — anything above is almost certainly a units mistake (e.g. "1" meant as 1bp), not a real fee. */
export const MAX_CHARGE_PCT = 10;

export function validateCharges(charges: TransactionCharges): string | null {
  for (const [name, value] of [
    ["Regulatory levy", charges.regulatoryLevyPct],
    ["Dealer fee", charges.dealerFeePct],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) return `${name} must be zero or a positive percentage.`;
    if (value > MAX_CHARGE_PCT) return `${name} above ${MAX_CHARGE_PCT}% is not plausible — enter a percentage (e.g. 0.25 for 0.25%).`;
  }
  return null;
}

export interface AcquisitionCost {
  /** Settlement (dirty) consideration: clean price + accrued interest. */
  settlementConsideration: number;
  regulatoryLevy: number;
  dealerFee: number;
  totalCharges: number;
  /** settlementConsideration + totalCharges — the full cash cost of acquisition. */
  totalAcquisitionCost: number;
}

/** Costs for one unit of settlement consideration (any scale — per 100 face, or a whole position). */
export function computeAcquisitionCost(cleanConsideration: number, accruedInterest: number, charges: TransactionCharges): AcquisitionCost {
  const settlementConsideration = cleanConsideration + accruedInterest;
  const regulatoryLevy = settlementConsideration * (charges.regulatoryLevyPct / 100);
  const dealerFee = settlementConsideration * (charges.dealerFeePct / 100);
  const totalCharges = regulatoryLevy + dealerFee;
  return { settlementConsideration, regulatoryLevy, dealerFee, totalCharges, totalAcquisitionCost: settlementConsideration + totalCharges };
}

/** Multiplier from settlement consideration to total acquisition cost (1 + levy% + fee%). */
export function chargesMultiplier(charges: TransactionCharges): number {
  return 1 + (charges.regulatoryLevyPct + charges.dealerFeePct) / 100;
}
