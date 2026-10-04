// ---------------------------------------------------------------------------
// GFIM Daily Trading Report — secondary-market XLSX parser (M7.2).
//
// Source: the real multi-sheet .xlsx GFIM publishes every trading day
// (e.g. "TRADING REPORT FOR GFIM-02102026.xlsx"), discovered via GFIM's
// own public, standard WordPress REST API (see
// gfim-trading-report-provider.ts for how the file URL is found — this
// module only parses an already-downloaded buffer, Mode A or Mode B).
//
// Sheet layout (verified against a real report, M7.2 research):
//   - "CORPORATE": ISSUERS, NO., SECURITY DESCRIPTION, ISIN, OPENING
//     PRICE, CLOSING PRICE, VOLUME TRADED, NUMBER TRADED, DAY LOW/HIGH
//     PRICE, DAYS TO MATURITY, MATURITY DATE, APPLICABLE DATE. No yield
//     column — only price. Header row is row 4 (rows 1-3 are title/date).
//   - "NEW GOG NOTES AND BONDS" / "OLD GOG NOTES AND BONDS" / "DDEP
//     BONDS": NO., TENOR, SECURITY DESCRIPTION, ISIN, OPENING YIELD,
//     CLOSING YIELD, END OF DAY CLOSING PRICE, VOLUME, NUMBER TRADED, DAY
//     LOW/HIGH YIELD, DAYS TO MATURITY, MATURITY DATE, APPLICABLE DATE —
//     the same header shape across all three, differing only in which
//     bonds they list. Header row is also row 4.
//
// TRADE DETECTION (corrected in M7.3.1): GFIM publishes a closing price for
// EVERY listed security, traded or not. For a security that did not trade,
// the "closing price" is its LAST trade's price carried forward — verified
// across 299 daily reports (Jul 2025 – Oct 2026): e.g. Kasapreko
// GHCKCP075566 printed 99.8057 every day after its only trade on
// 7 May 2026. A row is a trade on the report date ONLY when VOLUME or
// NUMBER TRADED is positive; a price with neither is classified NOT_TRADED
// and must never be treated as a market price dated on the report date.
// A row with no price and no yield at all is simply skipped (CLAUDE.md:
// missing is not zero).
//
// Column lookup is by HEADER NAME (normalized, matching file-parse.ts's
// convention), not fixed index — resilient to GFIM reordering columns
// between reports, the same defensive posture every other parser in this
// codebase takes.
// ---------------------------------------------------------------------------

import type ExcelJS from "exceljs";
import { normalizeHeader } from "./file-parse";

export type TradingReportSheetKind = "CORPORATE" | "NEW_GOG" | "OLD_GOG" | "DDEP";

/** Which sheet in the workbook each kind maps to, and whether that sheet publishes a yield column (government sheets) or price-only (corporate). */
const SHEET_NAME_BY_KIND: Record<TradingReportSheetKind, string> = {
  CORPORATE: "CORPORATE",
  NEW_GOG: "NEW GOG NOTES AND BONDS",
  OLD_GOG: "OLD GOG NOTES AND BONDS",
  DDEP: "DDEP BONDS",
};

const HEADER_ROW = 4;

export interface RawTradingReportRow {
  sheet: TradingReportSheetKind;
  rowNumber: number;
  securityDescription: string | null;
  isin: string | null;
  closingPrice: unknown;
  closingYield: unknown;
  volume: unknown;
  numberTraded: unknown;
  maturityDateCell: unknown;
}

function cellToPlain(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && "result" in (value as object)) {
    return (value as { result: unknown }).result;
  }
  return value;
}

/** Maps normalized header name -> 1-based column index, for one sheet's header row. */
function buildColumnIndex(sheet: ExcelJS.Worksheet): Map<string, number> {
  const header = sheet.getRow(HEADER_ROW);
  const index = new Map<string, number>();
  const colCount = sheet.columnCount || 20;
  for (let c = 1; c <= colCount; c++) {
    const raw = header.getCell(c).value;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    index.set(normalizeHeader(raw), c);
  }
  return index;
}

