// ---------------------------------------------------------------------------
// Canonical company-financial metric definitions — the controlled
// vocabulary M7 imports map into (CLAUDE.md/M7 §18: "Build a controlled
// alias mapping. Do not use fuzzy AI guessing during persistence. Unknown
// labels should be flagged for analyst review.").
//
// Every metric has ONE canonical storage unit (see MetricUnit in
// schema.prisma). `allowedInputUnits` is what a source file's own `unit`
// column may legitimately claim for that metric — e.g. EPS can never
// arrive as GHS_THOUSANDS, because per-share figures are never reported
// at that scale; catching that at validation time is cheap insurance
// against a spreadsheet typo silently producing a 1,000x-wrong EPS.
// ---------------------------------------------------------------------------

export type MetricUnit = "GHS" | "GHS_THOUSANDS" | "GHS_MILLIONS" | "PERCENT" | "PER_SHARE_GHS" | "COUNT";

export type MetricCategory = "INCOME_STATEMENT" | "BALANCE_SHEET" | "PER_SHARE" | "BANK";

/** Reuses M5.1's direction.ts vocabulary (src/lib/direction.ts) — never a new arrow/color system (M7 §34). */
export type MetricPolarity = "higherIsPositive" | "neutral";

export interface MetricDefinition {
  code: string;
  name: string;
  canonicalUnit: MetricUnit;
  allowedInputUnits: MetricUnit[];
  category: MetricCategory;
  /** higherIsPositive for income-statement/per-share growth metrics; neutral for balance-sheet size (M7 §33: "assets growing" isn't inherently good or bad — never auto-assign sentiment to it). */
  polarity: MetricPolarity;
}

const MONEY_UNITS: MetricUnit[] = ["GHS", "GHS_THOUSANDS", "GHS_MILLIONS"];
const COUNT_UNITS: MetricUnit[] = ["COUNT", "GHS_THOUSANDS", "GHS_MILLIONS"]; // "shares in millions" is common

export const FINANCIAL_METRICS: Record<string, MetricDefinition> = {
  REVENUE: { code: "REVENUE", name: "Revenue", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "INCOME_STATEMENT", polarity: "higherIsPositive" },
  OPERATING_PROFIT: { code: "OPERATING_PROFIT", name: "Operating Profit", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "INCOME_STATEMENT", polarity: "higherIsPositive" },
  PROFIT_AFTER_TAX: { code: "PROFIT_AFTER_TAX", name: "Profit After Tax", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "INCOME_STATEMENT", polarity: "higherIsPositive" },
  TOTAL_ASSETS: { code: "TOTAL_ASSETS", name: "Total Assets", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "BALANCE_SHEET", polarity: "neutral" },
  TOTAL_EQUITY: { code: "TOTAL_EQUITY", name: "Total Equity", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "BALANCE_SHEET", polarity: "neutral" },
  EPS: { code: "EPS", name: "Earnings Per Share", canonicalUnit: "PER_SHARE_GHS", allowedInputUnits: ["PER_SHARE_GHS"], category: "PER_SHARE", polarity: "higherIsPositive" },
  DIVIDEND_PER_SHARE: { code: "DIVIDEND_PER_SHARE", name: "Dividend Per Share", canonicalUnit: "PER_SHARE_GHS", allowedInputUnits: ["PER_SHARE_GHS"], category: "PER_SHARE", polarity: "higherIsPositive" },
  SHARES_OUTSTANDING: { code: "SHARES_OUTSTANDING", name: "Shares Outstanding", canonicalUnit: "COUNT", allowedInputUnits: COUNT_UNITS, category: "PER_SHARE", polarity: "neutral" },
  NET_INTEREST_INCOME: { code: "NET_INTEREST_INCOME", name: "Net Interest Income", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "BANK", polarity: "higherIsPositive" },
  OPERATING_INCOME: { code: "OPERATING_INCOME", name: "Operating Income", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "BANK", polarity: "higherIsPositive" },
  LOANS_AND_ADVANCES: { code: "LOANS_AND_ADVANCES", name: "Loans and Advances", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "BANK", polarity: "neutral" },
  CUSTOMER_DEPOSITS: { code: "CUSTOMER_DEPOSITS", name: "Customer Deposits", canonicalUnit: "GHS", allowedInputUnits: MONEY_UNITS, category: "BANK", polarity: "neutral" },
};

