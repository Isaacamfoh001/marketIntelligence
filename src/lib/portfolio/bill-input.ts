// ---------------------------------------------------------------------------
// Treasury-bill valuation-input resolver (M8.5). Decides which reference rate —
// if any — a bill position may rest on. The ONLY evidence Korbly has is the
// weekly BoG auction curve (see treasury-bills/reference-rate.ts), so the
// hierarchy has exactly one usable tier:
//
//   1. REFERENCE RATE from the latest complete BoG auction curve,
//      interpolated to the bill's remaining days   → usable (RECENT / STALE)
//   2. no complete curve                            → unavailable
//   matured / non-GHS                                → unavailable (stated)
//
// There is deliberately NO instrument-specific or secondary-market tier: no
// such data exists in Korbly, and one is not invented. There is NO purchase-
// yield / accretion tier: Korbly records no cost basis or purchase date.
// ---------------------------------------------------------------------------

import { observationFreshness } from "../freshness";
import { observationAgeDays } from "../fixed-income";
import { billDaysToMaturity, interpolateReferenceRate, type AuctionCurve, type InterpolationMethod } from "../treasury-bills";
import type { CurveNode } from "../treasury-bills";
import type { InputRecency, Unvalued } from "./types";

export interface BillValuationSource {
  currency: string;
  tenorDays: number;
  issueDate: Date;
  maturityDate: Date;
  /** Latest complete BoG auction curve at/before the valuation date; null when none exists. */
  curve: AuctionCurve | null;
}

export interface BillValuationInput {
  available: true;
  assetClass: "TREASURY_BILL";
  referenceRatePct: number;
  /** Date of the BoG auction curve the rate comes from. */
  observationDate: string;
  ageDays: number;
  recency: InputRecency;
  daysToMaturity: number;
  method: InterpolationMethod;
  nodes: CurveNode[];
  methodDescription: string;
}

export function resolveBillValuationInput(source: BillValuationSource, valuationDate: Date): BillValuationInput | Unvalued {
  const no = (code: Unvalued["code"], reason: string): Unvalued => ({ available: false, code, reason });
  if (source.currency !== "GHS") return no("NOT_GHS", `Only GHS instruments are supported (this one is ${source.currency}).`);
  const days = billDaysToMaturity(source.maturityDate, valuationDate);
  if (days <= 0) {
    return no("MATURED", "This Treasury bill has reached its maturity date. It is no longer a live holding, so Korbly does not revalue it (and does not assume reinvestment); its contractual maturity payment is its face value. Remove it or record the settlement outside Korbly.");
  }
  if (!source.curve) return no("NO_REFERENCE_RATE", "No complete Bank of Ghana auction curve (91-, 182- and 364-day) is available on or before the valuation date, and Korbly holds no secondary-market quote for this bill, so it cannot be given a reference value.");
  const ref = interpolateReferenceRate(source.curve, days);
  if (!ref) return no("CALCULATION_FAILED", "Korbly could not derive a reference rate for this bill's remaining life.");
  const age = observationAgeDays(source.curve.observationDate, valuationDate) ?? 0;
  const recency: InputRecency = observationFreshness("WEEKLY", new Date(`${source.curve.observationDate}T00:00:00.000Z`), valuationDate) === "CURRENT" ? "RECENT" : "STALE";
  return { available: true, assetClass: "TREASURY_BILL", referenceRatePct: ref.ratePct, observationDate: source.curve.observationDate, ageDays: age, recency, daysToMaturity: days, method: ref.method, nodes: ref.nodes, methodDescription: ref.description };
}
