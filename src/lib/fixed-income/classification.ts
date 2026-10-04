// ---------------------------------------------------------------------------
// Small pure helpers shared across the fixed-income engine. Classification
// is derived from instrumentType rather than stored redundantly, so the two
// can never silently drift apart (mirrors financial-profile.ts's single-
// source-of-truth pattern).
// ---------------------------------------------------------------------------

import type { CouponFrequency, FixedIncomeClassification, FixedIncomeInstrumentType } from "./types";

export function classifyInstrument(instrumentType: FixedIncomeInstrumentType): FixedIncomeClassification {
  return instrumentType === "GOVERNMENT_BOND" ? "SOVEREIGN" : "CORPORATE";
}

/** Coupon payments per calendar year. */
export function paymentsPerYear(frequency: CouponFrequency): number {
  switch (frequency) {
    case "ANNUAL":
      return 1;
    case "SEMI_ANNUAL":
      return 2;
    case "QUARTERLY":
      return 4;
    case "MONTHLY":
      return 12;
  }
}

export const COUPON_FREQUENCY_LABEL: Record<CouponFrequency, string> = {
  ANNUAL: "Annual",
  SEMI_ANNUAL: "Semi-Annual",
  QUARTERLY: "Quarterly",
  MONTHLY: "Monthly",
};
