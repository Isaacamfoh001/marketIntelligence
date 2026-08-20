import { describe, it, expect } from "vitest";
import {
  extractRowsFromHtml,
  extractRowsFromAjaxJson,
  validateTreasuryRows,
  type RawTreasuryRow,
} from "../ingestion/bog-treasury-parser";

function htmlTable(rows: string[][]): string {
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

describe("extractRowsFromHtml", () => {
  it("parses 91/182/364-day bill rows", () => {
    const html = htmlTable([
      ["17 Aug 2026", "2020", "91 DAY BILL", "5.3944", "5.4681"],
      ["17 Aug 2026", "2020", "182 DAY BILL", "7.0169", "7.2720"],
      ["17 Aug 2026", "2020", "364 DAY BILL", "11.1111", "12.5000"],
    ]);
    const rows = extractRowsFromHtml(html);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.securityType)).toEqual(["91 DAY BILL", "182 DAY BILL", "364 DAY BILL"]);
  });

  it("extracts bonds/notes too — filtering to supported tenors is the caller's job", () => {
    const html = htmlTable([["17 Aug 2026", "2020", "5 YR FXR BOND", "20.0", "21.0"]]);
    expect(extractRowsFromHtml(html)).toHaveLength(1);
  });

  it("ignores rows whose first cell isn't a BoG date shape", () => {
    const html = htmlTable([["Not a date", "2020", "91 DAY BILL", "5.3944", "5.4681"]]);
    expect(extractRowsFromHtml(html)).toHaveLength(0);
  });
});

describe("extractRowsFromAjaxJson", () => {
  it("parses the historical AJAX endpoint's data array", () => {
    const json = { data: [["17 Aug 2026", "2020", "91 DAY BILL", "5.3944", "5.4681"]] };
    expect(extractRowsFromAjaxJson(json)).toEqual([
      { dateText: "17 Aug 2026", tenderNumber: "2020", securityType: "91 DAY BILL", discountText: "5.3944", interestText: "5.4681" },
    ]);
  });

  it("returns an empty array for a missing or malformed data field", () => {
    expect(extractRowsFromAjaxJson({})).toEqual([]);
    expect(extractRowsFromAjaxJson({ data: "not-an-array" })).toEqual([]);
  });
});

function row(overrides: Partial<RawTreasuryRow>): RawTreasuryRow {
  return {
    dateText: "17 Aug 2026",
    tenderNumber: "2020",
    securityType: "91 DAY BILL",
    discountText: "5.3944",
    interestText: "5.4681",
    ...overrides,
  };
}

describe("validateTreasuryRows", () => {
  it("accepts a well-formed 91-day row", () => {
    const result = validateTreasuryRows([row({})]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({ securityType: "91 DAY BILL", discountRate: "5.3944", interestRate: "5.4681", tenderNumber: "2020" });
  });

  it("accepts 182-day and 364-day rows", () => {
    const result = validateTreasuryRows([
      row({ securityType: "182 DAY BILL", discountText: "7.0169", interestText: "7.2720" }),
      row({ securityType: "364 DAY BILL", discountText: "11.1111", interestText: "12.5000" }),
    ]);
    expect(result.valid).toHaveLength(2);
  });

  it("rejects unsupported security types (bonds/notes) rather than silently ingesting them", () => {
    const result = validateTreasuryRows([row({ securityType: "5 YR FXR BOND", discountText: "20.0", interestText: "21.0" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("security_type"))).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = validateTreasuryRows([row({ dateText: "not a date" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a malformed discount rate", () => {
    const result = validateTreasuryRows([row({ discountText: "N/A" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("discount_rate"))).toBe(true);
  });

  it("rejects a malformed interest rate", () => {
    const result = validateTreasuryRows([row({ interestText: "N/A" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("interest_rate"))).toBe(true);
  });

  it("rejects interest_rate below discount_rate as implausible", () => {
    const result = validateTreasuryRows([row({ discountText: "10.0", interestText: "9.0" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("below discount_rate"))).toBe(true);
  });

  it("treats a blank tender number as missing, not a fabricated value", () => {
    const result = validateTreasuryRows([row({ tenderNumber: "  " })]);
    expect(result.valid[0].tenderNumber).toBeNull();
  });
});
