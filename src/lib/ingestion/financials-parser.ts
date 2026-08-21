// ---------------------------------------------------------------------------
// Company Financials — manual/semi-automated import parser (M7, revised M7.1).
//
// Long-format template (CLAUDE.md/M7 §17): one row = one metric value for
// one company/period, so an arbitrary set of metrics can be supplied
// without ever needing a schema/template change. Column contract mirrors
// the GSE import parsers' pattern: canonical snake_case headers, plus
// aliases for the human-readable labels a spreadsheet built from a real
// statement is likely to use.
//
// M7.1 §17: a single `period` column (ANNUAL/FY, Q1-Q4, H1, H2, 9M) — not
// M7's original two-column periodType+fiscalQuarter pair — so there is no
// numeric convention to misinterpret and no ambiguous bare digit ("1"
// could have meant Q1 or H1); every accepted token names the period shape
// directly. See financials-provider.ts / schema.prisma for the same fix
// on the persisted model.
//
// PDF is not parsed here — see financials-provider.ts header for why.
// ---------------------------------------------------------------------------

import { parseDecimal } from "../validation/index";
import { parseGseFileDate } from "./gse-file-date";
import { findHeader, normalizeHeader, type ParsedFile } from "./file-parse";
import { resolveMetricCode, FINANCIAL_METRICS, VALID_METRIC_UNITS, type MetricUnit } from "../financial-metrics";

const FIELD_ALIASES: Record<string, string[]> = {
  ticker: ["ticker", "share code", "symbol"],
  period: ["period", "fiscal period", "period type", "reporting period"],
  fiscal_year: ["fiscal year", "year"],
  period_start: ["period start", "start date"],
  period_end: ["period end", "end date"],
  metric: ["metric", "line item"],
  value: ["value", "amount"],
  currency: ["currency"],
  unit: ["unit"],
  audited: ["audited"],
  statement_scope: ["statement scope", "statement type", "scope"],
};

export interface RawFinancialRow {
  [field: string]: string | undefined;
}

export type FiscalPeriod = "ANNUAL" | "Q1" | "Q2" | "Q3" | "Q4" | "H1" | "H2" | "NINE_MONTH";
export type StatementScope = "CONSOLIDATED" | "SEPARATE";

export const INTERIM_PERIODS: FiscalPeriod[] = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "NINE_MONTH"];

export interface NormalisedFinancialRow {
  ticker: string;
  period: FiscalPeriod;
  fiscalYear: number;
  periodStart: Date;
  periodEnd: Date;
  metricCode: string;
  value: string;
  currency: string;
  unit: MetricUnit;
  audited: boolean | null;
  statementScope: StatementScope;
}

export function mapFinancialColumns(rawHeaders: string[]): Record<string, string | null> {
  const normalized = rawHeaders.map(normalizeHeader);
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    mapping[field] = findHeader(normalized, aliases);
  }
  return mapping;
}

export function extractFinancialRows(file: ParsedFile): RawFinancialRow[] {
  const columnByField = mapFinancialColumns(file.rawHeaders);
  return file.rows.map((row) => {
    const out: RawFinancialRow = {};
    for (const [field, headerKey] of Object.entries(columnByField)) {
      out[field] = headerKey ? row[headerKey] : undefined;
    }
    return out;
  });
}

export interface FinancialValidationResult {
  valid: NormalisedFinancialRow[];
  invalid: { row: RawFinancialRow; errors: string[]; rowNumber: number }[];
}

const TICKER_RE = /^[A-Z0-9.]{1,15}$/;

const PERIOD_ALIASES: Record<string, FiscalPeriod> = {
  "ANNUAL": "ANNUAL",
  "FY": "ANNUAL",
  "FULL YEAR": "ANNUAL",
  "Q1": "Q1", "QUARTER 1": "Q1",
  "Q2": "Q2", "QUARTER 2": "Q2",
  "Q3": "Q3", "QUARTER 3": "Q3",
  "Q4": "Q4", "QUARTER 4": "Q4",
  "H1": "H1", "HALF 1": "H1", "FIRST HALF": "H1",
  "H2": "H2", "HALF 2": "H2", "SECOND HALF": "H2",
  "9M": "NINE_MONTH", "NM": "NINE_MONTH", "NINE MONTH": "NINE_MONTH", "NINE MONTHS": "NINE_MONTH",
};
const PERIOD_ALLOWED_LIST = "ANNUAL/FY, Q1, Q2, Q3, Q4, H1, H2, or 9M/NINE_MONTH";

const SCOPE_ALIASES: Record<string, StatementScope> = {
  CONSOLIDATED: "CONSOLIDATED",
  GROUP: "CONSOLIDATED",
  SEPARATE: "SEPARATE",
  PARENT: "SEPARATE",
  BANK: "SEPARATE",
  COMPANY: "SEPARATE",
};
const AUDITED_TRUE = new Set(["TRUE", "AUDITED", "YES", "1"]);
const AUDITED_FALSE = new Set(["FALSE", "UNAUDITED", "NO", "0"]);

