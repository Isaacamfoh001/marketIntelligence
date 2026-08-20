// ---------------------------------------------------------------------------
// Bank of Ghana Monetary Policy Rate parsing.
//
// Source: https://www.bog.gov.gh/monetary-policy/policy-rate-trends/
// "Historical Policy Rate Decisions" table — columns [Meeting No.,
// MPC Dates, Effective Date, BOG Policy Rate]. Unlike FX/Treasury, the
// ENTIRE history (130 rows, 2002 → present at time of writing) is
// server-rendered in the page's initial HTML with no AJAX/pagination
// involved at all — the least brittle BoG source found so far.
//
// "Effective Date" (not the "MPC Dates" range text) is used as the
// observation date: it's a single clean "DD MMM YYYY" value, whereas
// "MPC Dates" is a human-readable range ("November 20 – 21, 2002") not
// meant for machine parsing.
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import { parseDecimal } from "../validation/index";
import { parseBogDate } from "./bog-date";

export interface RawMprRow {
  meetingNumber: string;
  mpcDates: string;
  effectiveDateText: string;
  rateText: string;
}

export interface NormalisedMprRow {
  effectiveDate: Date;
  rate: string;
}

/**
 * Extract MPR decision rows from the Policy Rate Trends page's
 * server-rendered HTML. Scans every table row for the 4-cell
 * [meeting no., MPC dates, effective date, rate] shape, identified by
 * the 3rd cell looking like a BoG "DD MMM YYYY" date.
 */
export function extractRowsFromHtml(html: string): RawMprRow[] {
  const $ = cheerio.load(html);
  const rows: RawMprRow[] = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();

    if (cells.length !== 4) return;
    const [meetingNumber, mpcDates, effectiveDateText, rateText] = cells;
    if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(effectiveDateText)) return;

    rows.push({ meetingNumber, mpcDates, effectiveDateText, rateText });
  });

  return rows;
}

export interface MprValidationResult {
  valid: NormalisedMprRow[];
  invalid: { row: RawMprRow; errors: string[] }[];
}

/** Broad sanity bound only — a policy rate of 0–100% covers any regime BoG has run. */
export function validateMprRows(rows: RawMprRow[]): MprValidationResult {
  const valid: NormalisedMprRow[] = [];
  const invalid: { row: RawMprRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseBogDate(row.effectiveDateText, "effective_date");
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const rate = parseDecimal(row.rateText, "rate");
    if (rate.error) errors.push(rate.error.message);
    else if (Number(rate.value) < 0 || Number(rate.value) > 100) {
      errors.push(`rate is outside a plausible policy-rate range: "${row.rateText}"`);
    }

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    valid.push({ effectiveDate: parsedDate.date!, rate: rate.value! });
  }

  return { valid, invalid };
}
