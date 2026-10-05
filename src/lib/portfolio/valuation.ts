// ---------------------------------------------------------------------------
// Base valuation (M8.1) — "Reference value", never "market value" or "NAV".
//
// BOND — yield-rolled reference value, built ENTIRELY on M7's engine
// (priceFromYield / computeAccruedInterest; no second pricing implementation):
//
//   y0           = yield of the latest reliable observed trade (solved at ITS OWN date)
//   P0_dirty     = priceFromYield(terms, valuationDate, y0)
//   clean        = P0_dirty − accruedInterest(valuationDate)
//   ReferenceValue = nominalGhs × P0_dirty / faceValue
//
// ASSUMPTION (always disclosed): the last reliable observed yield is held
// constant from its observation date to the valuation date. The observed
// historical price is kept alongside the rolled reference price and the two
// are never merged — they differ by accrual, pull-to-par and (for stale
// inputs) whatever the market did since.
//
// EQUITY — shares × the GSE closing VWAP of the last actual trading day
// (equity-input.ts); the trade date and age travel with the value.
//
// Every value is rounded to whole pesewas (0.01 GHS) at the position, so the
// portfolio total is exactly the sum of the displayed position values.
// ---------------------------------------------------------------------------

import { computeAccruedInterest, priceFromYield, type BondTerms } from "../fixed-income";
import { BILL_CONVENTION_LABEL, BILL_FORMULA, billDv01PerUnitFace, billModifiedDurationYears, billPricePer100, billPriceFactor, type CurveNode, type InterpolationMethod } from "../treasury-bills";
import type { BillValuationInput } from "./bill-input";
import type { BondValuationInput } from "./bond-input";
import type { EquityValuationInput } from "./equity-input";
import type { AppliedAssumption, PortfolioAssetClass, Unvalued, ValuationBasis, ValuationRecency } from "./types";

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface BondValuationDetail {
  assetClass: "BOND";
  nominalGhs: number;
  faceValue: number;
  valuationDate: string;
  observedYtmPct: number;
  observationDate: string;
  ageDays: number;
  /** Historical clean price actually traded on observationDate (per `faceValue`); NOT the rolled price. */
  observedCleanPrice: number | null;
  yieldFromSourceQuote: boolean;
  /** Rolled to the valuation date at the observed yield (per `faceValue`). */
  referenceCleanPrice: number;
  accruedInterest: number;
  referenceDirtyPrice: number;
  pendingReview: BondValuationInput["pendingReview"];
  /**
   * True when `observedYtmPct` is an ANALYST-ASSUMED starting yield (or the yield implied by an assumed price), not an
   * observed one. `observationDate` is then the valuation date, `ageDays` 0 and `observedCleanPrice` null — there is no
   * observation; consumers must branch on this (or on the position's `basis`) before describing the input as observed.
   */
  yieldIsAssumed?: boolean;
}

export interface EquityValuationDetail {
  assetClass: "EQUITY";
  shares: number;
  priceGhs: number;
  priceDate: string;
  ageDays: number;
  volume: number;
  valueTradedGhs: number | null;
  latestReportDate: string;
  skippedNoTradeRows: number;
  /** True when `priceGhs` is an ANALYST-ASSUMED price, not a GSE trade (then priceDate = valuation date, volume 0 is a placeholder, not an observation). */
  priceIsAssumed?: boolean;
}

/**
 * Treasury-bill reference valuation. Every term an analyst or expert needs to
 * reproduce the figure is here: face, remaining days, the rate used and where
 * it came from, the convention and the formula.
 */
export interface BillValuationDetail {
  assetClass: "TREASURY_BILL";
  /** Amount payable at maturity (the held face value), GHS. */
  faceValueGhs: number;
  valuationDate: string;
  daysToMaturity: number;
  /** Reference rate (percent, simple Act/365) the value rests on. */
  referenceRatePct: number;
  /** Date of the BoG auction curve behind the rate. */
  rateObservationDate: string;
  ageDays: number;
  /** "ANALYST_ASSUMPTION" when the rate is assumed rather than read off the BoG curve (then `nodes` is empty and the dates are the valuation date). */
  method: InterpolationMethod | "ANALYST_ASSUMPTION";
  methodDescription: string;
  nodes: CurveNode[];
  /** Reference price per 100 of face. */
  referencePricePer100: number;
  /** face − reference value: the discount still to accrete by maturity. */
  remainingDiscountGhs: number;
  /** GHS per +1bp in the reference rate (positive magnitude). */
  dv01Ghs: number;
  modifiedDurationYears: number;
  convention: string;
  formula: string;
}

