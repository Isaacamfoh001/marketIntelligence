// ---------------------------------------------------------------------------
// Bank of Ghana Treasury Bill Rates parsing.
//
// Two raw shapes feed the same row model, exactly mirroring bog-fx-parser:
//  - HTML: the Treasury Bill Rates page server-renders a table with
//    columns [Issue Date, Tender, Security Type, Discount Rate, Interest
//    Rate] directly in its initial markup — the 10 most recent auction
//    rows across every security type BoG issues, no JS required.
//  - JSON: the same page's own paginated data-loading endpoint (see
//    bog-treasury-provider.ts) returns rows as 5-element string arrays
//    in the same column order, filtered server-side to one security type
//    per request.
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import { parseDecimal } from "../validation/index";
import { parseBogDate } from "./bog-date";

export interface RawTreasuryRow {
  dateText: string;
  tenderNumber: string;
  securityType: string;
  discountText: string;
  interestText: string;
}

export interface NormalisedTreasuryRow {
  observationDate: Date;
  securityType: string;
  tenderNumber: string | null;
  discountRate: string;
  interestRate: string;
}

// Only bills are in scope for Day 4; bonds/notes are ignored, not rejected.
export const SUPPORTED_SECURITY_TYPES = ["91 DAY BILL", "182 DAY BILL", "364 DAY BILL"] as const;

// ---------------------------------------------------------------------------
// Extraction — pull candidate rows out of either raw shape
// ---------------------------------------------------------------------------

/**
 * Extract Treasury rows from the page's server-rendered HTML. Does not
 * depend on a specific table id; scans every table row for the 5-cell
 * [date, tender, security type, discount, interest] shape.
 */
export function extractRowsFromHtml(html: string): RawTreasuryRow[] {
  const $ = cheerio.load(html);
  const rows: RawTreasuryRow[] = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();

    if (cells.length !== 5) return;
    const [dateText, tenderNumber, securityType, discountText, interestText] = cells;
    if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(dateText)) return;

    rows.push({ dateText, tenderNumber, securityType, discountText, interestText });
  });

  return rows;
}

/**
 * Extract Treasury rows from the historical AJAX endpoint's JSON `data`
 * array, where each row is [date, tender, security type, discount, interest].
 */
export function extractRowsFromAjaxJson(json: unknown): RawTreasuryRow[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];

  const rows: RawTreasuryRow[] = [];
  for (const entry of data) {
    if (!Array.isArray(entry) || entry.length !== 5) continue;
    const [dateText, tenderNumber, securityType, discountText, interestText] = entry as string[];
    if (typeof securityType !== "string") continue;
    rows.push({ dateText, tenderNumber, securityType, discountText, interestText });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Validation + normalisation
// ---------------------------------------------------------------------------

export interface TreasuryValidationResult {
  valid: NormalisedTreasuryRow[];
  invalid: { row: RawTreasuryRow; errors: string[] }[];
}

/**
 * Validates and normalises rows already filtered to the security types
 * this ingestion cares about. Sanity-checks interestRate >= discountRate
 * (the interest-equivalent yield is always at or above the discount rate
 * once compounded) without hardcoding absolute yield bounds, since rates
 * move with macro conditions.
 */
export function validateTreasuryRows(rows: RawTreasuryRow[]): TreasuryValidationResult {
  const valid: NormalisedTreasuryRow[] = [];
  const invalid: { row: RawTreasuryRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseBogDate(row.dateText, "issue_date");
    if (parsedDate.error) errors.push(parsedDate.error.message);

    if (!SUPPORTED_SECURITY_TYPES.includes(row.securityType as (typeof SUPPORTED_SECURITY_TYPES)[number])) {
      errors.push(`security_type is not a supported tenor: "${row.securityType}"`);
    }

    const discount = parseDecimal(row.discountText, "discount_rate");
    if (discount.error) errors.push(discount.error.message);

    const interest = parseDecimal(row.interestText, "interest_rate");
    if (interest.error) errors.push(interest.error.message);

    if (errors.length === 0 && discount.value && interest.value) {
      if (Number(interest.value) < Number(discount.value)) {
        errors.push(`interest_rate (${interest.value}) is below discount_rate (${discount.value})`);
      }
    }

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    const tenderNumber = row.tenderNumber.trim();
    valid.push({
      observationDate: parsedDate.date!,
      securityType: row.securityType,
      tenderNumber: tenderNumber === "" ? null : tenderNumber,
      discountRate: discount.value!,
      interestRate: interest.value!,
    });
  }

  return { valid, invalid };
}
