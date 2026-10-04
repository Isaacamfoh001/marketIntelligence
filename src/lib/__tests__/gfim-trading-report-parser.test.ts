// ---------------------------------------------------------------------------
// Unit tests for the GFIM Daily Trading Report XLSX parser (M7.2).
//
// Builds a synthetic workbook in memory replicating the REAL report's
// verified structure (sheet names, header row 4, column names) rather than
// committing a real downloaded report into the repo — the real file is
// GFIM's own copyrighted publication; only its structure (independently
// verified against an actual downloaded report during M7.2 research) is
// reproduced here, with entirely synthetic figures.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { extractSheetRows, extractAllSheets, validateTradingReportRows, extractReportDateFromWorkbook, isTradedRow, parseSourceDate } from "../ingestion/gfim-trading-report-parser";

function addTitleRows(sheet: ExcelJS.Worksheet, label: string) {
  sheet.addRow([]);
  sheet.addRow(["GHANA FIXED INCOME MARKET"]);
  sheet.addRow([`Date: Friday, 02 October, 2026`]);
}

async function buildWorkbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();

  const corp = wb.addWorksheet("CORPORATE   ");
  addTitleRows(corp, "corp");
  corp.addRow([
    "ISSUERS",
    "NO. ",
    "SECURITY DESCRIPTION",
    "ISIN",
    "OPENING PRICE",
    "CLOSING PRICE",
    "VOLUME TRADED",
    "NUMBER \nTRADED",
    "DAY LOW PRICE",
    "DAY HIGH\nPRICE",
    "DAYS TO MATURITY",
    "MATURITY\nDATE",
    "APPLICABLE\nDATE",
  ]);
  corp.addRow(["KASAPREKO PLC", 1, "KCP-BD-29/01/27-C0878-26", "GHCKCP073272", null, null, null, null, null, null, 119, new Date("2027-01-29")]); // no trade
  corp.addRow([null, 2, "KCP-NT-12/09/28-C0933-23.50", "GHCKCP075566", 99.5, 99.81, null, null, 99.5, 99.81, 711, new Date("2028-09-12")]); // price but NO volume/trades: a carried closing price (M7.3.1)
  corp.addRow(["UNKNOWN ISSUER", 3, "ZZZ-BD-01/01/30", "ZZUNKNOWNISIN01", 90, 91, 1000, 2, 90, 91, 1000, new Date("2030-01-01")]); // unmatched ISIN

  const newGog = wb.addWorksheet("NEW GOG NOTES AND BONDS");
  addTitleRows(newGog, "new gog");
  newGog.addRow([
    "NO.",
    "TENOR",
    "SECURITY DESCRIPTION",
    "ISIN",
    "OPENING\nYIELD",
    "CLOSING\n YIELD",
    "END OF DAY CLOSING\n PRICE",
    "VOLUME",
    "NUMBER \nTRADED",
    "DAY LOW YIELD ",
    "DAY HIGH\n YIELD",
    "DAYS TO \nMATURITY",
    "MATURITY\nDATE",
    "APPLICABLE\nDATE",
  ]);
  newGog.addRow([1, "4-YEAR BOND", "GOG-BD-02/09/30-A6156-2023-12.00", "GHGGOGI02204", 11.5, 11.8, 100.59, 195400, 1, 11.69, 11.69, 1431, new Date("2030-09-02")]);

  const oldGog = wb.addWorksheet("OLD GOG NOTES AND BONDS");
  addTitleRows(oldGog, "old gog");
  oldGog.addRow(["NO.", "TENOR", "SECURITY DESCRIPTION", "ISIN", "OPENING\nYIELD", "CLOSING\n YIELD", "END OF DAY CLOSING\n PRICE", "VOLUME", "NUMBER \nTRADED", "DAY LOW YIELD ", "DAY HIGH\n YIELD", "DAYS TO \nMATURITY", "MATURITY\nDATE", "APPLICABLE\nDATE"]);
  oldGog.addRow([1, "5-YEAR BOND", "GOG-BD-14/12/26-A5789-1777-21.00", "GHGGOG065145", 19.3, 19.5, 100.67, null, null, 19.5, 19.5, 73, new Date("2026-12-14")]);
  oldGog.addRow([2, null, "GOG-BD-00/00/00-NOTRADE", "GHGGOGNOTRADE1", null, null, null, null, null, null, null, 500, new Date("2028-01-01")]); // no trade

  return wb;
}

