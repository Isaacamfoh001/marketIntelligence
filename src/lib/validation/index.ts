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

export function parseDate(
  value: unknown,
  field: string,
): { date: Date; error: null } | { date: null; error: ValidationError } {
  if (value === null || value === undefined || value === "") {
    return { date: null, error: { field, message: `${field} is required` } };
  }
  const str = String(value).trim();
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    return { date: null, error: { field, message: `${field} is not a valid date: "${str}"` } };
  }
  return { date: d, error: null };
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
