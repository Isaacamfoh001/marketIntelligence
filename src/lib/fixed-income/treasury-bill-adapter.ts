// ---------------------------------------------------------------------------
// Adapts a Treasury bill auction observation into the same BondTerms shape
// the cash-flow/duration engine already understands (M7 §3/§11/§14: "reuse
// existing Treasury data" rather than building a second, parallel
// zero-coupon-bond implementation just for bills).
//
// A T-bill is, cash-flow-wise, exactly a zero-coupon bond: one redemption
// of face value at maturity, no periodic coupon — ZERO_COUPON terms already
// model this precisely. Its yield is never solved from a price here (BoG's
// `interestRate` already IS the published yield), only the resulting
// duration/DV01 are computed for use alongside bonds in the comparables
// tool and sovereign yield curve (M7 §11/§14).
// ---------------------------------------------------------------------------

import type { BondTerms } from "./types";

export const TBILL_FACE_VALUE = 100;

export function treasuryBillToBondTerms(auctionDate: Date, tenorDays: number): BondTerms {
  const maturityDate = new Date(auctionDate.getTime() + tenorDays * 24 * 60 * 60 * 1000);
  return {
    issueDate: auctionDate,
    maturityDate,
    couponType: "ZERO_COUPON",
    couponRatePct: null,
    couponFrequency: null,
    faceValue: TBILL_FACE_VALUE,
  };
}