function findColumn(index: Map<string, number>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const normalized = normalizeHeader(alias);
    const col = index.get(normalized);
    if (col) return col;
  }
  return null;
}

/**
 * Extracts raw rows for one sheet kind out of an already-loaded workbook.
 * Returns an empty array (not an error) if the sheet isn't present in this
 * particular report — report structure can change release to release, and
 * a missing sheet simply means that category has nothing to import from
 * this file, not a parse failure.
 */
export function extractSheetRows(workbook: ExcelJS.Workbook, kind: TradingReportSheetKind): RawTradingReportRow[] {
  const sheetName = SHEET_NAME_BY_KIND[kind];
  const sheet = workbook.worksheets.find((s) => s.name.trim() === sheetName);
  if (!sheet) return [];

  const colIndex = buildColumnIndex(sheet);
  const descCol = findColumn(colIndex, ["security description"]);
  const isinCol = findColumn(colIndex, ["isin"]);
  const priceCol = kind === "CORPORATE" ? findColumn(colIndex, ["closing price"]) : findColumn(colIndex, ["end of day closing price"]);
  const yieldCol = kind === "CORPORATE" ? null : findColumn(colIndex, ["closing yield"]);
  const volumeCol = kind === "CORPORATE" ? findColumn(colIndex, ["volume traded"]) : findColumn(colIndex, ["volume"]);
  const maturityCol = findColumn(colIndex, ["maturity date", "maturity"]);
  const numberTradedCol = findColumn(colIndex, ["number traded"]);

  if (!isinCol) return []; // sheet structure unrecognised — nothing can be safely matched

  const rows: RawTradingReportRow[] = [];
  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const isinRaw = cellToPlain(row.getCell(isinCol).value);
    if (typeof isinRaw !== "string" || isinRaw.trim() === "") continue; // blank separator / TOTAL row

    rows.push({
      sheet: kind,
      rowNumber: r,
      securityDescription: descCol ? (cellToPlain(row.getCell(descCol).value) as string | null) : null,
      isin: isinRaw.trim().toUpperCase(),
      closingPrice: priceCol ? cellToPlain(row.getCell(priceCol).value) : null,
      closingYield: yieldCol ? cellToPlain(row.getCell(yieldCol).value) : null,
      volume: volumeCol ? cellToPlain(row.getCell(volumeCol).value) : null,
      numberTraded: numberTradedCol ? cellToPlain(row.getCell(numberTradedCol).value) : null,
      maturityDateCell: maturityCol ? cellToPlain(row.getCell(maturityCol).value) : null,
    });
  }
  return rows;
}

export function extractAllSheets(workbook: ExcelJS.Workbook): RawTradingReportRow[] {
  const kinds: TradingReportSheetKind[] = ["CORPORATE", "NEW_GOG", "OLD_GOG", "DDEP"];
  return kinds.flatMap((k) => extractSheetRows(workbook, k));
}

const REPORT_DATE_TEXT_RE = /Date:\s*[A-Za-z]+,\s*(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})/;
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Reads the report's own "Date: Friday, 02 October, 2026" text, present on
 * row 3 of every sheet — used as the Mode B (manual upload) fallback when
 * the analyst's filename doesn't follow GFIM's own naming convention
 * closely enough for `parseReportDateFromTitle` (provider.ts) to apply.
 * Checks every sheet in turn since not every report necessarily includes
 * all four category sheets.
 */
export function extractReportDateFromWorkbook(workbook: ExcelJS.Workbook): Date | null {
  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= Math.min(6, sheet.columnCount || 6); c++) {
        const value = cellToPlain(row.getCell(c).value);
        if (typeof value !== "string") continue;
        const match = REPORT_DATE_TEXT_RE.exec(value);
        if (!match) continue;
        const day = Number(match[1]);
        const month = MONTHS[match[2].toLowerCase()];
        const year = Number(match[3]);
        if (month === undefined) continue;
        const date = new Date(Date.UTC(year, month, day));
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) return date;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation / normalisation
// ---------------------------------------------------------------------------

