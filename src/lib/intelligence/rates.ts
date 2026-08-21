// ---------------------------------------------------------------------------
// Monetary Policy and Short-Term Rates dimensions (M8 §22).
//
// Monetary Policy needs no invented threshold at all — a PolicyDecision is
// already classified HIKE/CUT/HOLD by the ingestion layer (M4/M5), so the
// state is a direct relabeling of a fact already in the database, not a
// derived judgement call.
//
// Short-Term Rates combines the 91/182/364-day T-bill auction-over-auction
// moves. Sentiment is always neutral for both dimensions, matching the
// existing UI convention for policy/Treasury rates (see Overview's
// MprMetricCard/TreasuryMetricCard comments): a higher or lower rate isn't
// inherently good or bad, so this layer never colors it that way — only
// equities and currency get a directional sentiment.
// ---------------------------------------------------------------------------

import { computeDirection } from "../direction";
import { observationFreshness, type Freshness } from "../freshness";
import { unavailableResult, type IntelligenceResult } from "./types";

// ---------------------------------------------------------------------------
// Monetary Policy
// ---------------------------------------------------------------------------

export type MonetaryPolicyState = "EASING" | "HOLDING" | "TIGHTENING" | "UNAVAILABLE";

const MPR_HEADLINE: Record<MonetaryPolicyState, string> = {
  EASING: "Easing",
  HOLDING: "Holding",
  TIGHTENING: "Tightening",
  UNAVAILABLE: "Unavailable",
};

export interface MonetaryPolicyInput {
  latestDecision: { decisionDate: Date; resultingRate: number; decisionType: "HIKE" | "CUT" | "HOLD"; changeBps?: number | null } | null;
}

export function evaluateMonetaryPolicyCondition(input: MonetaryPolicyInput): IntelligenceResult<MonetaryPolicyState> {
  if (!input.latestDecision) {
    return unavailableResult("UNAVAILABLE", MPR_HEADLINE.UNAVAILABLE, "No Monetary Policy Rate decision has been ingested yet.");
  }

  const { decisionDate, resultingRate, decisionType, changeBps } = input.latestDecision;
  const state: MonetaryPolicyState = decisionType === "HIKE" ? "TIGHTENING" : decisionType === "CUT" ? "EASING" : "HOLDING";
  const observationDate = decisionDate.toISOString().slice(0, 10);
  // bps magnitude is optional context, not part of the classification itself — a HIKE/CUT is TIGHTENING/EASING regardless of size.
  const bpsClause = changeBps != null ? `by ${Math.abs(changeBps)} bps ` : "";

  const explanation =
    state === "HOLDING"
      ? `The Bank of Ghana held its policy rate at ${resultingRate.toFixed(2)}% at its latest MPC decision.`
      : state === "EASING"
        ? `The Bank of Ghana cut its policy rate ${bpsClause}to ${resultingRate.toFixed(2)}% at its latest MPC decision.`
        : `The Bank of Ghana raised its policy rate ${bpsClause}to ${resultingRate.toFixed(2)}% at its latest MPC decision.`;

  return {
    state,
    direction: decisionType === "HIKE" ? "up" : decisionType === "CUT" ? "down" : "flat",
    sentiment: "neutral",
    headline: MPR_HEADLINE[state],
    explanation,
    // AD_HOC cadence: an unchanged rate is current by definition until the
    // next MPC meeting, so there's no separate "12-month average" reading
    // that would say anything beyond the decision history table already
    // shown on Macro & Rates.
    historicalNote: null,
    currentValue: resultingRate,
    previousValue: null,
    observationDate,
    freshness: observationFreshness("AD_HOC", decisionDate),
  };
}

// ---------------------------------------------------------------------------
// Short-Term Rates (91/182/364-day Treasury bills)
// ---------------------------------------------------------------------------

export type ShortTermRatesState = "FALLING" | "MIXED" | "RISING" | "UNAVAILABLE";

/** Minimum auction-over-auction basis-point move, per tenor, treated as a genuine shift rather than routine bid variation. */
export const RATES_NOISE_BAND_BPS = 10;

const RATES_HEADLINE: Record<ShortTermRatesState, string> = {
  FALLING: "Falling",
  MIXED: "Mixed",
  RISING: "Rising",
  UNAVAILABLE: "Unavailable",
};

export interface TenorInput {
  label: string;
  latest: { observationDate: Date; interestRate: number } | null;
  previous: { observationDate: Date; interestRate: number } | null;
}

export function evaluateShortTermRatesCondition(tenors: TenorInput[]): IntelligenceResult<ShortTermRatesState> {
  const withBoth = tenors.filter((t) => t.latest && t.previous) as { label: string; latest: NonNullable<TenorInput["latest"]>; previous: NonNullable<TenorInput["previous"]> }[];

  if (withBoth.length === 0) {
    const anyLatest = tenors.find((t) => t.latest)?.latest;
    if (!anyLatest) return unavailableResult("UNAVAILABLE", RATES_HEADLINE.UNAVAILABLE, "No Treasury bill data has been ingested yet.");
    return {
      state: "UNAVAILABLE",
      direction: null,
      sentiment: "neutral",
      headline: RATES_HEADLINE.UNAVAILABLE,
      explanation: "Not enough auction history yet to assess a Treasury yield trend.",
      historicalNote: null,
      currentValue: null,
      previousValue: null,
      observationDate: anyLatest.observationDate.toISOString().slice(0, 10),
      freshness: "MISSING",
    };
  }

  let fallingCount = 0;
  let risingCount = 0;
  const movedTenors: { label: string; bps: number }[] = [];
  for (const t of withBoth) {
    const bps = Math.round((t.latest.interestRate - t.previous.interestRate) * 100);
    const direction = computeDirection(t.latest.interestRate, t.previous.interestRate, RATES_NOISE_BAND_BPS / 100);
    if (direction === "down") { fallingCount++; movedTenors.push({ label: t.label, bps }); }
    else if (direction === "up") { risingCount++; movedTenors.push({ label: t.label, bps }); }
  }

  const state: ShortTermRatesState = fallingCount > risingCount && fallingCount >= 2 ? "FALLING" : risingCount > fallingCount && risingCount >= 2 ? "RISING" : "MIXED";

  const latestDate = withBoth.reduce((max, t) => (t.latest.observationDate > max ? t.latest.observationDate : max), withBoth[0].latest.observationDate);
  const freshnesses: Freshness[] = withBoth.map((t) => observationFreshness("WEEKLY", t.latest.observationDate));
  const freshness: Freshness = freshnesses.every((f) => f === "CURRENT") ? "CURRENT" : freshnesses.some((f) => f === "CURRENT") ? "CURRENT" : "STALE";

  const explanation =
    state === "FALLING"
      ? `Treasury yields eased across ${fallingCount} of ${withBoth.length} tracked tenors at the latest auctions.`
      : state === "RISING"
        ? `Treasury yields rose across ${risingCount} of ${withBoth.length} tracked tenors at the latest auctions.`
        : `Treasury yields moved in mixed directions across tracked tenors at the latest auctions.`;

  return {
    state,
    direction: state === "FALLING" ? "down" : state === "RISING" ? "up" : "flat",
    sentiment: "neutral",
    headline: RATES_HEADLINE[state],
    explanation,
    historicalNote: null,
    currentValue: withBoth[0].latest.interestRate,
    previousValue: withBoth[0].previous.interestRate,
    observationDate: latestDate.toISOString().slice(0, 10),
    freshness,
  };
}
