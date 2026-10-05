// ---------------------------------------------------------------------------
// Shared wording for the portfolio surfaces (M8.1). Kept next to the domain so
// the disclosed assumption and the terminology can never drift from what the
// calculation actually does, and so tests can pin it.
// ---------------------------------------------------------------------------

import { BOND_RECENT_WINDOW_DAYS, EQUITY_RECENT_WINDOW_DAYS, type InputRecency, type UnvaluedCode } from "./types";

export const REFERENCE_VALUE_LABEL = "Reference value";

export const REFERENCE_VALUE_DEFINITION =
  "A reference value is Korbly's transparent estimate of what a position is worth on the valuation date, built from the most recent reliable observed market input. It is not a market value, NAV or executable price — nothing here says a position could be sold for this amount.";

export const BOND_ASSUMPTION = (observationDate: string, valuationDate: string) =>
  `The last reliable observed yield is held constant from ${observationDate} to the valuation date (${valuationDate}). The market may have moved since.`;

export const RECENCY_LABEL: Record<InputRecency, string> = {
  RECENT: "Recent observed input",
  STALE: "Stale observed input",
};

export const RECENCY_RULE = {
  BOND: `An observation is recent if it is at most ${BOND_RECENT_WINDOW_DAYS} calendar days old at the valuation date (the Fixed Income weekly tolerance), otherwise stale.`,
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
  NO_TRADE: "No trade recorded",
  UNDER_REVIEW: "Under data review",
  OBSERVATION_EXCLUDED: "Observation excluded",
  INACTIVE: "Inactive",
  NO_PRICE: "No price",
  CALCULATION_FAILED: "Not computable",
};
