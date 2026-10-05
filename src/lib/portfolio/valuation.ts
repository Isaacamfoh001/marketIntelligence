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
import type { BondValuationInput } from "./bond-input";
import type { EquityValuationInput } from "./equity-input";
import type { InputRecency, PortfolioAssetClass, Unvalued } from "./types";

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
}

export interface ValuedPosition {
  status: "VALUED";
  assetClass: PortfolioAssetClass;
  recency: InputRecency;
  /** GHS, rounded to 0.01. */
  referenceValueGhs: number;
  /** The date of the observed input behind the value (bond: yield observed; equity: trade date). */
  inputDate: string;
  inputAgeDays: number;
  detail: BondValuationDetail | EquityValuationDetail;
}

export interface UnvaluedPosition extends Unvalued {
  status: "UNVALUED";
  assetClass: PortfolioAssetClass;
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

export function valueEquityPosition(shares: number, input: EquityValuationInput | Unvalued): PositionValuation {
  if (!input.available) return { status: "UNVALUED", assetClass: "EQUITY", available: false, code: input.code, reason: input.reason };
  return {
    status: "VALUED",
    assetClass: "EQUITY",
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
// Portfolio aggregation — coverage over the VALUED portion only.
// ---------------------------------------------------------------------------

export interface PortfolioValuationSummary {
  valuationDate: string;
  positionCount: number;
  valuedCount: number;
  unvaluedCount: number;
  /** Sum of the valued positions' reference values; null (never 0) when nothing could be valued. */
  referenceValueGhs: number | null;
  recentValueGhs: number;
  staleValueGhs: number;
  recentCount: number;
  staleCount: number;
  /**
   * Share of the VALUED reference value resting on recent / stale inputs
   * (0–100). The denominator is the valued portion — NOT the whole portfolio —
   * whenever `isComplete` is false. Null when nothing is valued.
   */
  recentPct: number | null;
  stalePct: number | null;
  /** True only when the portfolio has positions and every one is valued. */
  isComplete: boolean;
  /** Earliest and latest observation dates among the valued positions' inputs — positions are NOT all observed on the same date. */
  inputDateRange: { from: string; to: string } | null;
  inputAgeRangeDays: { min: number; max: number } | null;
}

export function summarizePortfolio(positions: PositionValuation[], valuationDate: Date): PortfolioValuationSummary {
  const valued = positions.filter((p): p is ValuedPosition => p.status === "VALUED");
  const recent = valued.filter((p) => p.recency === "RECENT");
  const stale = valued.filter((p) => p.recency === "STALE");
  const sum = (ps: ValuedPosition[]) => round2(ps.reduce((s, p) => s + p.referenceValueGhs, 0));
  const total = valued.length > 0 ? sum(valued) : null;
  const recentValue = sum(recent);
  const staleValue = sum(stale);
  const dates = valued.map((p) => p.inputDate).sort();
  const ages = valued.map((p) => p.inputAgeDays);

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
    recentPct: total !== null && total > 0 ? (recentValue / total) * 100 : null,
    stalePct: total !== null && total > 0 ? (staleValue / total) * 100 : null,
    isComplete: positions.length > 0 && valued.length === positions.length,
    inputDateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    inputAgeRangeDays: ages.length > 0 ? { min: Math.min(...ages), max: Math.max(...ages) } : null,
  };
}
