import { describe, it, expect } from "vitest";
import { parseCsv } from "../ingestion/file-parse";
import { extractFinancialRows, validateFinancialRows } from "../ingestion/financials-parser";

const HEADERS = ["Ticker", "Period", "Fiscal Year", "Period Start", "Period End", "Metric", "Value", "Currency", "Unit", "Audited", "Statement Scope"];

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
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Profit after tax", "3200", "GHS", "GHS_MILLIONS", "TRUE", "CONSOLIDATED"],
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.valid[0]).toMatchObject({
      ticker: "MTNGH",
      period: "ANNUAL",
      fiscalYear: 2025,
      metricCode: "PROFIT_AFTER_TAX",
      value: "3200",
      unit: "GHS_MILLIONS",
      audited: true,
      statementScope: "CONSOLIDATED",
    });
  });

  it("accepts FY as an alias for ANNUAL", () => {
    const result = parseAndValidate([["MTNGH", "FY", "2025", "2025-01-01", "2025-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid[0].period).toBe("ANNUAL");
  });
});

describe("interim periods — Q1-Q4, H1/H2, 9M", () => {
  it("accepts Q1-Q4 directly, with no separate period-type column needed", () => {
    const q3 = parseAndValidate([["MTNGH", "Q3", "2026", "2026-07-01", "2026-09-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(q3.valid[0].period).toBe("Q3");
  });

  it("accepts H1/H2 directly", () => {
    const h1 = parseAndValidate([["MTNGH", "H1", "2026", "2026-01-01", "2026-06-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    const h2 = parseAndValidate([["MTNGH", "H2", "2026", "2026-07-01", "2026-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(h1.valid[0].period).toBe("H1");
    expect(h2.valid[0].period).toBe("H2");
  });

  it("accepts 9M / NINE MONTH as aliases for a nine-month interim — a real shape M7's old model had no slot for at all", () => {
    const nineM = parseAndValidate([["MTNGH", "9M", "2026", "2026-01-01", "2026-09-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    const nineMonth = parseAndValidate([["MTNGH", "NINE MONTH", "2026", "2026-01-01", "2026-09-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(nineM.valid[0].period).toBe("NINE_MONTH");
    expect(nineMonth.valid[0].period).toBe("NINE_MONTH");
  });

  it("rejects an ambiguous bare digit — M7.1's whole point is that '1' alone no longer means anything", () => {
    const result = parseAndValidate([["MTNGH", "1", "2026", "2026-01-01", "2026-06-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("period must be one of");
  });

  it("rejects an unrecognised period token", () => {
    const result = parseAndValidate([["MTNGH", "H3", "2026", "2026-01-01", "2026-06-30", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid).toHaveLength(0);
  });
});

describe("metric alias resolution", () => {
  it("resolves a real-filing label to its canonical code", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Profit for the year", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid[0].metricCode).toBe("PROFIT_AFTER_TAX");
  });

  it("accepts a canonical code passed directly, case-insensitively", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "profit_after_tax", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid[0].metricCode).toBe("PROFIT_AFTER_TAX");
  });

  it("rejects an unrecognised metric label rather than guessing", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Some Made Up Line Item", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("not recognised");
  });
});

describe("unit validation and cross-checking against the metric", () => {
  it("rejects EPS reported in GHS_THOUSANDS (per-share figures are never scaled)", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "EPS", "0.45", "GHS", "GHS_THOUSANDS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("cannot be reported in GHS_THOUSANDS");
  });

  it("accepts EPS reported in PER_SHARE_GHS", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "EPS", "0.45", "GHS", "PER_SHARE_GHS", "", ""],
    ]);
    expect(result.valid[0].unit).toBe("PER_SHARE_GHS");
  });

  it("rejects an unrecognised unit", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "100", "GHS", "USD_BILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
  });
});

describe("malformed rows", () => {
  it("rejects a malformed value without persisting it", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "not-a-number", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("value");
  });

  it("rejects period_end before period_start", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-12-31", "2025-01-01", "Revenue", "100", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("before period_start");
  });

  it("reports a 1-based rowNumber accounting for the header row", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "100", "GHS", "GHS_MILLIONS", "", ""],
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "bad", "GHS", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.invalid[0].rowNumber).toBe(3);
  });

  it("defaults statement_scope to CONSOLIDATED and currency to GHS when blank", () => {
    const result = parseAndValidate([
      ["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "100", "", "GHS_MILLIONS", "", ""],
    ]);
    expect(result.valid[0].statementScope).toBe("CONSOLIDATED");
    expect(result.valid[0].currency).toBe("GHS");
  });

  it("accepts GROUP/PARENT as aliases for CONSOLIDATED/SEPARATE", () => {
    const group = parseAndValidate([["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", "GROUP"]]);
    const parent = parseAndValidate([["MTNGH", "ANNUAL", "2025", "2025-01-01", "2025-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", "PARENT"]]);
    expect(group.valid[0].statementScope).toBe("CONSOLIDATED");
    expect(parent.valid[0].statementScope).toBe("SEPARATE");
  });

  it("rejects a blank period", () => {
    const result = parseAndValidate([["MTNGH", "", "2025", "2025-01-01", "2025-12-31", "Revenue", "1", "GHS", "GHS_MILLIONS", "", ""]]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("period is required");
  });
});
