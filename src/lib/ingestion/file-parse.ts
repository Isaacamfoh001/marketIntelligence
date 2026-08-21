// ---------------------------------------------------------------------------
// Generic CSV/Excel row extraction for manual/semi-automated imports
// (CLAUDE.md §20, Mode B/C). Shared by every GSE import type — this file
// knows nothing about GSE-specific columns; it only turns a file into
// header-normalized rows. Column meaning is resolved by each dataset's own
// parser (see gse-security-parser.ts, gse-index-parser.ts) via alias maps,
// so the same importer accepts both Korbly's own documented CSV template
// and a reasonably-shaped export copied straight out of an official GSE
// table without any code change.
//
// PDF is deliberately not supported here: CLAUDE.md prefers CSV/Excel over
// PDF parsing, and a hand-rolled PDF table extractor is exactly the kind
// of brittle, hard-to-validate mechanism the project's data-quality
// principles warn against. A PDF report must be re-typed/exported to
// CSV/Excel by whoever is importing it.
// ---------------------------------------------------------------------------

import ExcelJS from "exceljs";

export interface ParsedFile {
  /** Original headers, in file order, verbatim. */
  rawHeaders: string[];
  /** Rows keyed by normalized header → raw cell text (never coerced). Blank cells are "". */
  rows: Record<string, string>[];
}

export class FileParseError extends Error {}

/**
 * Lowercases, strips punctuation, and collapses whitespace so header
 * matching is resilient to "Closing Price - VWAP" vs "closing_price_vwap"
 * vs "Closing Price (VWAP)".
 *
 * Parenthetical groups are dropped entirely (not just their punctuation)
 * before that normalization: a currency/unit annotation like "(GH¢)" would
 * otherwise leave a dangling "gh" token once the non-ASCII ¢ symbol is
 * stripped — e.g. "Closing Price - VWAP (GH¢)" (GSE's own real export
 * header) would normalize to "closing price vwap gh" and silently fail to
 * match the "closing price vwap" alias for every field, including the
 * required close_vwap column. A parenthetical is commentary about the
 * field, never part of its identity, so removing it whole is always safe.
 */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// CSV — hand-rolled RFC4180-ish parser (quoted fields, embedded commas,
// embedded newlines, "" escaped quotes). No external dependency: this is a
// small, fully-testable state machine, consistent with validation/index.ts's
// "no external framework" convention.
// ---------------------------------------------------------------------------

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) pushRow();

  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function parseCsv(text: string): ParsedFile {
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    throw new FileParseError("File is empty");
  }
  const rawHeaders = records[0].map((h) => h.trim());
  const normalizedHeaders = rawHeaders.map(normalizeHeader);

  const rows: Record<string, string>[] = [];
  for (const record of records.slice(1)) {
    const row: Record<string, string> = {};
    normalizedHeaders.forEach((h, idx) => {
      row[h] = (record[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { rawHeaders, rows };
}

// ---------------------------------------------------------------------------
// Excel (.xlsx/.xls) — first worksheet, first row as headers.
// ---------------------------------------------------------------------------

function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

/** Converts an exceljs cell value to the same kind of display string a CSV cell would already be — dates become YYYY-MM-DD (accepted by parseGseFileDate), formulas resolve to their computed result, everything else stringifies plainly. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${twoDigits(value.getUTCMonth() + 1)}-${twoDigits(value.getUTCDate())}`;
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    return "";
  }
  return String(value).trim();
}

export async function parseExcel(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (err) {
    throw new FileParseError(`Could not read Excel file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new FileParseError("Excel file has no worksheets");
  if (sheet.rowCount === 0) throw new FileParseError("Excel worksheet is empty");

  const headerRow = sheet.getRow(1);
  const rawHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    rawHeaders.push(cellToString(cell.value).trim());
  });
  if (rawHeaders.length === 0 || rawHeaders.every((h) => h === "")) {
    throw new FileParseError("Excel worksheet is empty");
  }
  const normalizedHeaders = rawHeaders.map(normalizeHeader);

  const rows: Record<string, string>[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const excelRow = sheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let col = 1; col <= rawHeaders.length; col++) {
      cells.push(cellToString(excelRow.getCell(col).value));
    }
    if (cells.every((c) => c.trim() === "")) continue; // skip fully blank rows
    const row: Record<string, string> = {};
    normalizedHeaders.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }

  return { rawHeaders, rows };
}

/** Dispatches on file extension. `.csv` → parseCsv (text), anything else → parseExcel (buffer). */
export async function parseImportFile(filename: string, buffer: Buffer): Promise<ParsedFile> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(buffer.toString("utf-8"));
  }
  if (filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls")) {
    return parseExcel(buffer);
  }
  throw new FileParseError(`Unsupported file type: "${filename}" — expected .csv, .xlsx, or .xls`);
}

/** Finds the first header (already normalized) matching any of the given alias strings (also normalized). */
export function findHeader(normalizedHeaders: string[], aliases: string[]): string | null {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return normalizedHeaders.find((h) => normalizedAliases.has(h)) ?? null;
}
