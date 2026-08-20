// ---------------------------------------------------------------------------
// Ghana Statistical Service Quarterly GDP parsing.
//
// Source table: statsbank.statsghana.gov.gh's "qgdp_p_px.px" PxWeb table
// ("Quarterly GDP Production Approach"), under Macroeconomic Indicators /
// Real Sector (GDP) / Quarterly GDP. Deliberately production-approach
// only — a separate "Quarterly GDP Expenditure Approach" table also
// exists but mixing the two into one series would conflate different
// methodologies (CLAUDE.md: never interchange incompatible conventions).
//
// The table has three dimensions: Quarter, GDP_Series (9 values,
// including "Real GDP growth rate (year-on-year %)" — the headline
// measure GSS itself leads with, confirmed by cross-checking its 2026Q1
// value of 6.4% against GSS's own public release), and Variable (32
// values — sectors; "Overall GDP" is the national headline, not a
// sector). The query pins both to a single value each, so the response
// degenerates to a plain Quarter series (see gss-pxweb.ts).
// ---------------------------------------------------------------------------

import { extractPxWebSeries, parseGssQuarter, validatePxWebValue, type JsonStat2Response } from "./gss-pxweb";

export const GDP_SERIES_YOY_GROWTH = "Real GDP growth rate (year-on-year %)";
export const GDP_VARIABLE_OVERALL = "Overall GDP";

export interface RawGdpRow {
  periodKey: string;
  value: number | null;
}

export interface NormalisedGdpRow {
  observationDate: Date;
  value: string;
}

export interface GdpValidationResult {
  valid: NormalisedGdpRow[];
  invalid: { row: RawGdpRow; errors: string[] }[];
}

/** Extract raw (quarter, value) rows from a qgdp_p_px.px JSON-stat2 response. */
export function extractGdpRows(data: JsonStat2Response): RawGdpRow[] {
  return extractPxWebSeries(data, "Quarter");
}

const GDP_GROWTH_BOUNDS = { min: -50, max: 100 };

export function validateGdpRows(rows: RawGdpRow[]): GdpValidationResult {
  const valid: NormalisedGdpRow[] = [];
  const invalid: { row: RawGdpRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseGssQuarter(row.periodKey, "quarter");
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const value = validatePxWebValue(row.value, "gdp_growth_yoy", GDP_GROWTH_BOUNDS);
    if (value.error) errors.push(value.error.message);

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    valid.push({ observationDate: parsedDate.date!, value: value.value! });
  }

  return { valid, invalid };
}
