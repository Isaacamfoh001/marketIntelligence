// ---------------------------------------------------------------------------
// Treasury-bill REFERENCE RATE (M8.5). Pure.
//
// WHAT KORBLY HAS: weekly Bank of Ghana PRIMARY-AUCTION results for three
// tenors (91/182/364 days). It has NO secondary-market bill quotes and no
// instrument-level bill prices. An auction rate is the clearing rate for a NEW
// bill of that tenor on that day; it is not an executable quote for a bill that
// has fewer days left. So Korbly does NOT call it a market yield. It builds a
// transparent "reference rate" for the bill's remaining life:
//
//   1. take the LATEST auction date (≤ valuation date) on which all three
//      tenors were published (one weekly curve — never mixing dates);
//   2. interpolate that curve LINEARLY in days to the bill's remaining days;
//   3. below the shortest tenor (91d) use the 91-day rate unchanged (flat —
//      disclosed as an extrapolation); above 364d cannot occur for a bill.
//
// METHODOLOGY REVIEW (M8.5): linear interpolation is kept because it is the
// least-assumption continuous method the evidence allows — nearest-tenor jumps at
// tenor midpoints, and fitted curves need more than three pillars. Its precision is
// LIMITED and is disclosed, not hidden: holding out the 182-day pillar across the 88
// stored weekly curves, linear(91,364) missed by 50bp on average (max 156bp; bias
// −37bp because the curve is concave), and each pillar moves ~34bp in a typical week.
// The value is therefore INDICATIVE (see BILL_BASIS_LABEL / BILL_ASSUMPTION).
//
// If no complete curve exists, there is no reference rate (never a zero, never
// a partial curve guess).
// ---------------------------------------------------------------------------

import { BILL_TENORS } from "./convention";

export interface AuctionRateRow {
  tenorDays: number;
  /** ISO date (YYYY-MM-DD) of the BoG auction/issue. */
  observationDate: string;
  /** BoG "interest rate" — return on price paid, percent. */
  interestRatePct: number;
  discountRatePct: number;
  tenderNumber: string | null;
}

export interface CurveNode {
  tenorDays: number;
  interestRatePct: number;
  tenderNumber: string | null;
}

export interface AuctionCurve {
  observationDate: string;
  nodes: CurveNode[]; // ascending tenor
}

/** Latest date ≤ valuationDate on which every BILL_TENOR has a row; null when no complete curve exists. */
export function selectLatestCompleteCurve(rows: AuctionRateRow[], valuationDateIso: string): AuctionCurve | null {
  const byDate = new Map<string, Map<number, AuctionRateRow>>();
  for (const r of rows) {
    if (r.observationDate > valuationDateIso) continue;
    if (!Number.isFinite(r.interestRatePct)) continue;
    let m = byDate.get(r.observationDate);
    if (!m) byDate.set(r.observationDate, (m = new Map()));
    m.set(r.tenorDays, r);
  }
  const dates = [...byDate.keys()].sort().reverse();
  for (const date of dates) {
    const m = byDate.get(date)!;
    if (BILL_TENORS.every((t) => m.has(t))) {
      return { observationDate: date, nodes: BILL_TENORS.map((t) => ({ tenorDays: t, interestRatePct: m.get(t)!.interestRatePct, tenderNumber: m.get(t)!.tenderNumber })) };
    }
  }
  return null;
}

export type InterpolationMethod = "EXACT_TENOR" | "INTERPOLATED" | "SHORT_END_FLAT";

export interface ReferenceRate {
  ratePct: number;
  method: InterpolationMethod;
  /** The curve nodes the rate rests on (1 for exact/flat, 2 for interpolated). */
  nodes: CurveNode[];
  /** Plain-language description of how the rate was obtained. */
  description: string;
}

export function interpolateReferenceRate(curve: AuctionCurve, days: number): ReferenceRate | null {
  if (!(days > 0) || !Number.isFinite(days)) return null;
  const nodes = curve.nodes;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const exact = nodes.find((n) => n.tenorDays === days);
  if (exact) return { ratePct: exact.interestRatePct, method: "EXACT_TENOR", nodes: [exact], description: `The ${exact.tenorDays}-day auction rate applies directly.` };
  if (days < first.tenorDays) {
    return { ratePct: first.interestRatePct, method: "SHORT_END_FLAT", nodes: [first], description: `Fewer than ${first.tenorDays} days remain, shorter than the shortest auctioned tenor, so the ${first.tenorDays}-day rate — the nearest observed tenor — is used unchanged (an extrapolation with no adjustment for the curve's usual upward slope).` };
  }
  if (days > last.tenorDays) return null; // a bill cannot outlive its original tenor (≤ 364d); refuse rather than extrapolate
  const upperIdx = nodes.findIndex((n) => n.tenorDays > days);
  const lo = nodes[upperIdx - 1];
  const hi = nodes[upperIdx];
  const w = (days - lo.tenorDays) / (hi.tenorDays - lo.tenorDays);
  const ratePct = lo.interestRatePct + w * (hi.interestRatePct - lo.interestRatePct);
  return { ratePct, method: "INTERPOLATED", nodes: [lo, hi], description: `Interpolated between the ${lo.tenorDays}-day (${lo.interestRatePct.toFixed(4)}%) and ${hi.tenorDays}-day (${hi.interestRatePct.toFixed(4)}%) auction rates.` };
}
