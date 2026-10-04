// ---------------------------------------------------------------------------
// Security lifecycle — Active / Maturing Soon / Matured (M7.3 §4).
//
// Derived purely from the contractual maturity date versus the valuation
// date, never from the stored `status` column: the GFIM securities master
// is a point-in-time transcription whose `status` stays "ACTIVE" for rows
// that have since passed maturity, so trusting it would put matured
// instruments in the default investable universe.
//
// Matured securities are never deleted or hidden from research — they are
// simply excluded from the DEFAULT (investable) view.
// ---------------------------------------------------------------------------

import { daysBetween } from "./cashflow";

export type SecurityLifecycle = "ACTIVE" | "MATURING_SOON" | "MATURED";

/**
 * A security redeeming within this many calendar days is "Maturing Soon".
 * 91 days is the shortest Ghana sovereign tenor (the 91-day Treasury bill):
 * inside that window a bond's remaining life is shorter than the shortest
 * government instrument it would be benchmarked against, and its return
 * becomes highly sensitive to purchase price (M7.3 §12). A fixed,
 * documented threshold — not tuned to the current data.
 */
export const MATURING_SOON_DAYS = 91;

export const LIFECYCLE_LABEL: Record<SecurityLifecycle, string> = {
  ACTIVE: "Active",
  MATURING_SOON: "Maturing Soon",
  MATURED: "Matured",
};

export function classifyLifecycle(maturityDate: Date, valuationDate: Date): SecurityLifecycle {
  const days = daysBetween(valuationDate, maturityDate);
  if (days <= 0) return "MATURED";
  if (days <= MATURING_SOON_DAYS) return "MATURING_SOON";
  return "ACTIVE";
}

/** True for both ACTIVE and MATURING_SOON — a security still outstanding (has remaining cash flows) at the valuation date. */
export function isOutstanding(lifecycle: SecurityLifecycle): boolean {
  return lifecycle !== "MATURED";
}

/**
 * Normalises an instant to its UTC calendar day — the valuation/settlement
 * date every scenario calculation is "as of". Using a raw `new Date()`
 * (with a time-of-day component) would make accrued-interest day counts
 * depend on the hour the page was rendered.
 */
export function toValuationDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Whole calendar days between an observation date and the valuation date (0 = observed on the valuation date). */
export function observationAgeDays(observationDateIso: string | null, valuationDate: Date): number | null {
  if (!observationDateIso) return null;
  return Math.max(0, daysBetween(new Date(`${observationDateIso}T00:00:00.000Z`), valuationDate));
}
