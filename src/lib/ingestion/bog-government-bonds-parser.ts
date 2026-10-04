// ---------------------------------------------------------------------------
// Bank of Ghana government bond/note AUCTION parsing (M7.1 §7).
//
// Reuses bog-treasury-parser.ts's row extraction unchanged — BoG's Treasury
// Bill Rates page publishes bills AND longer-tenor fixed-rate notes/bonds
// in the exact same 5-column shape (date, tender, security type, discount,
// interest); bog-treasury-provider.ts simply filters the non-bill rows
// out. This module picks up exactly those rows instead of duplicating the
// HTML/AJAX extraction a second time.
//
// For a fixed-rate note/bond auction, BoG publishes discountRate ==
// interestRate (verified, M7.1 research) — it is literally the auction's
// clearing COUPON rate, not a discount-style quote. This is a PRIMARY
// AUCTION observation (ObservationKind.AUCTION_PRIMARY), never a
// secondary-market yield.
//
// M7.1 research finding: most note/bond tenors in this feed have no
// auction newer than 2018-2022 (Ghana's Dec-2022 domestic debt
// restructuring appears to have discontinued regular auctions at those
// tenors) — importing them as "currently active" would misrepresent stale
// history as current. `isRecentEnough` enforces a cutoff so only genuinely
// recent auctions (verified example: the 07 Sep 2026 4-Year Bond,
// cross-confirmed against independent news coverage) are ever imported.
// ---------------------------------------------------------------------------

import { parseBogDate } from "./bog-date";
import type { RawTreasuryRow } from "./bog-treasury-parser";

export { extractRowsFromHtml, extractRowsFromAjaxJson } from "./bog-treasury-parser";

const SECURITY_TYPE_RE = /^(\d+)\s*YR\s*FXR\s*(BOND|NOTE)$/;

export interface NormalisedGovBondRow {
  observationDate: Date;
  tenorYears: number;
  securityType: string;
  tenderNumber: string | null;
  ratePct: string;
}

export interface GovBondValidationResult {
  valid: NormalisedGovBondRow[];
  invalid: { row: RawTreasuryRow; errors: string[] }[];
}

/** Only rows whose security type matches "N YR FXR BOND/NOTE" (never a bill) are candidates at all. */
export function filterGovBondCandidateRows(rows: RawTreasuryRow[]): RawTreasuryRow[] {
  return rows.filter((r) => SECURITY_TYPE_RE.test(r.securityType.trim().toUpperCase()));
}

/**
 * A row counts as "currently active" only if its auction date falls within
 * `maxAgeDays` of `now` — never a universal constant across the codebase,
 * explicit per call so the cutoff's purpose (exclude pre-restructuring
 * history) stays visible at the call site.
 */
export function isRecentEnough(observationDate: Date, now: Date, maxAgeDays: number): boolean {
  const ageDays = (now.getTime() - observationDate.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays <= maxAgeDays;
}

export function validateGovBondRows(rows: RawTreasuryRow[]): GovBondValidationResult {
  const valid: NormalisedGovBondRow[] = [];
  const invalid: { row: RawTreasuryRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseBogDate(row.dateText, "issue_date");
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const match = SECURITY_TYPE_RE.exec(row.securityType.trim().toUpperCase());
    if (!match) errors.push(`security_type is not a government bond/note: "${row.securityType}"`);

    const discount = Number(row.discountText);
    const interest = Number(row.interestText);
    if (!Number.isFinite(discount) || !Number.isFinite(interest)) {
      errors.push(`rate is not a valid number: discount="${row.discountText}" interest="${row.interestText}"`);
    } else if (Math.abs(discount - interest) > 0.01) {
      // A genuine discount-style quote (discount != interest) would mean
      // this isn't the flat fixed-coupon auction rate we expect for an
      // FXR bond/note — reject rather than guess which number is the
      // coupon.
      errors.push(`discount_rate (${row.discountText}) and interest_rate (${row.interestText}) differ — not a recognised fixed-rate auction quote`);
    }

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    const tenderNumber = row.tenderNumber.trim();
    valid.push({
      observationDate: parsedDate.date!,
      tenorYears: Number(match![1]),
      securityType: row.securityType,
      tenderNumber: tenderNumber === "" ? null : tenderNumber,
      ratePct: row.interestText.trim(),
    });
  }

  return { valid, invalid };
}
