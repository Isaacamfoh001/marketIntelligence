// ---------------------------------------------------------------------------
// Shared result shape for every explainable-market-intelligence dimension
// (M8 §20-26, §43). Every dimension evaluator in this directory returns
// this same shape so the UI (Overview's Market Condition section, Macro &
// Rates condition badges, Equities intelligence) never has to special-case
// one dimension's output format against another's.
//
// Deliberately NOT persisted to the database this milestone: every input
// (inflation, FX, rates, equities) is already a real, source-attributed
// observation in Postgres, so this layer is a pure, deterministic
// recomputation over that data on each request — the same pattern the
// ratios/returns engines already use (CLAUDE.md §27: correctness first,
// no premature infrastructure). Nothing here invents a number; every
// `state` traces back to `currentValue`/`previousValue`, which trace back
// to a real MacroObservation/ExchangeRate/TreasuryRate/PolicyDecision/
// MarketIndexObservation row.
// ---------------------------------------------------------------------------

import type { Direction, Sentiment } from "../direction";
import type { Freshness } from "../freshness";

/** Every dimension's state vocabulary ends in this shared "no usable data" member — never silently substituted with a neutral-looking state (M8 §39: "Missing ≠ neutral"). */
export type Unavailable = "UNAVAILABLE";

export interface IntelligenceResult<TState extends string> {
  state: TState;
  direction: Direction | null;
  sentiment: Sentiment;
  /** Short label for compact display, e.g. "Easing", "Under Pressure", "Unavailable". */
  headline: string;
  /** One deterministic, template-assembled sentence — never LLM-generated (M8 §28/§52). */
  explanation: string;
  /** Optional second sentence of stored-history context (M8 §32), e.g. "Inflation is below its 12-month average." Null when there isn't enough history to say anything honest. */
  historicalNote: string | null;
  currentValue: number | null;
  previousValue: number | null;
  observationDate: string | null;
  freshness: Freshness;
}

/** A dimension that has no data at all — the one shared "empty" constructor every evaluator falls back to, so "UNAVAILABLE" always looks the same shape. */
export function unavailableResult<TState extends string>(state: TState, headline: string, explanation: string): IntelligenceResult<TState> {
  return {
    state,
    direction: null,
    sentiment: "neutral",
    headline,
    explanation,
    historicalNote: null,
    currentValue: null,
    previousValue: null,
    observationDate: null,
    freshness: "MISSING",
  };
}

/**
 * A dimension counts toward the overall synthesis only when its freshness
 * is CURRENT — a STALE or MISSING dimension is excluded from the combined
 * read (M8 §40/§41), though it still renders its own card so the analyst
 * can see *why* it's excluded rather than have it silently disappear.
 */
export function isEligibleForSynthesis(result: IntelligenceResult<string>): boolean {
  return result.freshness === "CURRENT";
}

// ---------------------------------------------------------------------------
// Historical context helper (M8 §32) — shared by every dimension that has
// a `history: {date, value}[]` series available.
// ---------------------------------------------------------------------------

export interface HistoryPoint {
  date: string;
  value: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Trailing ~12-month average/min/max as of the latest point in `history`
 * (ascending by date). Requires at least 3 points within the window to
 * say anything — a 2-point "average" would be a misleading rounding of
 * "the other data point", and the note would read like a computed insight
 * when it's really just restating the prior observation.
 */
export function describeTwelveMonthContext(history: HistoryPoint[], label: string, unitSuffix: string, decimals: number = 1): string | null {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const latestDate = new Date(`${latest.date}T00:00:00.000Z`).getTime();
  const windowStart = latestDate - YEAR_MS;
  const windowed = history.filter((p) => new Date(`${p.date}T00:00:00.000Z`).getTime() >= windowStart);
  if (windowed.length < 3) return null;

  const values = windowed.map((p) => p.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);

  // "Near its 12-month high/low" — within 2% of the trailing extreme,
  // measured relative to the window's own range so it works whether the
  // series is a 0-30 index or a 5000-point one. A flat series (max===min)
  // has no meaningful "near the edge" to report.
  const range = max - min;
  if (range > 0) {
    if (latest.value >= max - range * 0.02) return `${label} is near its 12-month high.`;
    if (latest.value <= min + range * 0.02) return `${label} is near its 12-month low.`;
  }

  const deltaFromAvg = latest.value - avg;
  if (Math.abs(deltaFromAvg) < range * 0.05) return null; // too close to average to say anything useful
  return deltaFromAvg > 0
    ? `${label} is above its 12-month average of ${avg.toFixed(decimals)}${unitSuffix}.`
    : `${label} is below its 12-month average of ${avg.toFixed(decimals)}${unitSuffix}.`;
}
