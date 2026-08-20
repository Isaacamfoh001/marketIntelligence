// ---------------------------------------------------------------------------
// Shared parsing for Ghana Statistical Service StatsBank/PxWeb responses.
//
// Source mechanism: statsbank.statsghana.gov.gh runs the standard,
// documented open-source PxWeb platform (the same software Statistics
// Sweden, Statistics Norway, Statistics Finland, and many other national
// statistics offices publish through). Verified directly:
//   GET  /api/v1/en/                          -> list of databases (JSON)
//   GET  /api/v1/en/<path>/<table>.px         -> table metadata (variables)
//   POST /api/v1/en/<path>/<table>.px         -> query results (JSON-stat2)
// This is PxWeb's standard query API, not a discovered/undocumented
// endpoint — it's the mechanism the PxWeb software itself documents and
// the GSS website's own browsable UI is built on top of.
// ---------------------------------------------------------------------------

import type { ValidationError } from "../validation/index";

// ---------------------------------------------------------------------------
// JSON-stat2 extraction
// ---------------------------------------------------------------------------

export interface JsonStat2Response {
  dimension: Record<string, { category: { index: Record<string, number> } }>;
  value: (number | null)[];
}

export interface PxWebSeriesPoint {
  periodKey: string;
  value: number | null;
}

/**
 * Extracts (period, value) pairs from a JSON-stat2 response along one
 * dimension. Uses `category.index` (the period-key -> array-position
 * map), not `category.label` — index is what actually determines which
 * slot in the flat `value` array belongs to which period.
 *
 * Only safe when every other dimension in the query was filtered to
 * exactly one value (as every provider in this file does) — PxWeb
 * flattens multi-dimensional results in dimension order, and a query
 * with all-but-one dimensions pinned to a single value degenerates to a
 * 1:1 mapping between the remaining dimension's position and the value
 * array's index.
 */
export function extractPxWebSeries(data: JsonStat2Response, periodDimensionCode: string): PxWebSeriesPoint[] {
  const dim = data.dimension[periodDimensionCode];
  if (!dim) return [];

  return Object.entries(dim.category.index)
    .sort((a, b) => a[1] - b[1])
    .map(([periodKey, position]) => ({ periodKey, value: data.value[position] ?? null }));
}

// ---------------------------------------------------------------------------
// Period parsing
// ---------------------------------------------------------------------------

export type DateResult = { date: Date; error: null } | { date: null; error: ValidationError };

export function lastDayOfUtcMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0 + 1, 0));
}

const MONTH_PERIOD_RE = /^(\d{4})M(\d{2})$/;

/**
 * Parses PxWeb's "YYYYMdd" month key (e.g. "2026M01") into the
 * observation date used for CPI series: the LAST day of the reference
 * month (e.g. 2026-01-31). End-of-period dating (not start-of-period)
 * is used so freshness tolerance measures elapsed time the same way
 * GSS's own publish cadence does (data for month M releases early in
 * month M+1, i.e. shortly after the month *ends*).
 */
export function parseGssMonth(text: string, field: string = "period"): DateResult {
  const trimmed = text.trim();
  const match = MONTH_PERIOD_RE.exec(trimmed);
  if (!match) {
    return { date: null, error: { field, message: `${field} must be "YYYYMmm": "${trimmed}"` } };
  }
  const year = Number(match[1]);
  const month1 = Number(match[2]);
  if (month1 < 1 || month1 > 12) {
    return { date: null, error: { field, message: `${field} has an invalid month: "${trimmed}"` } };
  }
  return { date: lastDayOfUtcMonth(year, month1 - 1), error: null };
}

const QUARTER_PERIOD_RE = /^(\d{4})Q([1-4])$/;
const QUARTER_END_MONTH0: Record<number, number> = { 1: 2, 2: 5, 3: 8, 4: 11 }; // Mar, Jun, Sep, Dec (0-indexed)

/**
 * Parses PxWeb's "YYYYQn" quarter key (e.g. "2026Q1") into the
 * observation date used for GDP series: the LAST day of the reference
 * quarter (e.g. 2026-03-31) — same end-of-period reasoning as CPI, and
 * matching how GSS itself reports a quarterly result (dated to the
 * quarter it describes, not when it was published).
 */
export function parseGssQuarter(text: string, field: string = "period"): DateResult {
  const trimmed = text.trim();
  const match = QUARTER_PERIOD_RE.exec(trimmed);
  if (!match) {
    return { date: null, error: { field, message: `${field} must be "YYYYQn": "${trimmed}"` } };
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  return { date: lastDayOfUtcMonth(year, QUARTER_END_MONTH0[quarter]), error: null };
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

/**
 * Validates a PxWeb numeric value within a broad plausibility bound.
 * Bounds are intentionally wide (not tuned to current values) — Ghana's
 * actual historical series include double-digit swings in both
 * directions (e.g. -5.6% GDP growth in 2020Q2, 25%+ inflation in past
 * regimes) that a narrow bound would wrongly reject.
 */
export function validatePxWebValue(
  value: number | null,
  field: string,
  bounds: { min: number; max: number },
): { value: string; error: null } | { value: null; error: ValidationError } {
  if (value === null) {
    return { value: null, error: { field, message: `${field} is missing (not published for this period)` } };
  }
  if (!Number.isFinite(value)) {
    return { value: null, error: { field, message: `${field} is not a finite number: ${value}` } };
  }
  if (value < bounds.min || value > bounds.max) {
    return { value: null, error: { field, message: `${field} is outside a plausible range: ${value}` } };
  }
  return { value: String(value), error: null };
}
