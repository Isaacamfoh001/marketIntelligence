// ---------------------------------------------------------------------------
// Within-dimension ranking (M9.0.1). Pure. Each function ranks the findings of
// ONE analytical dimension by that dimension's NATURAL denominator and returns
// the share it used. Nothing here compares a share from one dimension with a
// share from another: 60% of measured rate sensitivity and 60% of portfolio value
// are different facts, and are never put on one scale.
//
//   COMPOSITION       share of the portfolio's (Analytical Starting / Reference) value
//   CONCENTRATION     share of that value held in one issuer / one holding
//   RATE_SENSITIVITY  share of the portfolio's MEASURED rate sensitivity (estimated GHS change for a 1 percentage-point move)
//   MATURITY          share of CONTRACTUAL principal (bond nominal + bill face) that matures within the near-term window
//   DATA_QUALITY      share of the valued total resting on older evidence
//   VALUATION_BASIS   share of the valued total resting on analyst assumptions
//   UNVALUED          no value denominator — ordered by the contractual principal still excluded
//   SCENARIO          share of the scenario's net impact (see scenario-insights.ts)
//
// Ties always break on a fixed order (label, then id) — never on input order.
// ---------------------------------------------------------------------------

import { EXPOSURE_ASSET_CLASS_LABEL, type ExposureAssetClass, type PortfolioExposures } from "../portfolio";
import { NEAR_MATURITY_DAYS, type HoldingView, type HoldingRate } from "./types";

export const ASSET_CLASS_ORDER: ExposureAssetClass[] = ["TREASURY_BILL", "GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"];

const byLabel = (a: { label: string; positionId?: string }, b: { label: string; positionId?: string }) => a.label.localeCompare(b.label) || (a.positionId ?? "").localeCompare(b.positionId ?? "");

export interface ClassShare {
  assetClass: ExposureAssetClass;
  label: string;
  /** Share of the valued total (0–100). */
  sharePct: number;
  valueGhs: number;
}

/** COMPOSITION — what dominates the portfolio? Asset classes, largest share of value first. */
export function rankComposition(exposures: PortfolioExposures): ClassShare[] {
  return exposures.allocation.rows
    .map((r) => ({ assetClass: r.assetClass, label: EXPOSURE_ASSET_CLASS_LABEL[r.assetClass], sharePct: r.pct, valueGhs: r.referenceValueGhs }))
    .sort((a, b) => b.sharePct - a.sharePct || ASSET_CLASS_ORDER.indexOf(a.assetClass) - ASSET_CLASS_ORDER.indexOf(b.assetClass));
}

/** CONCENTRATION — where is exposure concentrated? Issuers, largest share of value first (a company's bond and equity are one issuer). */
export function rankConcentration(exposures: PortfolioExposures) {
  return [...exposures.issuers.rows].sort((a, b) => b.pct - a.pct || a.issuer.name.localeCompare(b.issuer.name));
}

export type RatedHolding = HoldingView & { rate: HoldingRate };

export interface RateRanking {
  /** Holdings with a measured sensitivity, largest first. */
  holdings: { holding: RatedHolding; sharePct: number }[];
  /** The same measured sensitivity grouped by asset class, largest first. */
  classes: { assetClass: ExposureAssetClass; label: string; sharePct: number; per1ppGhs: number }[];
  totalPer1ppGhs: number;
  /** Share of the measured sensitivity whose starting yield/rate is an analyst assumption (0–100). */
  assumptionSharePct: number;
}

/** RATE_SENSITIVITY — where does MEASURED rate sensitivity sit? Natural denominator: the sum of the measured per-1pp changes. */
export function rankRate(holdings: HoldingView[]): RateRanking | null {
  const rated = holdings.filter((h): h is RatedHolding => h.rate !== null);
  if (rated.length === 0) return null;
  const total = rated.reduce((s, h) => s + h.rate.per1ppGhs, 0);
  const share = (x: number) => (total > 0 ? (x / total) * 100 : 0);
  const ranked = [...rated].sort((a, b) => b.rate.per1ppGhs - a.rate.per1ppGhs || byLabel(a, b)).map((holding) => ({ holding, sharePct: share(holding.rate.per1ppGhs) }));
  const classes = ASSET_CLASS_ORDER.map((assetClass) => {
    const per1ppGhs = rated.filter((h) => h.assetClass === assetClass).reduce((s, h) => s + h.rate.per1ppGhs, 0);
    return { assetClass, label: EXPOSURE_ASSET_CLASS_LABEL[assetClass], sharePct: share(per1ppGhs), per1ppGhs };
  })
    .filter((c) => c.per1ppGhs > 0)
    .sort((a, b) => b.sharePct - a.sharePct || ASSET_CLASS_ORDER.indexOf(a.assetClass) - ASSET_CLASS_ORDER.indexOf(b.assetClass));
  const assumed = rated.filter((h) => h.rate.basis === "ANALYST_ASSUMPTION").reduce((s, h) => s + h.rate.per1ppGhs, 0);
  return { holdings: ranked, classes, totalPer1ppGhs: total, assumptionSharePct: share(assumed) };
}

/** MATURITY — what capital comes due soon? Holdings maturing within the near-term window, soonest first, with their share of contractual principal. */
export function rankMaturity(holdings: HoldingView[], totalPrincipalGhs: number) {
  return holdings
    .filter((h) => h.daysToMaturity !== null && h.daysToMaturity <= NEAR_MATURITY_DAYS)
    .sort((a, b) => a.daysToMaturity! - b.daysToMaturity! || byLabel(a, b))
    .map((h) => ({ holding: h, sharePct: totalPrincipalGhs > 0 && h.principalGhs !== null ? (h.principalGhs / totalPrincipalGhs) * 100 : 0 }));
}

/** DATA_QUALITY — what weakens confidence in the evidence? Valued holdings on older evidence, largest affected amount first. */
export function rankDataQuality(holdings: HoldingView[], totalValuedGhs: number | null) {
  return holdings
    .filter((h) => h.status === "VALUED" && h.quality.recency === "STALE")
    .sort((a, b) => (b.referenceValueGhs ?? 0) - (a.referenceValueGhs ?? 0) || byLabel(a, b))
    .map((h) => ({ holding: h, sharePct: totalValuedGhs ? ((h.referenceValueGhs ?? 0) / totalValuedGhs) * 100 : 0 }));
}

/** VALUATION_BASIS — how much of the analysis depends on assumptions? Assumption-based holdings, largest first, with share of the valued total. */
export function rankValuationBasis(holdings: HoldingView[], totalValuedGhs: number | null) {
  const assumed = holdings.filter((h) => h.basis === "ANALYST_ASSUMPTION").sort((a, b) => (b.referenceValueGhs ?? 0) - (a.referenceValueGhs ?? 0) || byLabel(a, b));
  const assumedTotal = assumed.reduce((s, h) => s + (h.referenceValueGhs ?? 0), 0);
  return assumed.map((h) => ({ holding: h, sharePct: totalValuedGhs ? ((h.referenceValueGhs ?? 0) / totalValuedGhs) * 100 : 0, shareOfAssumptionsPct: assumedTotal > 0 ? ((h.referenceValueGhs ?? 0) / assumedTotal) * 100 : 0 }));
}

/** UNVALUED — no value denominator exists, so order by the contractual principal that is still excluded (largest first; no principal last). */
export function rankUnvalued(holdings: HoldingView[]): HoldingView[] {
  return holdings
    .filter((h) => h.status === "UNVALUED")
    .sort((a, b) => (b.principalGhs ?? -1) - (a.principalGhs ?? -1) || byLabel(a, b));
}