export interface KorblyBasisSummary {
  basis: Exclude<ValuationBasis, "ANALYST_ASSUMPTION">;
  /** Korbly's own supported value, untouched by the analyst's assumption. */
  valueGhs: number;
  inputDate: string;
  recency: ValuationRecency;
}

export interface ValuedPosition {
  status: "VALUED";
  assetClass: PortfolioAssetClass;
  /** What kind of value this is (M9.0.1). Independent of `recency`. */
  basis: ValuationBasis;
  /** Evidence recency; NOT_APPLICABLE for an analyst assumption (it has no observation). */
  recency: ValuationRecency;
  /**
   * GHS, rounded to 0.01 — the value this position contributes to the analysis. It is a REFERENCE value only when
   * `basis` is REFERENCE (INDICATIVE for a bill); for ANALYST_ASSUMPTION it is an assumption value. The field keeps its
   * M8.1 name so the exposure and scenario engines are untouched; wording for people goes through `valueTerms()`.
   */
  referenceValueGhs: number;
  /** The date of the observed input behind the value (bond: yield observed; equity: trade date). The valuation date for an assumption. */
  inputDate: string;
  inputAgeDays: number;
  detail: BondValuationDetail | EquityValuationDetail | BillValuationDetail;
  /** The assumption this value rests on; null for Korbly-supported values. */
  assumption: AppliedAssumption | null;
  /** When an assumption overrides a Korbly-supported value, what Korbly itself supports — shown beside it, never overwritten. */
  korblyBasis: KorblyBasisSummary | null;
  /** A stored assumption NOT used because Korbly now has a supported value that it must not silently replace. */
  ignoredAssumption: AppliedAssumption | null;
}

export interface UnvaluedPosition extends Unvalued {
  status: "UNVALUED";
  assetClass: PortfolioAssetClass;
  /** A stored assumption that could not be applied (and why) — surfaced so it is never silently dropped. */
  assumptionProblem?: { summary: string; reason: string };
}

export type PositionValuation = ValuedPosition | UnvaluedPosition;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function valueBondPosition(nominalGhs: number, terms: BondTerms, input: BondValuationInput | Unvalued, valuationDate: Date): PositionValuation {
  if (!input.available) return { status: "UNVALUED", assetClass: "BOND", available: false, code: input.code, reason: input.reason };

  const priced = priceFromYield(terms, valuationDate, input.observedYtmPct);
  const accrued = computeAccruedInterest(terms, valuationDate);
  if (!priced.ok || !accrued.ok) {
    const message = !priced.ok ? priced.message : !accrued.ok ? accrued.message : "";
    return { status: "UNVALUED", assetClass: "BOND", available: false, code: "CALCULATION_FAILED", reason: `The reference price could not be calculated: ${message}` };
  }
  const dirty = priced.dirtyPrice;
  const clean = dirty - accrued.accruedInterest;
  return {
    status: "VALUED",
    assetClass: "BOND",
    basis: "REFERENCE",
    assumption: null,
    korblyBasis: null,
    ignoredAssumption: null,
    recency: input.recency,
    referenceValueGhs: round2((nominalGhs * dirty) / terms.faceValue),
    inputDate: input.observationDate,
    inputAgeDays: input.ageDays,
    detail: {
      assetClass: "BOND",
      nominalGhs,
      faceValue: terms.faceValue,
      valuationDate: isoDay(valuationDate),
      observedYtmPct: input.observedYtmPct,
      observationDate: input.observationDate,
      ageDays: input.ageDays,
      observedCleanPrice: input.observedCleanPrice,
      yieldFromSourceQuote: input.yieldFromSourceQuote,
      referenceCleanPrice: clean,
      accruedInterest: accrued.accruedInterest,
      referenceDirtyPrice: dirty,
      pendingReview: input.pendingReview,
    },
  };
}

