// ---------------------------------------------------------------------------
// Batch position entry (M9.0). Pure. Several instruments are prepared together
// but each keeps its OWN financial semantics — bonds a nominal GHS amount,
// equities a whole number of shares, Treasury bills a tenor + maturity + face
// amount. There is no generic "quantity" field.
//
// SEMANTICS (decision): ALL-OR-NOTHING. Every row is validated first; if any
// row is invalid nothing is saved and every row's problem is reported at once.
// Partial saves would leave the analyst unsure what is in the portfolio, and
// the rows are cheap to fix and resubmit. The write itself is one database
// transaction (src/lib/portfolio-service.ts addPositionsBatch).
// ---------------------------------------------------------------------------

import { parseEnteredNumber, validatePositionDraft } from "./positions";

/** What the form submits — raw strings, never trusted. */
export type BatchEntryInput =
  | { key: string; assetClass: "BOND"; instrumentId: string; nominalGhs: string }
  | { key: string; assetClass: "EQUITY"; instrumentId: string; shares: string }
  | { key: string; assetClass: "TREASURY_BILL"; tenorDays: number; maturityDate: string; faceValueGhs: string; isin?: string };

export type ParsedBatchEntry =
  | { key: string; assetClass: "BOND"; instrumentId: string; nominalGhs: number }
  | { key: string; assetClass: "EQUITY"; instrumentId: string; shares: number }
  | { key: string; assetClass: "TREASURY_BILL"; tenorDays: number; maturityDate: string; faceValueGhs: number; isin: string | null };

export interface BatchRowError {
  key: string;
  error: string;
}

export const MAX_BATCH_SIZE = 50;

/** The instrument identity of an entry — two entries with the same identity are duplicates. */
export function batchIdentity(e: BatchEntryInput | ParsedBatchEntry): string {
  return e.assetClass === "TREASURY_BILL" ? `BILL:${e.tenorDays}:${e.maturityDate}` : `${e.assetClass}:${e.instrumentId}`;
}

/** Shape + size validation of every entry, with no database. Returns the parsed entries and every row's error. */
export function validateBatchEntries(entries: BatchEntryInput[]): { ok: true; entries: ParsedBatchEntry[] } | { ok: false; errors: BatchRowError[] } {
  if (entries.length === 0) return { ok: false, errors: [{ key: "", error: "Select at least one instrument." }] };
  if (entries.length > MAX_BATCH_SIZE) return { ok: false, errors: [{ key: "", error: `Add at most ${MAX_BATCH_SIZE} positions at a time.` }] };
  const errors: BatchRowError[] = [];
  const parsed: ParsedBatchEntry[] = [];
  const seenKeys = new Set<string>();
  const seenIdentity = new Set<string>();
  for (const e of entries) {
    if (seenKeys.has(e.key)) {
      errors.push({ key: e.key, error: "Duplicate row." });
      continue;
    }
    seenKeys.add(e.key);
    const id = batchIdentity(e);
    if (seenIdentity.has(id)) {
      errors.push({ key: e.key, error: "This instrument is selected more than once." });
      continue;
    }
    seenIdentity.add(id);

    if (e.assetClass === "EQUITY") {
      if (!e.instrumentId) { errors.push({ key: e.key, error: "Choose an instrument." }); continue; }
      const n = parseEnteredNumber(String(e.shares ?? ""));
      const size = validatePositionDraft({ assetClass: "EQUITY", shares: n, currency: "GHS" });
      if (n === null) errors.push({ key: e.key, error: "Enter the number of shares as a whole number." });
      else if (!size.ok) errors.push({ key: e.key, error: size.error });
      else if (size.assetClass === "EQUITY") parsed.push({ key: e.key, assetClass: "EQUITY", instrumentId: e.instrumentId, shares: size.shares });
    } else if (e.assetClass === "BOND") {
      if (!e.instrumentId) { errors.push({ key: e.key, error: "Choose an instrument." }); continue; }
      const n = parseEnteredNumber(String(e.nominalGhs ?? ""));
      const size = validatePositionDraft({ assetClass: "BOND", nominalGhs: n, currency: "GHS" });
      if (n === null) errors.push({ key: e.key, error: "Enter the nominal amount in GHS as a number." });
      else if (!size.ok) errors.push({ key: e.key, error: size.error });
      else if (size.assetClass === "BOND") parsed.push({ key: e.key, assetClass: "BOND", instrumentId: e.instrumentId, nominalGhs: size.nominalGhs });
    } else if (e.assetClass === "TREASURY_BILL") {
      const n = parseEnteredNumber(String(e.faceValueGhs ?? ""));
      const size = validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: n, currency: "GHS" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.maturityDate)) errors.push({ key: e.key, error: "Enter the maturity date." });
      else if (n === null) errors.push({ key: e.key, error: "Enter the face amount in GHS as a number." });
      else if (!size.ok) errors.push({ key: e.key, error: size.error });
      else if (size.assetClass === "TREASURY_BILL") parsed.push({ key: e.key, assetClass: "TREASURY_BILL", tenorDays: e.tenorDays, maturityDate: e.maturityDate, faceValueGhs: size.faceValueGhs, isin: (e.isin ?? "").trim().toUpperCase() || null });
    } else {
      errors.push({ key: (e as { key: string }).key, error: "Unknown instrument type." });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries: parsed };
}