export interface NormalisedTradingObservationRow {
  sheet: TradingReportSheetKind;
  isin: string;
  securityDescription: string | null;
  cleanPrice: string | null;
  sourceYieldPct: string | null;
  volumeTradedGhs: string | null;
  /** TRADED only when the source reports volume or a trade count for this date — see module header. */
  tradeStatus: "TRADED" | "NOT_TRADED";
  numberOfTrades: number | null;
  /** The source row's own maturity date (YYYY-MM-DD), for cross-checking the Securities Master — null when the cell is blank or not a usable date. */
  sourceMaturityDate: string | null;
}

export interface TradingReportValidationResult {
  /** Rows carrying a price and/or yield for an ISIN, each classified TRADED or NOT_TRADED (carried closing price). */
  traded: NormalisedTradingObservationRow[];
  /** Rows with a recognisable ISIN but neither price nor yield — nothing to record (CLAUDE.md: missing is not zero). */
  noTrade: { isin: string; sheet: TradingReportSheetKind }[];
  /** Rows that couldn't be parsed at all (malformed numeric cell etc.) — surfaced for analyst review, never silently dropped. */
  invalid: { row: RawTradingReportRow; errors: string[] }[];
}

function parseNumericCell(value: unknown, field: string, errors: string[]): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${field} is not a valid number: "${String(value)}"`);
    return null;
  }
  if (n <= 0) {
    errors.push(`${field} must be positive: "${String(value)}"`);
    return null;
  }
  return n.toString();
}

function parseCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The maturity cell as an ISO date, or null. GFIM's date columns contain
 * occasional Excel-serial junk (e.g. 1899-12-31 for an empty date cell),
 * so anything outside a plausible bond-maturity range is treated as absent
 * rather than compared — it is provenance, not a contractual term.
 */
export function parseSourceDate(value: unknown): string | null {
  let d: Date | null = null;
  if (value instanceof Date) d = value;
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) d = new Date(`${value.trim().slice(0, 10)}T00:00:00.000Z`);
  if (!d || Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/** True when the source reports trading activity for the row's date — volume or a trade count above zero. */
export function isTradedRow(volumeTradedGhs: string | null, numberOfTrades: number | null): boolean {
  return (volumeTradedGhs !== null && Number(volumeTradedGhs) > 0) || (numberOfTrades !== null && numberOfTrades > 0);
}

export function validateTradingReportRows(rows: RawTradingReportRow[]): TradingReportValidationResult {
  const traded: NormalisedTradingObservationRow[] = [];
  const noTrade: { isin: string; sheet: TradingReportSheetKind }[] = [];
  const invalid: { row: RawTradingReportRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];
    const cleanPrice = parseNumericCell(row.closingPrice, "closing_price", errors);
    const sourceYieldPct = row.sheet === "CORPORATE" ? null : parseNumericCell(row.closingYield, "closing_yield", errors);
    const volumeTradedGhs = parseNumericCell(row.volume, "volume", errors);

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    if (cleanPrice === null && sourceYieldPct === null) {
      noTrade.push({ isin: row.isin!, sheet: row.sheet });
      continue;
    }

    const numberOfTrades = parseCount(row.numberTraded);
    traded.push({
      sheet: row.sheet,
      isin: row.isin!,
      securityDescription: typeof row.securityDescription === "string" ? row.securityDescription.trim() : null,
      cleanPrice,
      sourceYieldPct,
      volumeTradedGhs,
      tradeStatus: isTradedRow(volumeTradedGhs, numberOfTrades) ? "TRADED" : "NOT_TRADED",
      numberOfTrades,
      sourceMaturityDate: parseSourceDate(row.maturityDateCell),
    });
  }

  return { traded, noTrade, invalid };
}
