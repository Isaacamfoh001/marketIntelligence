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

import { extractPxWebSeries, parseGssMonth, validatePxWebValue, type JsonStat2Response } from "./gss-pxweb";

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
