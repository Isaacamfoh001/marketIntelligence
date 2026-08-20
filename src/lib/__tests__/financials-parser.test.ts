import { describe, it, expect } from "vitest";
import { parseCsv } from "../ingestion/file-parse";
import { extractFinancialRows, validateFinancialRows } from "../ingestion/financials-parser";

const HEADERS = ["Ticker", "Period Type", "Fiscal Year", "Fiscal Period", "Period Start", "Period End", "Metric", "Value", "Currency", "Unit", "Audited", "Statement Scope"];

function csv(rows: string[][], headers: string[] = HEADERS): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function parseAndValidate(rows: string[][], headers?: string[]) {
  const raw = extractFinancialRows(parseCsv(csv(rows, headers)));
  return validateFinancialRows(raw);
}

describe("annual rows", () => {
  it("accepts a valid ANNUAL PROFIT_AFTER_TAX row reported in GHS millions", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Profit after tax", "3200", "GHS", "GHS_MILLIONS", "TRUE", "CONSOLIDATED"],
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.valid[0]).toMatchObject({
      ticker: "MTNGH",
      periodType: "ANNUAL",
      fiscalYear: 2025,
      fiscalQuarter: 0,
      metricCode: "PROFIT_AFTER_TAX",
      value: "3200",
      unit: "GHS_MILLIONS",
      audited: true,
      statementScope: "CONSOLIDATED",
    });
  });

  it("rejects a non-blank fiscal_period on an ANNUAL row", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "H1", "2025-01-01", "2025-12-31", "Revenue", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("fiscal_period must be blank");
  });
});

describe("half-year and quarterly rows", () => {
  it("accepts H1/H2 fiscal_period for HALF_YEAR, mapping to 1/2", () => {
    const h1 = parseAndValidate([["MTNGH", "HALF_YEAR", "2026", "H1", "2026-01-01", "2026-06-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    const h2 = parseAndValidate([["MTNGH", "HALF_YEAR", "2026", "H2", "2026-07-01", "2026-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(h1.valid[0].fiscalQuarter).toBe(1);
    expect(h2.valid[0].fiscalQuarter).toBe(2);
  });

  it("accepts Q1-Q4 fiscal_period for QUARTERLY", () => {
    const result = parseAndValidate([["MTNGH", "QUARTERLY", "2026", "Q3", "2026-07-01", "2026-09-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid[0].fiscalQuarter).toBe(3);
  });

  it("rejects an out-of-range quarter", () => {
    const result = parseAndValidate([["MTNGH", "QUARTERLY", "2026", "Q5", "2026-07-01", "2026-09-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid).toHaveLength(0);
  });

  it("rejects HALF_YEAR without a recognised fiscal_period", () => {
    const result = parseAndValidate([["MTNGH", "HALF_YEAR", "2026", "H3", "2026-01-01", "2026-06-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("H1 or H2");
  });
});

describe("metric alias resolution", () => {
  it("resolves a real-filing label to its canonical code", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Profit for the year", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid[0].metricCode).toBe("PROFIT_AFTER_TAX");
  });

  it("accepts a canonical code passed directly, case-insensitively", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "profit_after_tax", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid[0].metricCode).toBe("PROFIT_AFTER_TAX");
  });

  it("rejects an unrecognised metric label rather than guessing", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Some Made Up Line Item", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("not recognised");
  });
});

describe("unit validation and cross-checking against the metric", () => {
  it("rejects EPS reported in GHS_THOUSANDS (per-share figures are never scaled)", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "EPS", "0.45", "GHS", "GHS_THOUSANDS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("cannot be reported in GHS_THOUSANDS");
  });

  it("accepts EPS reported in PER_SHARE_GHS", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "EPS", "0.45", "GHS", "PER_SHARE_GHS", "", ""],
    ]);
    expect(result.valid[0].unit).toBe("PER_SHARE_GHS");
  });

  it("rejects an unrecognised unit", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "100", "GHS", "USD_BILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
  });
});

describe("malformed rows", () => {
  it("rejects a malformed value without persisting it", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "not-a-number", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("value");
  });

  it("rejects period_end before period_start", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-12-31", "2025-01-01", "Revenue", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("before period_start");
  });

  it("reports a 1-based rowNumber accounting for the header row", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "100", "GHS", "GHS_MILLIONS", "", ""],
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "bad", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.invalid[0].rowNumber).toBe(3);
  });

  it("defaults statement_scope to CONSOLIDATED and currency to GHS when blank", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "100", "", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid[0].statementScope).toBe("CONSOLIDATED");
    expect(result.valid[0].currency).toBe("GHS");
  });

  it("accepts GROUP/PARENT as aliases for CONSOLIDATED/SEPARATE", () => {
    const group = parseAndValidate([["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", "GROUP"]]);
    const parent = parseAndValidate([["MTNGH", "ANNUAL", "2025", "", "2025-01-01", "2025-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", "PARENT"]]);
    expect(group.valid[0].statementScope).toBe("CONSOLIDATED");
    expect(parent.valid[0].statementScope).toBe("SEPARATE");
  });
});
