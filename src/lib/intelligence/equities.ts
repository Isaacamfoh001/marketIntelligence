// ---------------------------------------------------------------------------
// Equity Momentum dimension (M8 §22) plus simple market-breadth (M8 §34).
//
// Only ever activates when the GSE-CI index actually has stored
// observations — a market with zero imported price history has no
// momentum to report, and must say so rather than default to NEUTRAL
// (M8 §39: "Missing ≠ neutral").
//
// MONTHLY cadence (M8.1): GSE-CI history in this system is month-end
// snapshots transcribed from GSE's official monthly Market Summary PDF
// reports, not a live daily feed. Freshness is evaluated against a
// monthly tolerance so a current month-end figure reads CURRENT rather
// than STALE — this deliberately does not fake daily momentum.
// ---------------------------------------------------------------------------

import { computeDirection, sentimentFor } from "../direction";
import { computeReturn, type DatedValue } from "../returns";
import { observationFreshness } from "../freshness";
import { unavailableResult, describeTwelveMonthContext, type IntelligenceResult, type HistoryPoint } from "./types";
import type { RankableSecurity } from "../rankings";

export type EquityMomentumState = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNAVAILABLE";

/** Minimum 1M (or YTD fallback) percentage move treated as real momentum rather than ordinary index noise. */
export const EQUITY_NOISE_BAND_PCT = 1.0;

const HEADLINE: Record<EquityMomentumState, string> = {
  POSITIVE: "Positive",
  NEUTRAL: "Neutral",
  NEGATIVE: "Negative",
  UNAVAILABLE: "Unavailable",
};

export interface EquityMomentumInput {
  latest: { observationDate: Date; level: number } | null;
  history: HistoryPoint[];
}

export function evaluateEquityMomentumCondition(input: EquityMomentumInput): IntelligenceResult<EquityMomentumState> {
  if (!input.latest || input.history.length === 0) {
    return unavailableResult("UNAVAILABLE", "Awaiting GSE market data", "No GSE Composite Index data has been imported yet.");
  }

  const observationDate = input.latest.observationDate.toISOString().slice(0, 10);
  const freshness = observationFreshness("MONTHLY", input.latest.observationDate);
  const series: DatedValue[] = input.history.map((h) => ({ date: new Date(`${h.date}T00:00:00.000Z`), value: h.value }));

  const oneMonth = computeReturn(series, "1M");
  const ytd = computeReturn(series, "YTD");
  const primary = oneMonth ?? ytd;

  if (!primary) {
    return {
      state: "NEUTRAL",
      direction: null,
      sentiment: "neutral",
      headline: HEADLINE.NEUTRAL,
      explanation: `GSE-CI is ${input.latest.level.toLocaleString("en-GH", { maximumFractionDigits: 2 })} — not enough history yet for a 1-month or YTD trend.`,
      historicalNote: null,
      currentValue: input.latest.level,
      previousValue: null,
      observationDate,
      freshness,
    };
  }

  const windowLabel = oneMonth ? "over the past month" : "year-to-date";
  const direction = computeDirection(primary.pct, 0, EQUITY_NOISE_BAND_PCT);
  const sentiment = sentimentFor(direction, "higherIsPositive");
  const state: EquityMomentumState = direction === "up" ? "POSITIVE" : direction === "down" ? "NEGATIVE" : "NEUTRAL";

  const explanation =
    state === "POSITIVE"
      ? `GSE-CI rose ${Math.abs(primary.pct).toFixed(2)}% ${windowLabel}.`
      : state === "NEGATIVE"
        ? `GSE-CI fell ${Math.abs(primary.pct).toFixed(2)}% ${windowLabel}.`
        : `GSE-CI was broadly flat, moving ${Math.abs(primary.pct).toFixed(2)}% ${windowLabel}.`;

  return {
    state,
    direction,
    sentiment,
    headline: HEADLINE[state],
    explanation,
    historicalNote: describeTwelveMonthContext(input.history, "GSE-CI", " pts", 0),
    currentValue: input.latest.level,
    previousValue: primary.comparisonValue,
    observationDate,
    freshness,
  };
}

// ---------------------------------------------------------------------------
// Market breadth (M8 §34) — advancers/decliners/unchanged by 1D return,
// same trading-date rule as Top Gainers/Losers (returns.ts), so breadth
// never counts a security whose "1D" comparison would actually span a
// multi-week gap as if it traded today.
// ---------------------------------------------------------------------------

export interface MarketBreadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  total: number;
}

const FLAT_EPSILON = 1e-9;

/** Null when zero securities have a computable 1D return — never fabricates a 0/0/0 breadth reading for an empty/stale dataset. */
export function computeMarketBreadth(securities: RankableSecurity[]): MarketBreadth | null {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;

  for (const sec of securities) {
    const oneDay = computeReturn(sec.priceHistory, "1D");
    if (!oneDay) continue;
    if (oneDay.pct > FLAT_EPSILON) advancers++;
    else if (oneDay.pct < -FLAT_EPSILON) decliners++;
    else unchanged++;
  }

  const total = advancers + decliners + unchanged;
  if (total === 0) return null;
  return { advancers, decliners, unchanged, total };
}
