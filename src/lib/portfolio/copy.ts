// ---------------------------------------------------------------------------
// Shared wording for the portfolio surfaces (M8.1). Kept next to the domain so
// the disclosed assumption and the terminology can never drift from what the
// calculation actually does, and so tests can pin it.
// ---------------------------------------------------------------------------

import { BILL_RECENT_WINDOW_DAYS, BOND_RECENT_WINDOW_DAYS, EQUITY_RECENT_WINDOW_DAYS, type InputRecency, type UnvaluedCode } from "./types";

export const REFERENCE_VALUE_LABEL = "Reference value";

export const REFERENCE_VALUE_DEFINITION =
  "A reference value is Korbly's transparent estimate of what a position is worth on the valuation date, built from the most recent reliable observed market input. It is not a market value, NAV or executable price — nothing here says a position could be sold for this amount.";

export const BOND_ASSUMPTION = (observationDate: string, valuationDate: string) =>
  `The last reliable observed yield is held constant from ${observationDate} to the valuation date (${valuationDate}). The market may have moved since.`;

export const BILL_ASSUMPTION = (observationDate: string, valuationDate: string) =>
  `Valued with the Bank of Ghana auction rates of ${observationDate}, interpolated to this bill's remaining life, as at ${valuationDate}. Bank of Ghana publishes auction rates only for NEW 91-, 182- and 364-day bills, and Korbly has no secondary-market quote for this bill, so the rate for its remaining life is an estimate between those auctions. The true market rate for this bill may differ and has moved by tens of basis points in a single week; treat the value as indicative, not a market price.`;

export const BILL_BASIS_LABEL = "Interpolated BoG auction rate (indicative)";

export const RECENCY_LABEL: Record<InputRecency, string> = {
  RECENT: "Recent observed input",
  STALE: "Stale observed input",
};

export const RECENCY_RULE = {
  BOND: `An observation is recent if it is at most ${BOND_RECENT_WINDOW_DAYS} calendar days old at the valuation date (the Fixed Income weekly tolerance), otherwise stale.`,
  TREASURY_BILL: `The auction curve is recent if it is at most ${BILL_RECENT_WINDOW_DAYS} calendar days old at the valuation date (BoG auctions weekly), otherwise stale.`,
  EQUITY: `A trade is recent if it is at most ${EQUITY_RECENT_WINDOW_DAYS} calendar days old at the valuation date, otherwise stale.`,
} as const;

export const UNVALUED_LABEL: Record<UnvaluedCode, string> = {
  NOT_GHS: "Not GHS",
  MATURED: "Matured",
  FLOATING_RATE: "Floating rate",
  NOT_OUTSTANDING: "Not outstanding",
  TERMS_UNSUPPORTED: "Terms incomplete",
  TERMS_CONFLICT: "Terms conflict",
  NO_OBSERVATION: "No observation",
  NO_REFERENCE_RATE: "No reference rate",
  NO_TRADE: "No trade recorded",
  UNDER_REVIEW: "Under data review",
  OBSERVATION_EXCLUDED: "Observation excluded",
  INACTIVE: "Inactive",
  NO_PRICE: "No price",
  CALCULATION_FAILED: "Not computable",
};

// ---------------------------------------------------------------------------
// Exposure analytics wording (M8.2) — one place so the UI, the tests and the
// completion report cannot drift apart.
// ---------------------------------------------------------------------------

export const EXPOSURE_COPY = {
  allocationBasis: "Valued positions only",
  allocation: "Share of valued reference value. Unvalued positions are excluded and shown separately — they are not counted as zero.",
  issuer: "Reference value aggregated by economic issuer across valued positions. A company's bond and equity are one issuer when they link to the same company record. Unvalued positions add no value here and are noted separately.",
  maturity: "Contractual bond nominal and Treasury-bill face value grouped by remaining time to maturity from the valuation date. This is principal repayment, not market value: a holding without a market valuation still appears if its maturity is reliable; a bond with conflicting maturity terms, or a bond or bill already matured, is left out. A Treasury bill has a single payment — its face value — and pays no coupon.",
  maturityBuckets: "A bond maturing exactly on an anniversary of the valuation date falls in the longer bucket (e.g. exactly 1 year → 1–3 years).",
  dv01: "Approximate change in the value of the valued bond sleeve for a 1bp parallel rise in yields (shown as a positive amount; value falls when yields rise). Summed from each bond's own cash flows using the Fixed Income engine. A first-order sensitivity — not a forecast, not a scenario result, and equities are not included.",
  duration: "A first-order estimate of the percentage change in the value of the valued bond sleeve for a 1 percentage-point change in yield, weighted by reference value across the bonds that have a sensitivity figure.",
  billDv01: "Approximate change in the reference value of the valued Treasury bills for a 1bp rise in the Treasury-bill reference rate (shown as a positive amount; value falls when rates rise). Calculated with the Treasury-bill formula (simple interest, Actual/365), not the coupon-bond routine. It is separate from the bond DV01 — the two are not added together because bill rates and bond yields need not move together. A first-order sensitivity, not a forecast.",
  coupon: "Annual contractual coupon = bond nominal × coupon rate. This is not yield, total return, expected income or cash received this year. It rests on the bond's terms, not on market data.",
  upcoming: "Nearest contractual maturities among bonds with reliable maturity terms. Principal due at maturity assumes the issuer pays as contracted; no prediction is made.",
  contractualVsMarket: "Contractual figures (maturity, coupon) depend on a bond's terms and its nominal; market figures (allocation, issuer concentration, DV01, duration) depend on a valuation input. A bond can be unvalued for the second and still included in the first.",
} as const;

// ---------------------------------------------------------------------------
// Context-aware terminology for the portfolio's headline value (M9.0.1).
//
// "Reference value" is RESERVED for Korbly-supported valuation. The moment any
// position rests on an analyst assumption the portfolio total is no longer a
// Reference value — it is the ANALYTICAL STARTING VALUE: the value used for this
// analysis, a disclosed mixture of Korbly-supported valuations and explicit
// assumptions. It is never called "Market value". Deterministic: the wording
// depends only on whether `assumptionCount` is zero.
// ---------------------------------------------------------------------------

export const ANALYTICAL_STARTING_VALUE_LABEL = "Analytical Starting Value";

export const ANALYTICAL_STARTING_VALUE_DEFINITION =
  "The starting value used for this analysis: a disclosed mixture of Korbly-supported valuations and explicit analyst assumptions. It is not an observed market value, and it is not a Reference value.";

export interface ValueTerms {
  /** "Reference Value" or "Analytical Starting Value" — the title-case label for the portfolio total. */
  label: string;
  /** Lower-case form for use mid-sentence: "Reference Value" / "Analytical Starting Value" stay capitalised as proper terms. */
  inline: string;
  /** "valued Reference Value" / "valued Analytical Starting Value" — the denominator wording used in shares. */
  shareOf: string;
  /** True when the total includes analyst assumptions. */
  analytical: boolean;
}

/** Which name the portfolio total goes by. Reference wording survives only while every valued position is Korbly-supported. */
export function valueTerms(summary: { assumptionCount: number }): ValueTerms {
  const analytical = summary.assumptionCount > 0;
  const label = analytical ? ANALYTICAL_STARTING_VALUE_LABEL : REFERENCE_VALUE_LABEL.replace("value", "Value");
  return { label, inline: label, shareOf: `valued ${label}`, analytical };
}