export function valueBillPosition(faceValueGhs: number, input: BillValuationInput | Unvalued, valuationDate: Date): PositionValuation {
  if (!input.available) return { status: "UNVALUED", assetClass: "TREASURY_BILL", available: false, code: input.code, reason: input.reason };
  const factor = billPriceFactor(input.referenceRatePct, input.daysToMaturity);
  const dv01Unit = billDv01PerUnitFace(input.referenceRatePct, input.daysToMaturity);
  const md = billModifiedDurationYears(input.referenceRatePct, input.daysToMaturity);
  const price = billPricePer100(input.referenceRatePct, input.daysToMaturity);
  if (factor === null || dv01Unit === null || md === null || price === null) {
    return { status: "UNVALUED", assetClass: "TREASURY_BILL", available: false, code: "CALCULATION_FAILED", reason: "The reference value could not be calculated from this reference rate." };
  }
  const value = round2(faceValueGhs * factor);
  return {
    status: "VALUED",
    assetClass: "TREASURY_BILL",
    basis: "INDICATIVE",
    assumption: null,
    korblyBasis: null,
    ignoredAssumption: null,
    recency: input.recency,
    referenceValueGhs: value,
    inputDate: input.observationDate,
    inputAgeDays: input.ageDays,
    detail: {
      assetClass: "TREASURY_BILL",
      faceValueGhs,
      valuationDate: isoDay(valuationDate),
      daysToMaturity: input.daysToMaturity,
      referenceRatePct: input.referenceRatePct,
      rateObservationDate: input.observationDate,
      ageDays: input.ageDays,
      method: input.method,
      methodDescription: input.methodDescription,
      nodes: input.nodes,
      referencePricePer100: price,
      remainingDiscountGhs: round2(faceValueGhs - value),
      dv01Ghs: faceValueGhs * dv01Unit,
      modifiedDurationYears: md,
      convention: BILL_CONVENTION_LABEL,
      formula: BILL_FORMULA,
    },
  };
}

export function valueEquityPosition(shares: number, input: EquityValuationInput | Unvalued): PositionValuation {
  if (!input.available) return { status: "UNVALUED", assetClass: "EQUITY", available: false, code: input.code, reason: input.reason };
  return {
    status: "VALUED",
    assetClass: "EQUITY",
    basis: "REFERENCE",
    assumption: null,
    korblyBasis: null,
    ignoredAssumption: null,
    recency: input.recency,
    referenceValueGhs: round2(shares * input.priceGhs),
    inputDate: input.priceDate,
    inputAgeDays: input.ageDays,
    detail: {
      assetClass: "EQUITY",
      shares,
      priceGhs: input.priceGhs,
      priceDate: input.priceDate,
      ageDays: input.ageDays,
      volume: input.volume,
      valueTradedGhs: input.valueTradedGhs,
      latestReportDate: input.latestReportDate,
      skippedNoTradeRows: input.skippedNoTradeRows,
    },
  };
}

// ---------------------------------------------------------------------------
// Portfolio aggregation — over the VALUED portion only. Unvalued positions are
// excluded and counted separately, never treated as zero.
//
// VALUATION BASIS (M9.0.1). `referenceValueGhs` is the total of every valued
// position — the figure all exposure and scenario denominators use. It is a
// Reference value only while no position rests on an analyst assumption;
// otherwise it is the ANALYTICAL STARTING VALUE, a disclosed mixture of
// Korbly-supported values and explicit assumptions. `basis` splits it exactly
// (reference + indicative + assumption === total, to the pesewa).
// ---------------------------------------------------------------------------

export interface BasisSlice {
  count: number;
  valueGhs: number;
  /** Share of the total valued amount (0–100); null when nothing is valued. */
  pct: number | null;
}

