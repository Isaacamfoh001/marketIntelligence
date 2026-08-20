// ---------------------------------------------------------------------------
// Freshness policy for DAILY-cadence sources (e.g. BoG FX).
//
// Rule: a DAILY source is CURRENT if its latest observation date is no
// older than one business day behind the most recent business day at/before
// "now" — this absorbs normal weekday publish lag (a source publishing
// today's close tomorrow morning) and normal weekends/public holidays
// without flagging them as failures. Anything older than that is STALE.
// This is intentionally simple (not a full holiday calendar) per V1 scope.
// ---------------------------------------------------------------------------

export type Freshness = "CURRENT" | "STALE" | "MISSING";

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

/**
 * Classifies a DAILY-cadence source's freshness given its latest stored
 * observation date.
 */
export function dailyFreshness(latestObservationDate: Date | null, now: Date = new Date()): Freshness {
  if (!latestObservationDate) return "MISSING";

  const expected = mostRecentBusinessDay(now);
  const allowedFloor = mostRecentBusinessDay(new Date(expected.getTime() - DAY_MS));

  const observed = new Date(
    Date.UTC(latestObservationDate.getUTCFullYear(), latestObservationDate.getUTCMonth(), latestObservationDate.getUTCDate()),
  );

  return observed.getTime() >= allowedFloor.getTime() ? "CURRENT" : "STALE";
}
