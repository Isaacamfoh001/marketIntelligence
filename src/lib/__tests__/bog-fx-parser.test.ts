import { describe, it, expect } from "vitest";
import {
  extractRowsFromHtml,
  extractRowsFromAjaxJson,
  parseBogFxDate,
  validateBogFxRows,
  type RawBogFxRow,
} from "../ingestion/bog-fx-parser";

function htmlTable(rows: string[][]): string {
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((c) => `<td style="">${c}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

describe("extractRowsFromHtml", () => {
  it("parses a valid BoG daily-rates row", () => {
    const html = htmlTable([["19 Aug 2026", "US Dollar", "USDGHS", "11.0695", "11.0805", "11.0750"]]);
    const rows = extractRowsFromHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      dateText: "19 Aug 2026",
      currencyName: "US Dollar",
      pairCode: "USDGHS",
      buyingText: "11.0695",
      sellingText: "11.0805",
      midText: "11.0750",
    });
  });

  it("ignores rows whose third cell isn't a currency-pair-shaped code", () => {
    const html = htmlTable([
      ["Day's Weighted Median Rate:", "11.0750"], // 2-cell summary row, wrong shape
      ["19 Aug 2026", "US Dollar", "usdghs-not-a-pair", "11.0695", "11.0805", "11.0750"],
    ]);
    expect(extractRowsFromHtml(html)).toHaveLength(0);
  });

  it("extracts every currency pair present — pair filtering is the caller's job", () => {
    const html = htmlTable([
      ["19 Aug 2026", "US Dollar", "USDGHS", "11.0695", "11.0805", "11.0750"],
      ["19 Aug 2026", "Pound Sterling", "GBPGHS", "15.0556", "15.0717", "15.0637"],
    ]);
    const rows = extractRowsFromHtml(html);
    expect(rows.map((r) => r.pairCode)).toEqual(["USDGHS", "GBPGHS"]);
  });
});

describe("extractRowsFromAjaxJson", () => {
  it("parses the historical AJAX endpoint's data array", () => {
    const json = {
      data: [["19 Aug 2026", "US Dollar", "USDGHS", "11.0695", "11.0805", "11.0750"]],
    };
    expect(extractRowsFromAjaxJson(json)).toEqual([
      {
        dateText: "19 Aug 2026",
        currencyName: "US Dollar",
        pairCode: "USDGHS",
        buyingText: "11.0695",
        sellingText: "11.0805",
        midText: "11.0750",
      },
    ]);
  });

  it("returns an empty array for a missing or malformed data field", () => {
    expect(extractRowsFromAjaxJson({})).toEqual([]);
    expect(extractRowsFromAjaxJson({ data: "not-an-array" })).toEqual([]);
    expect(extractRowsFromAjaxJson(null)).toEqual([]);
  });
});

describe("parseBogFxDate", () => {
  it("parses BoG's DD MMM YYYY format", () => {
    const result = parseBogFxDate("19 Aug 2026");
    expect(result.error).toBeNull();
    expect(result.date?.toISOString().slice(0, 10)).toBe("2026-08-19");
  });

  it("rejects a different date format (e.g. the macro CSV's YYYY-MM-DD)", () => {
    expect(parseBogFxDate("2026-08-19").error).not.toBeNull();
  });

  it("rejects an out-of-range calendar date", () => {
    expect(parseBogFxDate("31 Feb 2026").error).not.toBeNull();
  });

  it("rejects an unrecognised month name", () => {
    expect(parseBogFxDate("19 Zzz 2026").error).not.toBeNull();
  });
});

function row(overrides: Partial<RawBogFxRow>): RawBogFxRow {
  return {
    dateText: "19 Aug 2026",
    currencyName: "US Dollar",
    pairCode: "USDGHS",
    buyingText: "11.0695",
    sellingText: "11.0805",
    midText: "11.0750",
    ...overrides,
  };
}

describe("validateBogFxRows", () => {
  it("accepts a well-formed row", () => {
    const result = validateBogFxRows([row({})]);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
    expect(result.valid[0].midRate).toBe("11.0750");
  });

  it("rejects a malformed date", () => {
    const result = validateBogFxRows([row({ dateText: "not a date" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a malformed rate", () => {
    const result = validateBogFxRows([row({ midText: "N/A" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("mid_rate"))).toBe(true);
  });

  it("enforces buying <= mid <= selling when all three are present", () => {
    const result = validateBogFxRows([row({ buyingText: "12.00" })]); // buying > mid
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("out of order"))).toBe(true);
  });

  it("treats a blank buying/selling cell as missing, not zero", () => {
    const result = validateBogFxRows([row({ buyingText: "", sellingText: "" })]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].buyingRate).toBeNull();
    expect(result.valid[0].sellingRate).toBeNull();
    expect(result.valid[0].midRate).toBe("11.0750");
  });
});