export interface ValuationBasisBreakdown {
  reference: BasisSlice;
  indicative: BasisSlice;
  assumption: BasisSlice;
  /** Reference + indicative: what Korbly itself supports. */
  supported: BasisSlice;
}

export interface PortfolioValuationSummary {
  valuationDate: string;
  positionCount: number;
  valuedCount: number;
  unvaluedCount: number;
  /** Sum of the valued positions' values (reference, indicative AND assumption); null (never 0) when nothing could be valued. See ValuedPosition.referenceValueGhs. */
  referenceValueGhs: number | null;
  /** Value resting on recent / stale OBSERVED evidence. Assumption-based value is in neither. */
  recentValueGhs: number;
  staleValueGhs: number;
  recentCount: number;
  staleCount: number;
  /**
   * Share of the valued total resting on recent / stale observed evidence (0–100). With `assumptionPct` they add to 100.
   * The denominator is the valued portion — NOT the whole portfolio — whenever `isComplete` is false. Null when nothing is valued.
   */
  recentPct: number | null;
  stalePct: number | null;
  /** True only when the portfolio has positions and every one is valued. */
  isComplete: boolean;
  /** Earliest and latest OBSERVATION dates among the valued, non-assumed positions' inputs — positions are NOT all observed on the same date. */
  inputDateRange: { from: string; to: string } | null;
  inputAgeRangeDays: { min: number; max: number } | null;
  basis: ValuationBasisBreakdown;
  /** Number of positions carried at an analyst assumption. */
  assumptionCount: number;
  /** Share of the valued total that rests on analyst assumptions (0–100); null when nothing is valued. */
  assumptionPct: number | null;
}

export function summarizePortfolio(positions: PositionValuation[], valuationDate: Date): PortfolioValuationSummary {
  const valued = positions.filter((p): p is ValuedPosition => p.status === "VALUED");
  const recent = valued.filter((p) => p.recency === "RECENT");
  const stale = valued.filter((p) => p.recency === "STALE");
  // Sum in integer pesewas so the basis slices reconcile with the total exactly.
  const cents = (ps: ValuedPosition[]) => ps.reduce((s, p) => s + Math.round(p.referenceValueGhs * 100), 0);
  const sum = (ps: ValuedPosition[]) => cents(ps) / 100;
  const totalCents = cents(valued);
  const total = valued.length > 0 ? totalCents / 100 : null;
  const recentValue = sum(recent);
  const staleValue = sum(stale);
  const observed = valued.filter((p) => p.basis !== "ANALYST_ASSUMPTION");
  const dates = observed.map((p) => p.inputDate).sort();
  const ages = observed.map((p) => p.inputAgeDays);
  const pctOfTotal = (c: number): number | null => (totalCents > 0 ? (c / totalCents) * 100 : null);
  const slice = (ps: ValuedPosition[]): BasisSlice => ({ count: ps.length, valueGhs: sum(ps), pct: pctOfTotal(cents(ps)) });
  const byBasis = (b: ValuationBasis) => valued.filter((p) => p.basis === b);
  const supportedPositions = valued.filter((p) => p.basis !== "ANALYST_ASSUMPTION");
  const assumed = byBasis("ANALYST_ASSUMPTION");

  return {
    valuationDate: isoDay(valuationDate),
    positionCount: positions.length,
    valuedCount: valued.length,
    unvaluedCount: positions.length - valued.length,
    referenceValueGhs: total,
    recentValueGhs: recentValue,
    staleValueGhs: staleValue,
    recentCount: recent.length,
    staleCount: stale.length,
    recentPct: pctOfTotal(cents(recent)),
    stalePct: pctOfTotal(cents(stale)),
    isComplete: positions.length > 0 && valued.length === positions.length,
    inputDateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    inputAgeRangeDays: ages.length > 0 ? { min: Math.min(...ages), max: Math.max(...ages) } : null,
    basis: { reference: slice(byBasis("REFERENCE")), indicative: slice(byBasis("INDICATIVE")), assumption: slice(assumed), supported: slice(supportedPositions) },
    assumptionCount: assumed.length,
    assumptionPct: pctOfTotal(cents(assumed)),
  };
}
