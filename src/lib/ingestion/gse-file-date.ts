// ---------------------------------------------------------------------------
// Date parsing for GSE manual-import files.
//
// Unlike a single scraped page with one fixed date format, an import file
// here may come from Korbly's own documented CSV template (YYYY-MM-DD) or
// from a spreadsheet a human exported/re-typed from an official GSE
// report, which could plausibly be DD/MM/YYYY (Ghana's everyday date
// convention) or "DD MMM YYYY" (matching BoG's own published format,
// which staff are already used to importing). All three are accepted;
// anything else is rejected rather than guessed.
// ---------------------------------------------------------------------------

import type { ValidationError } from "../validation/index";
import { parseDate as parseIsoDate } from "../validation/index";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
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

const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TEXT_MONTH_DATE_RE = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/;

export function parseGseFileDate(text: string, field: string = "trading_date"): DateResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { date: null, error: { field, message: `${field} is required` } };
  }

  const iso = parseIsoDate(trimmed, field);
  if (!iso.error) return iso;

  const slash = SLASH_DATE_RE.exec(trimmed);
  if (slash) {
    // Ghana convention: DD/MM/YYYY, not US MM/DD/YYYY.
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = Number(slash[3]);
    return fromParts(year, month, day, field, trimmed);
  }

  const textMonth = TEXT_MONTH_DATE_RE.exec(trimmed);
  if (textMonth) {
    const day = Number(textMonth[1]);
    const monthKey = textMonth[2].slice(0, 3).toLowerCase();
    const month = MONTHS[monthKey];
    const year = Number(textMonth[3]);
    if (month === undefined) {
      return { date: null, error: { field, message: `${field} has an unrecognised month: "${trimmed}"` } };
    }
    return fromParts(year, month, day, field, trimmed);
  }

  return {
    date: null,
    error: { field, message: `${field} must be YYYY-MM-DD, DD/MM/YYYY, or "DD MMM YYYY": "${trimmed}"` },
  };
}
