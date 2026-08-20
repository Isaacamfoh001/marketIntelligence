// ---------------------------------------------------------------------------
// Bank of Ghana FX parsing.
//
// Two raw shapes feed the same row model:
//  - HTML: the Daily Interbank FX Rates page server-renders a table with
//    columns [Date, Currency, Currency Pair, Buying, Selling, Mid Rate]
//    directly in its initial markup (verified: no JS execution required).
//  - JSON: the Historical Interbank FX Rates page's own data-loading
//    endpoint (see bog-fx-provider.ts) returns rows as 6-element string
//    arrays in the same column order.
//
// Both are reduced to the same RawBogFxRow shape so validation/normalize
// logic is written once.
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import { parseDecimal } from "../validation/index";
import { parseBogDate } from "./bog-date";

export interface RawBogFxRow {
  dateText: string;
  currencyName: string;
  pairCode: string;
  buyingText: string;
  sellingText: string;
  midText: string;
}

export interface NormalisedBogFxRow {
  observationDate: Date;
  pairCode: string;
  buyingRate: string | null;
  sellingRate: string | null;
  midRate: string;
}

const CURRENCY_PAIR_RE = /^[A-Z]{6}$/;

// ---------------------------------------------------------------------------
// Extraction — pull candidate rows out of either raw shape
// ---------------------------------------------------------------------------

/**
 * Extract FX rows from the Daily/Historical page's server-rendered HTML.
 * Deliberately does not depend on a specific table id (BoG's WordPress
 * site renumbers those); instead it scans every table row for the
 * 6-cell [date, currency, pair, buying, selling, mid] shape and keeps
 * only rows whose pair code looks like a currency pair.
 */
export function extractRowsFromHtml(html: string): RawBogFxRow[] {
  const $ = cheerio.load(html);
  const rows: RawBogFxRow[] = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();

    if (cells.length !== 6) return;
    const [dateText, currencyName, pairCode, buyingText, sellingText, midText] = cells;
    if (!CURRENCY_PAIR_RE.test(pairCode)) return;

    rows.push({ dateText, currencyName, pairCode, buyingText, sellingText, midText });
  });

  return rows;
}

/**
 * Extract FX rows from the historical AJAX endpoint's JSON `data` array,
 * where each row is [date, currency, pair, buying, selling, mid].
 */
export function extractRowsFromAjaxJson(json: unknown): RawBogFxRow[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];

  const rows: RawBogFxRow[] = [];
  for (const entry of data) {
    if (!Array.isArray(entry) || entry.length !== 6) continue;
    const [dateText, currencyName, pairCode, buyingText, sellingText, midText] = entry as string[];
    if (typeof pairCode !== "string" || !CURRENCY_PAIR_RE.test(pairCode)) continue;
    rows.push({ dateText, currencyName, pairCode, buyingText, sellingText, midText });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Date parsing — BoG publishes "DD MMM YYYY" (e.g. "19 Aug 2026").
// Shared across BoG pages; see bog-date.ts. Re-exported under the
// FX-specific name for existing call sites/tests.
// ---------------------------------------------------------------------------

export const parseBogFxDate = parseBogDate;

// ---------------------------------------------------------------------------
// Validation + normalisation
// ---------------------------------------------------------------------------

export interface BogFxValidationResult {
  valid: NormalisedBogFxRow[];
  invalid: { row: RawBogFxRow; errors: string[] }[];
}

/**
 * Validates and normalises rows already filtered to the pairs this
 * ingestion cares about. Sanity-checks buying <= mid <= selling when all
 * three are present; does not hardcode absolute rate bounds since the
 * cedi's level will keep moving and a static bound would eventually
 * reject genuine data.
 */
export function validateBogFxRows(rows: RawBogFxRow[]): BogFxValidationResult {
  const valid: NormalisedBogFxRow[] = [];
  const invalid: { row: RawBogFxRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseBogFxDate(row.dateText);
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const mid = parseDecimal(row.midText, "mid_rate");
    if (mid.error) errors.push(mid.error.message);

    // Buying/selling are optional: BoG may occasionally publish mid only.
    // An empty/blank cell is "not published", not zero — only a
    // non-blank value that fails to parse is a validation error.
    const buyingText = row.buyingText.trim();
    const buying = buyingText === "" ? { value: null, error: null } : parseDecimal(row.buyingText, "buying_rate");
    if (buying.error) errors.push(buying.error.message);

    const sellingText = row.sellingText.trim();
    const selling = sellingText === "" ? { value: null, error: null } : parseDecimal(row.sellingText, "selling_rate");
    if (selling.error) errors.push(selling.error.message);

    if (errors.length === 0 && buying.value && selling.value && mid.value) {
      const b = Number(buying.value);
      const m = Number(mid.value);
      const s = Number(selling.value);
      if (!(b <= m && m <= s)) {
        errors.push(`buying/mid/selling out of order: buying=${b}, mid=${m}, selling=${s}`);
      }
    }

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    valid.push({
      observationDate: parsedDate.date!,
      pairCode: row.pairCode,
      buyingRate: buying.value,
      sellingRate: selling.value,
      midRate: mid.value!,
    });
  }

  return { valid, invalid };
}
