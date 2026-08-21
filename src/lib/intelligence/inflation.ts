// ---------------------------------------------------------------------------
// Price Pressure dimension (M8 §22) — driven by headline CPI YoY inflation
// and its most recent month-over-month direction.
// ---------------------------------------------------------------------------

import { computeDirection, sentimentFor } from "../direction";
import { observationFreshness } from "../freshness";
import { unavailableResult, describeTwelveMonthContext, type IntelligenceResult, type HistoryPoint } from "./types";

export type InflationState = "EASING" | "STABLE" | "RISING" | "UNAVAILABLE";

/**
 * Minimum month-over-month percentage-point move treated as a genuine
 * signal rather than base-effect/measurement noise in a single CPI print.
 * Documented per M8 §26 rather than left as a magic number.
 */
export const INFLATION_NOISE_BAND_PP = 0.2;

const HEADLINE: Record<InflationState, string> = {
  EASING: "Easing",
  STABLE: "Stable",
  RISING: "Rising",
  UNAVAILABLE: "Unavailable",
};

export interface InflationInput {
  latest: { observationDate: Date; value: number } | null;
  previous: { observationDate: Date; value: number } | null;
  history: HistoryPoint[];
}

export function evaluateInflationCondition(input: InflationInput): IntelligenceResult<InflationState> {
  if (!input.latest) {
    return unavailableResult("UNAVAILABLE", HEADLINE.UNAVAILABLE, "No inflation data has been ingested yet.");
  }

  const observationDate = input.latest.observationDate.toISOString().slice(0, 10);
  const freshness = observationFreshness("MONTHLY", input.latest.observationDate);
  const rate = input.latest.value;

  if (!input.previous) {
    return {
      state: "STABLE",
      direction: null,
      sentiment: "neutral",
      headline: HEADLINE.STABLE,
      explanation: `Headline inflation is ${rate.toFixed(1)}% — not enough prior history to assess direction.`,
      historicalNote: null,
      currentValue: rate,
      previousValue: null,
      observationDate,
      freshness,
    };
  }

  const priorRate = input.previous.value;
  const pp = Math.round((rate - priorRate) * 100) / 100;
  const direction = computeDirection(rate, priorRate, INFLATION_NOISE_BAND_PP);
  const sentiment = sentimentFor(direction, "higherIsNegative");
  const state: InflationState = direction === "up" ? "RISING" : direction === "down" ? "EASING" : "STABLE";

  const explanation =
    state === "EASING"
      ? `Headline inflation declined ${Math.abs(pp).toFixed(2)}pp to ${rate.toFixed(1)}% in the latest month.`
      : state === "RISING"
        ? `Headline inflation rose ${Math.abs(pp).toFixed(2)}pp to ${rate.toFixed(1)}% in the latest month.`
        : `Headline inflation was little changed at ${rate.toFixed(1)}% in the latest month.`;

  return {
    state,
    direction,
    sentiment,
    headline: HEADLINE[state],
    explanation,
    historicalNote: describeTwelveMonthContext(input.history, "Inflation", "%"),
    currentValue: rate,
    previousValue: priorRate,
    observationDate,
    freshness,
  };
}
