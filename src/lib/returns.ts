// ---------------------------------------------------------------------------
// Shared returns engine — the ONE place that implements "1D/1M/YTD/1Y
// return" so Overview, Equities, and (later) Company Explorer never
// duplicate or drift from each other's definition (PROJECT.md §17,
// M6 task §18).
//
// Trading-date rule: for a comparison target that isn't itself a trading
// date (a weekend, a holiday, a day the security simply didn't trade),
// use the latest available observation ON OR BEFORE that target date.
// Never the nearest date in either direction, never interpolated, never
// the next trading day after the target. If no observation exists on or
// before the target at all, the return is unavailable — never coerced to
// 0% (CLAUDE.md: missing is not zero).
// ---------------------------------------------------------------------------

export interface DatedValue {
  date: Date;
  value: number;
}

export type ReturnWindow = "1D" | "1M" | "YTD" | "1Y";

export interface ReturnResult {
  pct: number;
  currentDate: string;
  currentValue: number;
  comparisonDate: string;
  comparisonValue: number;
}

/**
 * Maximum calendar-day gap between "current" and "prior" for a change to
 * still honestly be labeled 1D. A normal weekend is a 3-day gap
 * (Fri→Mon); a single public holiday attached to a weekend can stretch
 * that to 4. 5 days gives one day of margin beyond that without opening
 * the door to mislabeling a genuinely stale/sparse series (e.g. a
 * security that only traded twice, a month apart) as a "1D" move — see
 * M6.1 §22. Not a trading-calendar lookup (no Ghana holiday calendar
 * exists yet, per CLAUDE.md §27) — a fixed, documented, generously-sized
 * tolerance instead.
 */
export const MAX_1D_GAP_CALENDAR_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Assumes `series` is sorted ascending by date (callers pass DB query results, which already are). */
function latestOnOrBefore(series: DatedValue[], targetDate: Date): DatedValue | null {
  let result: DatedValue | null = null;
  for (const point of series) {
    if (point.date.getTime() <= targetDate.getTime()) {
      result = point;
    } else {
      break;
    }
  }
  return result;
}

function shiftDate(date: Date, window: ReturnWindow): Date {
  const d = new Date(date);
  if (window === "1D") {
    // "1D" means "the previous trading observation", not literally
    // yesterday's calendar date — handled by the caller passing the
    // second-latest point directly (see computeReturn's 1D branch).
    return d;
  }
  if (window === "1M") {
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d;
  }
  if (window === "YTD") {
    return new Date(Date.UTC(date.getUTCFullYear() - 1, 11, 31)); // prior year-end close
  }
  d.setUTCFullYear(d.getUTCFullYear() - 1); // 1Y
  return d;
}

/**
 * Computes a percentage return for `window` as of the latest point in
 * `series` (series sorted ascending by date). Returns null when there
 * isn't enough history to answer honestly — never 0%.
 *
 * 1D is defined as "vs the immediately prior stored observation" (the
 * previous trading day actually on record), not "vs exactly 24 hours
 * ago" — a calendar-day lookback would wrongly go stale over a weekend.
 * If that prior observation is more than MAX_1D_GAP_CALENDAR_DAYS away,
 * the "1D" label would be dishonest (a multi-week gap dressed up as a
 * daily move), so it returns null instead of computing a number.
 */
export function computeReturn(series: DatedValue[], window: ReturnWindow): ReturnResult | null {
  if (series.length === 0) return null;
  const current = series[series.length - 1];

  if (window === "1D") {
    if (series.length < 2) return null;
    const prior = series[series.length - 2];
    if (prior.value === 0) return null;
    const gapDays = (current.date.getTime() - prior.date.getTime()) / DAY_MS;
    if (gapDays > MAX_1D_GAP_CALENDAR_DAYS) return null;
    return {
      pct: ((current.value - prior.value) / prior.value) * 100,
      currentDate: current.date.toISOString().slice(0, 10),
      currentValue: current.value,
      comparisonDate: prior.date.toISOString().slice(0, 10),
      comparisonValue: prior.value,
    };
  }

  const target = shiftDate(current.date, window);
  const comparison = latestOnOrBefore(series, target);
  // Guard against comparing a point to itself when history starts after
  // the target (e.g. a security with 2 weeks of history has no real 1Y
  // comparison — the naive "latest on or before" would otherwise return
  // the current point itself as its own comparison).
  if (!comparison || comparison.date.getTime() >= current.date.getTime()) return null;
  if (comparison.value === 0) return null;

  return {
    pct: ((current.value - comparison.value) / comparison.value) * 100,
    currentDate: current.date.toISOString().slice(0, 10),
    currentValue: current.value,
    comparisonDate: comparison.date.toISOString().slice(0, 10),
    comparisonValue: comparison.value,
  };
}

export function computeAllReturns(series: DatedValue[]): Record<ReturnWindow, ReturnResult | null> {
  return {
    "1D": computeReturn(series, "1D"),
    "1M": computeReturn(series, "1M"),
    YTD: computeReturn(series, "YTD"),
    "1Y": computeReturn(series, "1Y"),
  };
}