/** Real filings use varied labels for the same line item — a controlled, exact (post-normalization) alias map, never fuzzy matching. */
const METRIC_ALIASES: Record<string, string> = {
  // REVENUE
  "revenue": "REVENUE",
  "total revenue": "REVENUE",
  "turnover": "REVENUE",
  "total operating revenue": "REVENUE",
  // OPERATING_PROFIT
  "operating profit": "OPERATING_PROFIT",
  "profit from operations": "OPERATING_PROFIT",
  "operating profit loss": "OPERATING_PROFIT",
  // PROFIT_AFTER_TAX
  "profit after tax": "PROFIT_AFTER_TAX",
  "profit after taxation": "PROFIT_AFTER_TAX",
  "profit for the year": "PROFIT_AFTER_TAX",
  "profit for the period": "PROFIT_AFTER_TAX",
  "net profit after tax": "PROFIT_AFTER_TAX",
  "profit for the year attributable to equity holders": "PROFIT_AFTER_TAX",
  "profit attributable to equity holders": "PROFIT_AFTER_TAX",
  // TOTAL_ASSETS
  "total assets": "TOTAL_ASSETS",
  // TOTAL_EQUITY
  "total equity": "TOTAL_EQUITY",
  "total equity attributable to equity holders": "TOTAL_EQUITY",
  "shareholders funds": "TOTAL_EQUITY",
  "shareholders equity": "TOTAL_EQUITY",
  "equity attributable to owners": "TOTAL_EQUITY",
  // EPS
  "earnings per share": "EPS",
  "basic earnings per share": "EPS",
  "eps": "EPS",
  "basic eps": "EPS",
  "basic and diluted earnings per share": "EPS",
  // DIVIDEND_PER_SHARE
  "dividend per share": "DIVIDEND_PER_SHARE",
  "dps": "DIVIDEND_PER_SHARE",
  // SHARES_OUTSTANDING
  "shares outstanding": "SHARES_OUTSTANDING",
  "number of shares": "SHARES_OUTSTANDING",
  "number of shares in issue": "SHARES_OUTSTANDING",
  "weighted average number of shares": "SHARES_OUTSTANDING",
  "issued shares": "SHARES_OUTSTANDING",
  "ordinary shares in issue": "SHARES_OUTSTANDING",
  // NET_INTEREST_INCOME
  "net interest income": "NET_INTEREST_INCOME",
  // OPERATING_INCOME
  "operating income": "OPERATING_INCOME",
  "total operating income": "OPERATING_INCOME",
  // LOANS_AND_ADVANCES
  "loans and advances": "LOANS_AND_ADVANCES",
  "loans and advances to customers": "LOANS_AND_ADVANCES",
  "net loans and advances": "LOANS_AND_ADVANCES",
  "loans and advances to customers net": "LOANS_AND_ADVANCES",
  // CUSTOMER_DEPOSITS
  "customer deposits": "CUSTOMER_DEPOSITS",
  "deposits from customers": "CUSTOMER_DEPOSITS",
  "deposits due to customers": "CUSTOMER_DEPOSITS",
};

function normalizeMetricLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolves a canonical code directly, or a known alias (case/punctuation-insensitive). Returns null for anything else — never guessed. */
export function resolveMetricCode(label: string): string | null {
  const trimmed = label.trim();
  if (FINANCIAL_METRICS[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  const normalized = normalizeMetricLabel(trimmed);
  return METRIC_ALIASES[normalized] ?? null;
}

const UNIT_SCALE: Record<MetricUnit, number> = {
  GHS: 1,
  GHS_THOUSANDS: 1_000,
  GHS_MILLIONS: 1_000_000,
  PERCENT: 1,
  PER_SHARE_GHS: 1,
  COUNT: 1,
};

export function unitScaleFactor(unit: MetricUnit): number {
  return UNIT_SCALE[unit];
}

export const VALID_METRIC_UNITS: MetricUnit[] = ["GHS", "GHS_THOUSANDS", "GHS_MILLIONS", "PERCENT", "PER_SHARE_GHS", "COUNT"];
