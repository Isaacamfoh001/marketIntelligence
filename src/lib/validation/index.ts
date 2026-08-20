// ---------------------------------------------------------------------------
// Validation utilities for row-oriented ingestion.
//
// Keep intentionally lightweight — no external framework.
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult<T> {
  valid: T[];
  invalid: { row: unknown; errors: ValidationError[] }[];
}

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

export function requireString(
  value: unknown,
  field: string,
): ValidationError | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return { field, message: `${field} is required` };
  }
  return null;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a date strictly as YYYY-MM-DD. Rejects any other format
 * (e.g. "02/13/2026", "Feb 1 2026") since those are ambiguous or
 * locale-dependent under permissive `new Date(str)` parsing, and
 * rejects out-of-range calendar dates (e.g. "2026-02-30").
 */
export function parseDate(
  value: unknown,
  field: string,
): { date: Date; error: null } | { date: null; error: ValidationError } {
  if (value === null || value === undefined || value === "") {
    return { date: null, error: { field, message: `${field} is required` } };
  }
  const str = String(value).trim();
  const match = ISO_DATE_RE.exec(str);
  if (!match) {
    return {
      date: null,
      error: { field, message: `${field} must be in YYYY-MM-DD format: "${str}"` },
    };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isRealCalendarDate) {
    return {
      date: null,
      error: { field, message: `${field} is not a valid calendar date: "${str}"` },
    };
  }
  return { date, error: null };
}

export function parseDecimal(
  value: unknown,
  field: string,
): { value: string; error: null } | { value: null; error: ValidationError } {
  if (value === null || value === undefined || value === "") {
    return { value: null, error: { field, message: `${field} is required` } };
  }
  const str = String(value).trim();
  // Accept commas as thousands separators
  const normalised = str.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) {
    return { value: null, error: { field, message: `${field} is not a valid number: "${str}"` } };
  }
  return { value: normalised, error: null };
}

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------

type ValidatorFn<T> = (row: Record<string, unknown>) => T | null;
type ErrorCollector = (row: Record<string, unknown>) => ValidationError[];

export function validateRows<T>(
  rows: Record<string, unknown>[],
  validate: ValidatorFn<T>,
  collectErrors: ErrorCollector,
): ValidationResult<T> {
  const valid: T[] = [];
  const invalid: { row: unknown; errors: ValidationError[] }[] = [];

  for (const row of rows) {
    const errors = collectErrors(row);
    if (errors.length > 0) {
      invalid.push({ row, errors });
    } else {
      const normalised = validate(row);
      if (normalised !== null) {
        valid.push(normalised);
      }
    }
  }

  return { valid, invalid };
}
