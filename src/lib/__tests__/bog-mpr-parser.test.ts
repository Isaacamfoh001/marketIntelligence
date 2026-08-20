import { describe, it, expect } from "vitest";
import { extractRowsFromHtml, validateMprRows, type RawMprRow } from "../ingestion/bog-mpr-parser";

function htmlTable(rows: string[][]): string {
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

describe("extractRowsFromHtml", () => {
  it("parses a valid MPC decision row", () => {
    const html = htmlTable([["129", "March 16 – 18, 2026", "18 Mar 2026", "14.0"]]);
    const rows = extractRowsFromHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      meetingNumber: "129",
      mpcDates: "March 16 – 18, 2026",
      effectiveDateText: "18 Mar 2026",
      rateText: "14.0",
    });
  });

  it("ignores rows that don't have a BoG-date-shaped 3rd cell", () => {
    const html = htmlTable([["129", "March 16 – 18, 2026", "not-a-date", "14.0"]]);
    expect(extractRowsFromHtml(html)).toHaveLength(0);
  });

  it("ignores rows with the wrong cell count", () => {
    const html = htmlTable([["129", "18 Mar 2026", "14.0"]]); // only 3 cells
    expect(extractRowsFromHtml(html)).toHaveLength(0);
  });
});

function row(overrides: Partial<RawMprRow>): RawMprRow {
  return { meetingNumber: "129", mpcDates: "March 16 – 18, 2026", effectiveDateText: "18 Mar 2026", rateText: "14.0", ...overrides };
}

describe("validateMprRows", () => {
  it("accepts a well-formed decision, preserving the effective date", () => {
    const result = validateMprRows([row({})]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].rate).toBe("14.0");
    expect(result.valid[0].effectiveDate.toISOString().slice(0, 10)).toBe("2026-03-18");
  });

  it("rejects a malformed effective date", () => {
    const result = validateMprRows([row({ effectiveDateText: "31 Feb 2026" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("effective_date"))).toBe(true);
  });

  it("rejects a malformed rate", () => {
    const result = validateMprRows([row({ rateText: "N/A" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("rate"))).toBe(true);
  });

  it("rejects an implausible rate outside 0-100%", () => {
    const result = validateMprRows([row({ rateText: "150" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("plausible"))).toBe(true);
  });
});
