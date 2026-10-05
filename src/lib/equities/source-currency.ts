// ---------------------------------------------------------------------------
// GSE equity data currency — two separate questions that must never be
// conflated (Data Reliability Sprint):
//
//   A. SOURCE currency  — has Korbly ingested the latest GSE report it can
//      reasonably have? (a pipeline question)
//   B. SECURITY trade recency — when did THIS security last actually trade?
//      (a market question; an illiquid stock can be 18 days stale inside a
//      perfectly healthy pipeline)
//
// Vocabulary (kept consistent with M8.1's equity-input.ts):
//   report date      = SecurityPrice.tradingDate: the date GSE's daily report
//                      is stamped with. GSE prints a row for EVERY listed
//                      share on EVERY report date.
//   actual trade     = a row with volume > 0. Only then is closeVwap a price
//                      discovered on that date.
//   carried row      = volume = 0. closeVwap is the previous close re-printed
//                      (verified 8,352 of 8,353 such rows): not a market
//                      observation, never a new trade date.
//   unknown volume   = volume null. Establishes nothing.
//
// No market calendar is modelled (Ghana holidays are not in the data), so
// "behind" is counted in plain weekdays and the CURRENT/STALE call reuses the
// repo's existing business-day-aware DAILY rule (one weekday of publish lag
// tolerated). A public holiday can therefore produce a short-lived STALE; that
// is stated, not hidden.
// ---------------------------------------------------------------------------

import { dailyFreshness, isBusinessDay } from "../freshness";
import { EQUITY_RECENT_WINDOW_DAYS } from "../portfolio/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type EquitySourceState =
  /** Latest report is as recent as Korbly could reasonably hold. */
  | "CURRENT"
  /** Korbly's newest GSE report is older than it should be: ingestion is behind. */
  | "STALE"
  /** No GSE equity report has ever been ingested. */
  | "MISSING";

export interface EquitySourceRunInfo {
  status: "SUCCESS" | "FAILED" | "RUNNING" | "PENDING";
  at: Date;
}

export interface EquitySourceCurrency {
  state: EquitySourceState;
  latestReportDate: string | null;
  /** Weekdays between the latest report date and today (0 = report is for today / latest weekday). null when MISSING. */
  weekdaysBehind: number | null;
  /** The most recent import attempt failed AFTER the last success — the data did not refresh and the failure is known. */
  lastRefreshFailed: boolean;
}

export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole weekdays strictly after `from` up to and including `to` (Mon–Fri). Negative spans return 0. */
export function weekdaysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  let n = 0;
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) if (isBusinessDay(new Date(t))) n++;
  return n;
}

export function classifyEquitySource(input: {
  latestReportDate: string | null;
  now: Date;
  /** Runs for the GSE security sources, newest first is NOT required. */
  runs?: EquitySourceRunInfo[];
}): EquitySourceCurrency {
  const runs = input.runs ?? [];
  const lastSuccess = runs.filter((r) => r.status === "SUCCESS").sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const lastFailure = runs.filter((r) => r.status === "FAILED").sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const lastRefreshFailed = !!lastFailure && (!lastSuccess || lastFailure.at.getTime() > lastSuccess.at.getTime());

  if (!input.latestReportDate) {
    return { state: "MISSING", latestReportDate: null, weekdaysBehind: null, lastRefreshFailed };
  }
  const today = toIsoDay(input.now);
  const freshness = dailyFreshness(new Date(`${input.latestReportDate}T00:00:00Z`), input.now);
  return {
    state: freshness === "CURRENT" ? "CURRENT" : "STALE",
    latestReportDate: input.latestReportDate,
    weekdaysBehind: weekdaysBetween(input.latestReportDate, today),
    lastRefreshFailed,
  };
}

// ---------------------------------------------------------------------------
// Security-level trade recency + the combined product state
// ---------------------------------------------------------------------------

export type SecurityTradeRecency = "RECENT" | "STALE" | "NONE";

/** Trade age is measured against `now`, exactly as M8.1 measures it (EQUITY_RECENT_WINDOW_DAYS calendar days). */
export function classifySecurityTrade(lastTradeDate: string | null, now: Date): { recency: SecurityTradeRecency; ageDays: number | null } {
  if (!lastTradeDate) return { recency: "NONE", ageDays: null };
  const ageDays = Math.max(0, Math.floor((Date.parse(`${toIsoDay(now)}T00:00:00Z`) - Date.parse(`${lastTradeDate}T00:00:00Z`)) / DAY_MS));
  return { recency: ageDays <= EQUITY_RECENT_WINDOW_DAYS ? "RECENT" : "STALE", ageDays };
}

export type EquityDataStateCode =
  | "SOURCE_CURRENT_RECENT_TRADE"
  | "SOURCE_CURRENT_STALE_TRADE"
  | "SOURCE_STALE"
  | "NO_RELIABLE_TRADE"
  | "SOURCE_MISSING";

export interface EquityDataState {
  code: EquityDataStateCode;
  headline: string;
}

function fmt(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The deterministic product state for one security. Precedence matters:
 * a stale SOURCE outranks everything (we cannot say what the market did since),
 * then "never traded", then the security's own recency.
 */
export function describeEquityDataState(source: EquitySourceCurrency, lastTradeDate: string | null, now: Date): EquityDataState {
  if (source.state === "MISSING") {
    return { code: "SOURCE_MISSING", headline: "No GSE market data has been imported." };
  }
  const trade = classifySecurityTrade(lastTradeDate, now);
  if (source.state === "STALE") {
    const tail = lastTradeDate ? ` This security's last recorded trade is ${fmt(lastTradeDate)}.` : "";
    return { code: "SOURCE_STALE", headline: `Korbly's latest GSE market data is from ${fmt(source.latestReportDate!)}.${tail}` };
  }
  if (trade.recency === "NONE") {
    return { code: "NO_RELIABLE_TRADE", headline: "Latest GSE data is current, but no actual trade is recorded for this security." };
  }
  if (trade.recency === "STALE") {
    return {
      code: "SOURCE_CURRENT_STALE_TRADE",
      headline: `Latest GSE data is current, but this security has not traded for ${trade.ageDays} days (last trade ${fmt(lastTradeDate!)}).`,
    };
  }
  return {
    code: "SOURCE_CURRENT_RECENT_TRADE",
    headline: `Latest GSE data is current. This security last traded ${trade.ageDays === 0 ? "today" : `${trade.ageDays} day${trade.ageDays === 1 ? "" : "s"} ago`} (${fmt(lastTradeDate!)}).`,
  };
}
