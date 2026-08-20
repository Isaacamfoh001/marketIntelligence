// ---------------------------------------------------------------------------
// Ghana Statistical Service CPI/Inflation parsing.
//
// Source table: statsbank.statsghana.gov.gh's "cpi.px" PxWeb table
// ("Consumer Price Index (CPI) and Inflation"), under
// Macroeconomic Indicators / Prices and Inflation. Confirmed via its own
// metadata to expose three indicators: "Consumer Price Index",
// "Year-on-year inflation (%)", "Month-on-month inflation (%)" — no
// food/non-food breakdown in this table (out of scope for M5; a
// different table would be needed and isn't pursued here).
// ---------------------------------------------------------------------------

import { extractPxWebSeries, parseGssMonth, validatePxWebValue, lastDayOfUtcMonth, type JsonStat2Response } from "./gss-pxweb";
import type { ValidationError } from "../validation/index";

export interface RawCpiRow {
  periodKey: string;
  value: number | null;
}

export interface NormalisedCpiRow {
  observationDate: Date;
  value: string;
}

export interface CpiValidationResult {
  valid: NormalisedCpiRow[];
  invalid: { row: RawCpiRow; errors: string[] }[];
}

/** Extract raw (month, value) rows for one indicator from a cpi.px JSON-stat2 response. */
export function extractCpiRows(data: JsonStat2Response): RawCpiRow[] {
  return extractPxWebSeries(data, "Month");
}

const INFLATION_BOUNDS = { min: -50, max: 150 };

export function validateCpiRows(rows: RawCpiRow[]): CpiValidationResult {
  const valid: NormalisedCpiRow[] = [];
  const invalid: { row: RawCpiRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseGssMonth(row.periodKey, "period");
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const value = validatePxWebValue(row.value, "inflation_rate", INFLATION_BOUNDS);
    if (value.error) errors.push(value.error.message);

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    valid.push({ observationDate: parsedDate.date!, value: value.value! });
  }

  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// Latest-release manual entry
//
// GSS's current latest-release surface is not machine-readable (see
// gss-cpi-provider.ts file header for the full investigation): the
// homepage highlight is a banner image with no text layer, the CPI
// release page is a client-rendered SPA with no discoverable JSON API,
// and monthly bulletin PDFs have no predictable/indexed URL scheme. This
// is exactly the "public but awkward source" case CLAUDE.md's Mode B/C
// (semi-automated / manual entry) exists for — an analyst reads the
// official release and enters (reference month, headline YoY) here,
// which is validated and provenanced identically to every automated
// series, not hardcoded into UI/query code.
// ---------------------------------------------------------------------------

export interface LatestReleaseRawRow {
  referenceMonth: string; // "YYYY-MM"
  headlineYoy: number;
}

export interface LatestReleaseValidationResult {
  valid: NormalisedCpiRow[];
  invalid: { row: LatestReleaseRawRow; errors: string[] }[];
}

const REFERENCE_MONTH_RE = /^(\d{4})-(\d{2})$/;

function parseReferenceMonth(text: string, field: string = "referenceMonth"): { date: Date; error: null } | { date: null; error: ValidationError } {
  const trimmed = text.trim();
  const match = REFERENCE_MONTH_RE.exec(trimmed);
  if (!match) {
    return { date: null, error: { field, message: `${field} must be "YYYY-MM": "${trimmed}"` } };
  }
  const year = Number(match[1]);
  const month1 = Number(match[2]);
  if (month1 < 1 || month1 > 12) {
    return { date: null, error: { field, message: `${field} has an invalid month: "${trimmed}"` } };
  }
  return { date: lastDayOfUtcMonth(year, month1 - 1), error: null };
}

export function validateLatestReleaseRows(rows: LatestReleaseRawRow[]): LatestReleaseValidationResult {
  const valid: NormalisedCpiRow[] = [];
  const invalid: { row: LatestReleaseRawRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseReferenceMonth(row.referenceMonth);
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const value = validatePxWebValue(row.headlineYoy, "inflation_rate", INFLATION_BOUNDS);
    if (value.error) errors.push(value.error.message);

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    valid.push({ observationDate: parsedDate.date!, value: value.value! });
  }

  return { valid, invalid };
}
