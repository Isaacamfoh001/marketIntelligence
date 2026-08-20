// ---------------------------------------------------------------------------
// Freshness policy — cadence-aware, not a universal 24-hour rule
// (CLAUDE.md §11/§27).
//
// - DAILY (FX): business-day-aware, tolerates one business day of normal
//   publish lag before flagging STALE.
// - WEEKLY (Treasury auctions): tolerates ~10 calendar days, absorbing an
//   occasional delayed or skipped weekly auction without a false alarm.
// - MONTHLY/QUARTERLY/ANNUAL: tolerance scaled to the cadence.
// - AD_HOC (Monetary Policy Rate): event-driven, no fixed calendar
//   cadence at all. A rate that hasn't changed in months is not stale —
//   it is simply the current decision until the next MPC meeting. Never
//   flagged STALE by elapsed time; only MISSING (no data yet) applies.
// ---------------------------------------------------------------------------

export type Freshness = "CURRENT" | "STALE" | "MISSING";
export type Cadence = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "AD_HOC" | "UNKNOWN";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

/** The most recent business day at or before `date` (UTC calendar days). */
export function mostRecentBusinessDay(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  while (!isBusinessDay(d)) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Classifies a DAILY-cadence source's freshness given its latest stored
 * observation date.
 */
export function dailyFreshness(latestObservationDate: Date | null, now: Date = new Date()): Freshness {
  if (!latestObservationDate) return "MISSING";

  const expected = mostRecentBusinessDay(now);
  const allowedFloor = mostRecentBusinessDay(new Date(expected.getTime() - DAY_MS));

  return startOfUtcDay(latestObservationDate).getTime() >= allowedFloor.getTime() ? "CURRENT" : "STALE";
}

const CALENDAR_DAY_TOLERANCE: Partial<Record<Cadence, number>> = {
  WEEKLY: 10,
  MONTHLY: 45,
  QUARTERLY: 100,
  ANNUAL: 400,
  UNKNOWN: 30,
};

/**
 * General cadence-aware freshness for a source's latest observation date.
 * DAILY defers to the business-day-aware rule above. AD_HOC never goes
 * STALE from elapsed time — an event-driven series (e.g. MPR) is current
 * by definition until a new event is published.
 */
export function observationFreshness(cadence: Cadence, latestObservationDate: Date | null, now: Date = new Date()): Freshness {
  if (!latestObservationDate) return "MISSING";
  if (cadence === "DAILY") return dailyFreshness(latestObservationDate, now);
  if (cadence === "AD_HOC") return "CURRENT";

  const toleranceDays = CALENDAR_DAY_TOLERANCE[cadence] ?? CALENDAR_DAY_TOLERANCE.UNKNOWN!;
  const diffDays = Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(latestObservationDate).getTime()) / DAY_MS);
  return diffDays <= toleranceDays ? "CURRENT" : "STALE";
}