function normalizeToken(text: string): string {
  return text.trim().toUpperCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function parsePeriod(raw: string | undefined, errors: string[]): FiscalPeriod | null {
  const token = normalizeToken(raw ?? "");
  if (token === "") {
    errors.push("period is required");
    return null;
  }
  const resolved = PERIOD_ALIASES[token];
  if (!resolved) {
    errors.push(`period must be one of ${PERIOD_ALLOWED_LIST}: "${raw}"`);
    return null;
  }
  return resolved;
}

function parseFiscalYear(raw: string | undefined, errors: string[]): number | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    errors.push("fiscal_year is required");
    return null;
  }
  const year = Number(trimmed);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    errors.push(`fiscal_year is not plausible: "${raw}"`);
    return null;
  }
  return year;
}

function parseAudited(raw: string | undefined, errors: string[]): boolean | null {
  const token = normalizeToken(raw ?? "");
  if (token === "") return null;
  if (AUDITED_TRUE.has(token)) return true;
  if (AUDITED_FALSE.has(token)) return false;
  errors.push(`audited must be TRUE/FALSE/AUDITED/UNAUDITED: "${raw}"`);
  return null;
}

function parseStatementScope(raw: string | undefined, errors: string[]): StatementScope {
  const token = normalizeToken(raw ?? "");
  if (token === "") return "CONSOLIDATED";
  const resolved = SCOPE_ALIASES[token];
  if (!resolved) {
    errors.push(`statement_scope must be CONSOLIDATED or SEPARATE: "${raw}"`);
    return "CONSOLIDATED";
  }
  return resolved;
}

function parseUnit(raw: string | undefined, metricCode: string | null, errors: string[]): MetricUnit | null {
  const normalized = normalizeToken(raw ?? "");
  if (normalized === "") {
    errors.push("unit is required");
    return null;
  }
  const token = normalized.replace(/\s+/g, "_") as MetricUnit;
  if (!VALID_METRIC_UNITS.includes(token)) {
    errors.push(`unit is not recognised: "${raw}" — expected one of ${VALID_METRIC_UNITS.join(", ")}`);
    return null;
  }
  if (metricCode) {
    const def = FINANCIAL_METRICS[metricCode];
    if (def && !def.allowedInputUnits.includes(token)) {
      errors.push(`${def.name} cannot be reported in ${token} — expected one of ${def.allowedInputUnits.join(", ")}`);
      return null;
    }
  }
  return token;
}

export function validateFinancialRows(rows: RawFinancialRow[]): FinancialValidationResult {
  const valid: NormalisedFinancialRow[] = [];
  const invalid: { row: RawFinancialRow; errors: string[]; rowNumber: number }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];

    const tickerRaw = (row.ticker ?? "").trim().toUpperCase();
    if (tickerRaw === "") {
      errors.push("ticker is required");
    } else if (!TICKER_RE.test(tickerRaw)) {
      errors.push(`ticker is not a plausible ticker: "${tickerRaw}"`);
    }

    const period = parsePeriod(row.period, errors);
    const fiscalYear = parseFiscalYear(row.fiscal_year, errors);

    const startResult = parseGseFileDate(row.period_start ?? "", "period_start");
    if (startResult.error) errors.push(startResult.error.message);
    const endResult = parseGseFileDate(row.period_end ?? "", "period_end");
    if (endResult.error) errors.push(endResult.error.message);
    if (!startResult.error && !endResult.error && startResult.date! > endResult.date!) {
      errors.push(`period_end (${row.period_end}) is before period_start (${row.period_start})`);
    }

    const metricLabel = (row.metric ?? "").trim();
    const metricCode = metricLabel === "" ? null : resolveMetricCode(metricLabel);
    if (metricLabel === "") {
      errors.push("metric is required");
    } else if (!metricCode) {
      errors.push(`metric label is not recognised: "${metricLabel}" — use a canonical code (e.g. PROFIT_AFTER_TAX) or a known alias`);
    }

    const valueResult = parseDecimal(row.value ?? "", "value");
    if (valueResult.error) errors.push(valueResult.error.message);

    const unit = parseUnit(row.unit, metricCode, errors);
    const audited = parseAudited(row.audited, errors);
    const statementScope = parseStatementScope(row.statement_scope, errors);
    const currency = (row.currency ?? "").trim() || "GHS";

    if (errors.length > 0) {
      invalid.push({ row, errors, rowNumber });
      return;
    }

    valid.push({
      ticker: tickerRaw,
      period: period!,
      fiscalYear: fiscalYear!,
      periodStart: startResult.date!,
      periodEnd: endResult.date!,
      metricCode: metricCode!,
      value: valueResult.value!,
      currency,
      unit: unit!,
      audited,
      statementScope,
    });
  });

  return { valid, invalid };
}
