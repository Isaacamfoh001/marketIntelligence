// ---------------------------------------------------------------------------
// Currency Pressure dimension (M8 §22) — driven by USD/GHS movement.
// Prefers the 1-month cumulative move (filters day-to-day interbank
// noise); falls back to the latest-vs-previous single observation only
// when there isn't enough history for a real 1M comparison.
// ---------------------------------------------------------------------------

import { computeDirection, sentimentFor } from "../direction";
import { computeReturn, type DatedValue } from "../returns";
import { dailyFreshness } from "../freshness";
import { unavailableResult, describeTwelveMonthContext, type IntelligenceResult, type HistoryPoint } from "./types";

export type CurrencyState = "STRENGTHENING" | "STABLE" | "WEAKENING" | "UNAVAILABLE";

/** Minimum percentage move (1M where available, else latest-vs-previous) treated as a genuine signal rather than ordinary interbank noise. */
export const FX_NOISE_BAND_PCT = 0.5;

const HEADLINE: Record<CurrencyState, string> = {
  STRENGTHENING: "Strengthening",
  STABLE: "Stable",
  WEAKENING: "Under Pressure",
  UNAVAILABLE: "Unavailable",
};

export interface FxInput {
  latest: { observationDate: Date; midRate: number } | null;
  previous: { observationDate: Date; midRate: number } | null;
  history: HistoryPoint[];
}

export function evaluateFxCondition(input: FxInput): IntelligenceResult<CurrencyState> {
  if (!input.latest) {
    return unavailableResult("UNAVAILABLE", HEADLINE.UNAVAILABLE, "No USD/GHS data has been ingested yet.");
  }

  const observationDate = input.latest.observationDate.toISOString().slice(0, 10);
  const freshness = dailyFreshness(input.latest.observationDate);
  const mid = input.latest.midRate;

  const series: DatedValue[] = input.history.map((h) => ({ date: new Date(`${h.date}T00:00:00.000Z`), value: h.value }));
  const oneMonth = computeReturn(series, "1M");

  let pct: number;
  let windowLabel: string;
  if (oneMonth) {
    pct = oneMonth.pct;
    windowLabel = "over the past month";
  } else if (input.previous) {
    pct = ((mid - input.previous.midRate) / input.previous.midRate) * 100;
    windowLabel = "in the latest observation";
  } else {
    return {
      state: "STABLE",
      direction: null,
      sentiment: "neutral",
      headline: HEADLINE.STABLE,
      explanation: `USD/GHS is ${mid.toFixed(4)} — not enough prior history to assess direction.`,
      historicalNote: null,
      currentValue: mid,
      previousValue: null,
      observationDate,
      freshness,
    };
  }

  const direction = computeDirection(pct, 0, FX_NOISE_BAND_PCT);
  const sentiment = sentimentFor(direction, "higherIsNegative"); // rising GHS/USD = cedi weaker
  const state: CurrencyState = direction === "up" ? "WEAKENING" : direction === "down" ? "STRENGTHENING" : "STABLE";

  const explanation =
    state === "WEAKENING"
      ? `The cedi weakened ${Math.abs(pct).toFixed(2)}% against the US dollar ${windowLabel}.`
      : state === "STRENGTHENING"
        ? `The cedi strengthened ${Math.abs(pct).toFixed(2)}% against the US dollar ${windowLabel}.`
        : `USD/GHS was broadly stable, moving ${Math.abs(pct).toFixed(2)}% ${windowLabel}.`;

  return {
    state,
    direction,
    sentiment,
    headline: HEADLINE[state],
    explanation,
    historicalNote: describeTwelveMonthContext(input.history, "USD/GHS", ""),
    currentValue: mid,
    previousValue: input.previous?.midRate ?? oneMonth?.comparisonValue ?? null,
    observationDate,
    freshness,
  };
}
