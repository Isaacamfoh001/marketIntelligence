import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseCsv, parseExcel, parseImportFile, findHeader, normalizeHeader, FileParseError } from "../ingestion/file-parse";

describe("normalizeHeader", () => {
  it("collapses punctuation/casing/whitespace to a comparable key", () => {
    expect(normalizeHeader("Closing Price - VWAP")).toBe("closing price vwap");
    expect(normalizeHeader("  Share_Code ")).toBe("share code");
    expect(normalizeHeader("GSE-CI")).toBe("gse ci");
  });

  it("drops a parenthetical currency/unit annotation entirely, not just its punctuation (M8.1 — real GSE export headers)", () => {
    // The non-ASCII ¢ symbol strips to nothing, which would otherwise leave
    // a dangling "gh" token and break every alias match for the required
    // close_vwap column.
    expect(normalizeHeader("Closing Price - VWAP (GH¢)")).toBe("closing price vwap");
    expect(normalizeHeader("Year High (GH¢)")).toBe("year high");
    expect(normalizeHeader("Closing Bid Price (GH¢)")).toBe("closing bid price");
  });
});

describe("findHeader", () => {
  it("matches any alias, normalized", () => {
    const headers = ["trading date", "share code", "closing price vwap"];
    expect(findHeader(headers, ["Close", "Closing Price - VWAP"])).toBe("closing price vwap");
    expect(findHeader(headers, ["Volume"])).toBeNull();
  });
});

describe("parseCsv", () => {
  it("parses a simple comma-delimited file with a header row", () => {
    const result = parseCsv("Ticker,Price\nMTNGH,2.50\nGCB,5.05\n");
    expect(result.rawHeaders).toEqual(["Ticker", "Price"]);
    expect(result.rows).toEqual([
      { ticker: "MTNGH", price: "2.50" },
      { ticker: "GCB", price: "5.05" },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const result = parseCsv('Company,Ticker\n"GCB Bank, PLC",GCB\n');
    expect(result.rows[0]).toEqual({ company: "GCB Bank, PLC", ticker: "GCB" });
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    const result = parseCsv('Note,Ticker\n"He said ""hello""",MTNGH\n');
    expect(result.rows[0].note).toBe('He said "hello"');
  });

  it("handles embedded newlines inside quoted fields", () => {
    const result = parseCsv('Note,Ticker\n"line one\nline two",MTNGH\n');
    expect(result.rows[0].note).toBe("line one\nline two");
  });

  it("throws FileParseError on a completely empty file", () => {
    expect(() => parseCsv("")).toThrow(FileParseError);
  });

  it("treats a blank cell as an empty string, not undefined", () => {
    const result = parseCsv("A,B,C\n1,,3\n");
    expect(result.rows[0]).toEqual({ a: "1", b: "", c: "3" });
  });
});

async function workbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRows(rows);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

describe("parseExcel", () => {
  it("parses a workbook's first sheet with a header row", async () => {
    const buffer = await workbookBuffer([
      ["Trading Date", "Share Code", "Closing Price - VWAP"],
      ["2026-08-17", "MTNGH", 2.5],
    ]);

    const result = await parseExcel(buffer);
    expect(result.rawHeaders).toEqual(["Trading Date", "Share Code", "Closing Price - VWAP"]);
    expect(result.rows[0]).toEqual({
      "trading date": "2026-08-17",
      "share code": "MTNGH",
      "closing price vwap": "2.5",
    });
  });

  it("skips fully-blank rows", async () => {
    const buffer = await workbookBuffer([["Ticker"], ["MTNGH"], [""], ["GCB"]]);
    const result = await parseExcel(buffer);
    expect(result.rows).toHaveLength(2);
  });

  it("formats a real Excel date cell as YYYY-MM-DD", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Trading Date"]);
    sheet.addRow([new Date(Date.UTC(2026, 7, 17))]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const result = await parseExcel(buffer);
    expect(result.rows[0]["trading date"]).toBe("2026-08-17");
  });
});

describe("parseImportFile", () => {
  it("dispatches .csv to the CSV parser", async () => {
    const result = await parseImportFile("prices.csv", Buffer.from("Ticker\nMTNGH\n"));
    expect(result.rows[0].ticker).toBe("MTNGH");
  });

  it("dispatches .xlsx to the Excel parser", async () => {
    const buffer = await workbookBuffer([["Ticker"], ["MTNGH"]]);
    const result = await parseImportFile("prices.xlsx", buffer);
    expect(result.rows[0].ticker).toBe("MTNGH");
  });

  it("rejects an unsupported extension rather than guessing", async () => {
    await expect(parseImportFile("prices.pdf", Buffer.from("whatever"))).rejects.toThrow(FileParseError);
  });
});
