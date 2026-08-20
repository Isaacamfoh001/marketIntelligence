// ---------------------------------------------------------------------------
// Shared date parsing for Bank of Ghana's wpDataTables-published pages.
//
// FX, Treasury Bill Rates, and Policy Rate Trends all publish dates as
// "DD MMM YYYY" (e.g. "19 Aug 2026") — the same WordPress plugin
// rendering the same date format across pages. One parser, reused.
// ---------------------------------------------------------------------------

import type { ValidationError } from "../validation/index";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const BOG_DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;

/**
 * Parses BoG's "DD MMM YYYY" date format strictly, rejecting anything
 * that doesn't match or isn't a real calendar date. Distinct from the
 * generic YYYY-MM-DD `parseDate` in validation/index.ts because this is
 * a different external source's contract.
 */
export function parseBogDate(
  text: string,
  field: string = "observation_date",
): { date: Date; error: null } | { date: null; error: ValidationError } {
  const trimmed = text.trim();
  const match = BOG_DATE_RE.exec(trimmed);
  if (!match) {
    return { date: null, error: { field, message: `${field} must be "DD MMM YYYY": "${trimmed}"` } };
  }
  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (month === undefined) {
    return { date: null, error: { field, message: `${field} has an unrecognised month: "${trimmed}"` } };
  }

  const date = new Date(Date.UTC(year, month, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
  if (!isRealCalendarDate) {
    return { date: null, error: { field, message: `${field} is not a valid calendar date: "${trimmed}"` } };
  }
  return { date, error: null };
}
