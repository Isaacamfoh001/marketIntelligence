// ---------------------------------------------------------------------------
// Shared date parsing for Bank of Ghana's published pages.
//
// FX, Treasury Bill Rates, and Policy Rate Trends all publish dates as
// "DD MMM YYYY" (e.g. "19 Aug 2026") — the same WordPress plugin
// rendering the same date format across pages. One parser, reused.
//
// The MPC Press Release archive (a different, non-wpDataTables widget on
// bog.gov.gh) uses a different format, "Month D, YYYY" (e.g.
// "July 22, 2026") — parsed separately below since it isn't the same
// contract, just coincidentally the same source domain.
// ---------------------------------------------------------------------------

import type { ValidationError } from "../validation/index";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const FULL_MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

type DateResult = { date: Date; error: null } | { date: null; error: ValidationError };

function fromParts(year: number, month: number, day: number, field: string, trimmed: string): DateResult {
  const date = new Date(Date.UTC(year, month, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
  if (!isRealCalendarDate) {
    return { date: null, error: { field, message: `${field} is not a valid calendar date: "${trimmed}"` } };
  }
  return { date, error: null };
}

const BOG_DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;

/**
 * Parses BoG's "DD MMM YYYY" date format strictly, rejecting anything
 * that doesn't match or isn't a real calendar date. Distinct from the
 * generic YYYY-MM-DD `parseDate` in validation/index.ts because this is
 * a different external source's contract.
 */
export function parseBogDate(text: string, field: string = "observation_date"): DateResult {
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
  return fromParts(year, month, day, field, trimmed);
}

const BOG_LONG_DATE_RE = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/;

/**
 * Parses the MPC Press Release archive's "Month D, YYYY" date format
 * (e.g. "July 22, 2026") strictly.
 */
export function parseBogLongDate(text: string, field: string = "date"): DateResult {
  const trimmed = text.trim();
  const match = BOG_LONG_DATE_RE.exec(trimmed);
  if (!match) {
    return { date: null, error: { field, message: `${field} must be "Month D, YYYY": "${trimmed}"` } };
  }
  const month = FULL_MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month === undefined) {
    return { date: null, error: { field, message: `${field} has an unrecognised month: "${trimmed}"` } };
  }
  return fromParts(year, month, day, field, trimmed);
}