describe("extractSheetRows", () => {
  it("extracts CORPORATE rows using closing price (no yield column)", async () => {
    const wb = await buildWorkbook();
    const rows = extractSheetRows(wb, "CORPORATE");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ isin: "GHCKCP075566", closingPrice: 99.81, closingYield: null });
  });

  it("extracts NEW_GOG rows with both price and yield", async () => {
    const wb = await buildWorkbook();
    const rows = extractSheetRows(wb, "NEW_GOG");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isin: "GHGGOGI02204", closingPrice: 100.59, closingYield: 11.8 });
  });

  it("returns an empty array for a sheet not present in this report", async () => {
    const wb = await buildWorkbook();
    expect(extractSheetRows(wb, "DDEP")).toEqual([]);
  });

  it("extractAllSheets combines every recognised sheet", async () => {
    const wb = await buildWorkbook();
    const rows = extractAllSheets(wb);
    expect(rows).toHaveLength(3 + 1 + 2); // CORPORATE + NEW_GOG + OLD_GOG
  });
});

describe("validateTradingReportRows", () => {
  it("separates traded rows from no-trade rows, never fabricating a price for a no-trade row", async () => {
    const wb = await buildWorkbook();
    const result = validateTradingReportRows(extractAllSheets(wb));

    const tradedIsins = result.traded.map((r) => r.isin);
    expect(tradedIsins).toContain("GHCKCP075566");
    expect(tradedIsins).toContain("GHGGOGI02204");
    expect(tradedIsins).toContain("GHGGOG065145");
    expect(tradedIsins).toContain("ZZUNKNOWNISIN01");

    const noTradeIsins = result.noTrade.map((r) => r.isin);
    expect(noTradeIsins).toContain("GHCKCP073272"); // Kasapreko 3yr — no trade this day
    expect(noTradeIsins).toContain("GHGGOGNOTRADE1");
  });

  it("stores the government sheet's own closing yield alongside the closing price", async () => {
    const wb = await buildWorkbook();
    const result = validateTradingReportRows(extractAllSheets(wb));
    const row = result.traded.find((r) => r.isin === "GHGGOGI02204")!;
    expect(row.cleanPrice).toBe("100.59");
    expect(row.sourceYieldPct).toBe("11.8");
  });

  it("never stores a yield for the CORPORATE sheet (no yield column exists there)", async () => {
    const wb = await buildWorkbook();
    const result = validateTradingReportRows(extractAllSheets(wb));
    const row = result.traded.find((r) => r.isin === "GHCKCP075566")!;
    expect(row.sourceYieldPct).toBeNull();
  });
});

describe("extractReportDateFromWorkbook", () => {
  it("reads the report's own 'Date: Weekday, DD Month, YYYY' text", async () => {
    const wb = await buildWorkbook();
    const date = extractReportDateFromWorkbook(wb);
    expect(date?.toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("returns null when no sheet carries a recognisable date string", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("EMPTY");
    expect(extractReportDateFromWorkbook(wb)).toBeNull();
  });
});

describe("trade classification (M7.3.1)", () => {
  it("classifies a row as TRADED only when volume or number traded is positive", async () => {
    const wb = await buildWorkbook();
    const { traded } = validateTradingReportRows(extractAllSheets(wb));
    const byIsin = new Map(traded.map((r) => [r.isin, r]));
    expect(byIsin.get("GHGGOGI02204")!.tradeStatus).toBe("TRADED");
    expect(byIsin.get("GHGGOGI02204")!.numberOfTrades).toBe(1);
    // A closing price with no volume/trades is GFIM's carried last price, not a trade on the report date.
    expect(byIsin.get("GHCKCP075566")!.tradeStatus).toBe("NOT_TRADED");
    expect(byIsin.get("GHGGOG065145")!.tradeStatus).toBe("NOT_TRADED");
  });

  it("keeps the source's own description and maturity date for terms cross-checking", async () => {
    const wb = await buildWorkbook();
    const row = validateTradingReportRows(extractAllSheets(wb)).traded.find((r) => r.isin === "GHCKCP075566")!;
    expect(row.securityDescription).toBe("KCP-NT-12/09/28-C0933-23.50");
    expect(row.sourceMaturityDate).toBe("2028-09-12");
  });

  it("isTradedRow: zero volume and zero trades is not a trade", () => {
    expect(isTradedRow(null, null)).toBe(false);
    expect(isTradedRow("0", 0)).toBe(false);
    expect(isTradedRow("120000", null)).toBe(true);
    expect(isTradedRow(null, 2)).toBe(true);
  });

  it("parseSourceDate ignores GFIM's Excel-serial junk dates instead of comparing them", () => {
    expect(parseSourceDate(new Date("2028-09-12T00:00:00.000Z"))).toBe("2028-09-12");
    expect(parseSourceDate(new Date("1899-12-31T00:00:00.000Z"))).toBeNull();
    expect(parseSourceDate("2027-04-08")).toBe("2027-04-08");
    expect(parseSourceDate("-46297")).toBeNull();
    expect(parseSourceDate(null)).toBeNull();
  });
});
