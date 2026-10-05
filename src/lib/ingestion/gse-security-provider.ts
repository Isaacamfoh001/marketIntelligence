// ---------------------------------------------------------------------------
// GSE Daily Shares & ETFs — security price import provider.
//
// Source discovery (re-verified 5 Oct 2026): the free official route is the
// "Daily Shares & ETFs" table on https://gse.com.gh/trading-and-data/, which a
// person can filter and export as CSV/Excel. Its data is published through an
// undocumented WordPress/wpDataTables widget (a page-scoped nonce posted to
// admin-ajax.php), not a documented API. GSE's own "Data Services" page states
// that real-time / end-of-day / historical data is offered through an API
// platform or direct request against a price list — i.e. automated delivery is
// a COMMERCIAL product. An earlier version of this file recorded a robots.txt
// opt-out for AI agents and a site-wide 403; on 5 Oct 2026 robots.txt allowed
// all user agents and pages returned 200 — but robots.txt permitting access is
// not a licence to build an unattended feed on an undocumented widget, so this
// provider remains a controlled import of the OFFICIAL EXPORT. Unattended
// automation should come from a GSE Data Services agreement (CLAUDE.md §7.C).
//
// A human exports the file (an analyst's ordinary browser session) and imports it
// as CSV or Excel. Two DataSources exist for the same row shape:
//   - "Ghana Stock Exchange — Daily Shares & ETFs": the routine daily
//     export. Treated as the higher-priority source for any date it has
//     data for.
//   - "Ghana Stock Exchange — Market Report Backfill": historical/report
//     exports (e.g. monthly market reports) used to extend history or
//     cross-validate. Lower priority — mirrors M5.1's GSS CPI merge
//     pattern exactly: never silently overwrites a value the higher-
//     priority source already owns for that date; a genuine disagreement
//     is reported as a conflict, not applied.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import type { Prisma } from "../../generated/prisma/client";
import { parseImportFile } from "./file-parse";
import { extractGseSecurityRows, validateGseSecurityRows, type NormalisedGseSecurityRow, type RawGseSecurityRow } from "./gse-security-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

/** Interactive-transaction ceiling for one file. A multi-week export is ~1,300 rows; the default 5s is too tight. */
const PERSIST_TX_TIMEOUT_MS = 120_000;

/** How a human-obtained official file reaches Korbly — recorded on every run (IngestionRun.acquisitionMethod). */
export const GSE_ACQUISITION_METHOD = "MANUAL_FILE_IMPORT";

/** GSE's public Trading & Data page (Daily Shares & ETFs table + CSV/Excel export). The previous /market-statistics/ URL now returns 404. */
export const GSE_TRADING_DATA_URL = "https://gse.com.gh/trading-and-data/";
import { KNOWN_COMPANY_NAMES, KNOWN_COMPANY_SECTORS } from "../gse-known-companies";

export type SecurityImportKind = "daily" | "backfill";

const DAILY_SOURCE_NAME = "Ghana Stock Exchange — Daily Shares & ETFs";
const BACKFILL_SOURCE_NAME = "Ghana Stock Exchange — Market Report Backfill";

// Higher number = higher priority. Daily Shares & ETFs is the routine,
// closest-to-publication source; Market Report Backfill exists to extend
// history or cross-validate and never silently overrides it.
const SOURCE_PRIORITY: Record<SecurityImportKind, number> = { daily: 2, backfill: 1 };

// ---------------------------------------------------------------------------
// DataSource bootstrap
// ---------------------------------------------------------------------------

/**
 * Registers both GSE security-price DataSource rows (metadata only — no
 * IngestionRun, no observations) so Data Centre can show them as
 * NOT_CONFIGURED/awaiting-first-import even before anyone has actually
 * run an import. Safe to call on every Data Centre page load: upsert is
 * idempotent and touches nothing beyond the DataSource row itself.
 */
export async function ensureGseSecurityDataSources() {
  const [daily, backfill] = await Promise.all([ensureDataSource("daily"), ensureDataSource("backfill")]);
  return { daily, backfill };
}

async function ensureDataSource(kind: SecurityImportKind) {
  const db = getPrisma();
  const name = kind === "daily" ? DAILY_SOURCE_NAME : BACKFILL_SOURCE_NAME;
  return db.dataSource.upsert({
    where: { name },
    update: { url: GSE_TRADING_DATA_URL },
    create: {
      name,
      provider: "Ghana Stock Exchange",
      sourceType: "MANUAL",
      url: GSE_TRADING_DATA_URL,
      expectedFrequency: kind === "daily" ? "DAILY" : "AD_HOC",
      ingestionMethod: "FILE_IMPORT",
      active: true,
    },
  });
}

async function ensureSecurity(
  ticker: string,
  companyName: string | null,
  securityType: string | null,
  cache: Map<string, string>,
  db: Prisma.TransactionClient,
  created: string[],
): Promise<string> {
  const cached = cache.get(ticker);
  if (cached) return cached;

  const existing = await db.security.findUnique({ where: { ticker } });
  if (existing) {
    cache.set(ticker, existing.id);
    return existing.id;
  }

  // A Company may already exist for this ticker (e.g. created by an M7
  // company-financials import before any GSE price data existed for it)
  // — link to it rather than colliding with Company.ticker's unique
  // constraint by attempting to create a duplicate.
  const existingCompany = await db.company.findUnique({ where: { ticker } });
  const company =
    existingCompany ??
    (await db.company.create({
      data: {
        name: companyName ?? KNOWN_COMPANY_NAMES[ticker] ?? ticker,
        ticker,
        sector: KNOWN_COMPANY_SECTORS[ticker] ?? null,
      },
    }));
  const security = await db.security.create({
    data: {
      companyId: company.id,
      ticker,
      securityType: (securityType as never) ?? "ORDINARY_SHARE",
    },
  });
  cache.set(ticker, security.id);
  created.push(ticker);
  return security.id;
}

type StoredPrice = {
  previousCloseVwap: unknown; openPrice: unknown; lastTransactionPrice: unknown; closeVwap: unknown; priceChange: unknown;
  yearHigh: unknown; yearLow: unknown; closingBid: unknown; closingOffer: unknown; volume: bigint | null; valueTradedGhs: unknown;
};

function sameStoredObservation(stored: StoredPrice, row: NormalisedGseSecurityRow): boolean {
  const eq = (a: unknown, b: string | null) => (a === null || a === undefined ? b === null : b !== null && Number(a) === Number(b));
  return (
    eq(stored.previousCloseVwap, row.previousCloseVwap) &&
    eq(stored.openPrice, row.openPrice) &&
    eq(stored.lastTransactionPrice, row.lastTransactionPrice) &&
    eq(stored.closeVwap, row.closeVwap) &&
    eq(stored.priceChange, row.priceChange) &&
    eq(stored.yearHigh, row.yearHigh) &&
    eq(stored.yearLow, row.yearLow) &&
    eq(stored.closingBid, row.closingBid) &&
    eq(stored.closingOffer, row.closingOffer) &&
    eq(stored.valueTradedGhs, row.valueTraded) &&
    (stored.volume === null ? row.sharesTraded === null : row.sharesTraded !== null && Number(stored.volume) === Math.round(Number(row.sharesTraded)))
  );
}

// ---------------------------------------------------------------------------
// Persist with source-priority conflict detection (mirrors
// gss-cpi-provider.ts's persistYoyRespectingPriority).
// ---------------------------------------------------------------------------

export interface SecurityPriceConflict {
  ticker: string;
  tradingDate: string;
  incomingCloseVwap: string;
  existingCloseVwap: string;
}

async function persistSecurityPrices(
  db: Prisma.TransactionClient,
  runId: string,
  sourceId: string,
  importKind: SecurityImportKind,
  dailySourceId: string,
  backfillSourceId: string,
  securityIdByTicker: Map<string, string>,
  rows: NormalisedGseSecurityRow[],
): Promise<{ persisted: number; inserted: number; updated: number; unchanged: number; conflicts: SecurityPriceConflict[] }> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const conflicts: SecurityPriceConflict[] = [];
  const currentRank = SOURCE_PRIORITY[importKind];

  for (const row of rows) {
    const securityId = securityIdByTicker.get(row.ticker);
    if (!securityId) continue;

    const existing = await db.securityPrice.findUnique({
      where: { securityId_tradingDate: { securityId, tradingDate: row.tradingDate } },
      include: { ingestionRun: true },
    });

    if (existing) {
      const existingRank = existing.ingestionRun.dataSourceId === dailySourceId ? SOURCE_PRIORITY.daily : SOURCE_PRIORITY.backfill;
      if (existingRank > currentRank) {
        if (Number(existing.closeVwap) !== Number(row.closeVwap)) {
          conflicts.push({
            ticker: row.ticker,
            tradingDate: row.tradingDate.toISOString().slice(0, 10),
            incomingCloseVwap: row.closeVwap,
            existingCloseVwap: existing.closeVwap.toString(),
          });
        }
        continue; // never let a lower-priority source overwrite a higher-priority observation
      }
    }

    // Re-importing an identical row must be a true no-op: leave the stored row —
    // and its ORIGINAL ingestion run / source / retrievedAt provenance — untouched.
    if (existing && sameStoredObservation(existing, row)) {
      unchanged++;
      continue;
    }

    await db.securityPrice.upsert({
      where: { securityId_tradingDate: { securityId, tradingDate: row.tradingDate } },
      update: {
        previousCloseVwap: row.previousCloseVwap,
        openPrice: row.openPrice,
        lastTransactionPrice: row.lastTransactionPrice,
        closeVwap: row.closeVwap,
        priceChange: row.priceChange,
        yearHigh: row.yearHigh,
        yearLow: row.yearLow,
        closingBid: row.closingBid,
        closingOffer: row.closingOffer,
        volume: row.sharesTraded !== null ? BigInt(Math.round(Number(row.sharesTraded))) : null,
        valueTradedGhs: row.valueTraded,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        securityId,
        tradingDate: row.tradingDate,
        previousCloseVwap: row.previousCloseVwap,
        openPrice: row.openPrice,
        lastTransactionPrice: row.lastTransactionPrice,
        closeVwap: row.closeVwap,
        priceChange: row.priceChange,
        yearHigh: row.yearHigh,
        yearLow: row.yearLow,
        closingBid: row.closingBid,
        closingOffer: row.closingOffer,
        volume: row.sharesTraded !== null ? BigInt(Math.round(Number(row.sharesTraded))) : null,
        valueTradedGhs: row.valueTraded,
        sourceId,
        ingestionRunId: runId,
      },
    });
    if (existing) updated++;
    else inserted++;
  }

  return { persisted: inserted + updated, inserted, updated, unchanged, conflicts };
}

// ---------------------------------------------------------------------------
// Import entrypoint — two-phase (preview / commit), never mutates on
// preview (CLAUDE.md §20/§30).
// ---------------------------------------------------------------------------

export interface GseSecurityImportResult {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "PREVIEW";
  kind: SecurityImportKind;
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  inserted: number;
  updated: number;
  /** Rows already stored with identical values: skipped, original provenance preserved. */
  unchanged: number;
  /** Tickers that did not exist in the securities master and were created from this file (source identity = GSE share code). */
  newSecurities: string[];
  tickers: string[];
  earliestTradingDate: string | null;
  latestTradingDate: string | null;
  errors: { row: RawGseSecurityRow; errors: string[]; rowNumber: number }[];
  conflicts: SecurityPriceConflict[];
  /** First PREVIEW_SAMPLE_SIZE accepted rows — for a UI preview table, never the full set (a file can have thousands of rows). */
  sampleValid: NormalisedGseSecurityRow[];
}

export const PREVIEW_SAMPLE_SIZE = 50;

function latestDate(rows: { tradingDate: Date }[]): string | null {
  const max = rows.reduce<Date | null>((acc, r) => (!acc || r.tradingDate > acc ? r.tradingDate : acc), null);
  return max ? max.toISOString().slice(0, 10) : null;
}

function earliestDate(rows: { tradingDate: Date }[]): string | null {
  const min = rows.reduce<Date | null>((acc, r) => (!acc || r.tradingDate < acc ? r.tradingDate : acc), null);
  return min ? min.toISOString().slice(0, 10) : null;
}

/**
 * Preview mode parses/validates only — no DataSource is touched and no
 * IngestionRun is created, since nothing was actually attempted yet
 * (CLAUDE.md §20: "do not immediately mutate the database on file
 * selection"). A parse failure (unreadable file, wrong extension) is
 * reported the same way a validation failure is, not thrown, so a bad
 * file previews cleanly instead of crashing the caller.
 *
 * Commit mode creates the run FIRST, then does parsing, validation, and
 * persistence inside the try block — so a file that fails to parse *at
 * commit time* still produces a FAILED IngestionRun visible in Data
 * Centre, not a silent exception with no audit trail.
 */
export async function importGseSecurityPrices(
  filename: string,
  buffer: Buffer,
  kind: SecurityImportKind,
  opts: { commit: boolean; triggeredBy?: string; /** Test seam: the clock used for the future-date plausibility check. */ now?: Date } = { commit: false },
): Promise<GseSecurityImportResult> {
  if (!opts.commit) {
    try {
      const parsedFile = await parseImportFile(filename, buffer);
      const rawRows = extractGseSecurityRows(parsedFile);
      const validation = validateGseSecurityRows(rawRows, { now: opts.now });
      const tickers = Array.from(new Set(validation.valid.map((r) => r.ticker))).sort();
      return {
        runId: null,
        status: "PREVIEW",
        kind,
        recordsRead: rawRows.length,
        recordsAccepted: validation.valid.length,
        recordsRejected: validation.invalid.length,
        persisted: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        newSecurities: [],
        tickers,
        earliestTradingDate: earliestDate(validation.valid),
        latestTradingDate: latestDate(validation.valid),
        errors: validation.invalid,
        conflicts: [],
        sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        runId: null,
        status: "PREVIEW",
        kind,
        recordsRead: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        persisted: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        newSecurities: [],
        tickers: [],
        earliestTradingDate: null,
        latestTradingDate: null,
        errors: [{ row: {}, errors: [message], rowNumber: 0 }],
        conflicts: [],
        sampleValid: [],
      };
    }
  }

  const [dailySource, backfillSource] = await Promise.all([ensureDataSource("daily"), ensureDataSource("backfill")]);
  const activeSource = kind === "daily" ? dailySource : backfillSource;

  const { runId } = await startRun({
    dataSourceId: activeSource.id,
    triggeredBy: opts.triggeredBy ?? "cli",
    artifactName: filename,
    acquisitionMethod: GSE_ACQUISITION_METHOD,
  });

  const empty = { recordsRead: 0, recordsAccepted: 0, recordsRejected: 0 };
  try {
    const parsedFile = await parseImportFile(filename, buffer);
    const rawRows = extractGseSecurityRows(parsedFile);
    const validation = validateGseSecurityRows(rawRows, { now: opts.now });
    const counts = { recordsRead: rawRows.length, recordsAccepted: validation.valid.length, recordsRejected: validation.invalid.length };
    const tickers = Array.from(new Set(validation.valid.map((r) => r.ticker))).sort();

    // Whole-report rejection: a file in which NOTHING validates is a wrong/changed
    // file, not a data update. Fail loudly instead of recording a "successful" no-op.
    if (validation.valid.length === 0) {
      const why = validation.invalid[0]?.errors[0] ?? "the file contains no data rows";
      throw new ImportRejectedError(`No usable rows: 0 of ${rawRows.length} rows passed validation (first problem: ${why})`, counts);
    }

    // Row-level rejection for isolated bad rows (documented decision): good rows
    // are imported, bad rows are listed on the run, and the import is reported
    // with its reject count. All DB writes for the file happen in ONE transaction,
    // so a database failure part-way leaves no partial file behind.
    const db = getPrisma();
    const newSecurities: string[] = [];
    const persisted = await db.$transaction(
      async (tx) => {
        const securityIdByTicker = new Map<string, string>();
        for (const row of validation.valid) {
          if (!securityIdByTicker.has(row.ticker)) {
            securityIdByTicker.set(row.ticker, await ensureSecurity(row.ticker, row.companyName, row.securityType, securityIdByTicker, tx, newSecurities));
          }
        }
        return persistSecurityPrices(tx, runId, activeSource.id, kind, dailySource.id, backfillSource.id, securityIdByTicker, validation.valid);
      },
      { timeout: PERSIST_TX_TIMEOUT_MS, maxWait: 10_000 },
    );

    const warning =
      validation.invalid.length > 0
        ? `${validation.invalid.length} row(s) rejected: ${validation.invalid
            .slice(0, 5)
            .map((i) => `row ${i.rowNumber}: ${i.errors.join("; ")}`)
            .join(" | ")}${validation.invalid.length > 5 ? " | …" : ""}`
        : undefined;
    const run = await completeRun(runId, counts, warning);

    return {
      runId: run.runId,
      status: run.status,
      kind,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted: persisted.persisted,
      inserted: persisted.inserted,
      updated: persisted.updated,
      unchanged: persisted.unchanged,
      newSecurities,
      tickers,
      earliestTradingDate: earliestDate(validation.valid),
      latestTradingDate: latestDate(validation.valid),
      errors: validation.invalid,
      conflicts: persisted.conflicts,
      sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const counts = err instanceof ImportRejectedError ? err.counts : empty;
    const run = await failRun(runId, message, counts);
    return {
      runId: run.runId,
      status: "FAILED",
      kind,
      ...counts,
      persisted: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      newSecurities: [],
      tickers: [],
      earliestTradingDate: null,
      latestTradingDate: null,
      errors: [{ row: {}, errors: [message], rowNumber: 0 }],
      conflicts: [],
      sampleValid: [],
    };
  }
}

class ImportRejectedError extends Error {
  constructor(
    message: string,
    readonly counts: { recordsRead: number; recordsAccepted: number; recordsRejected: number },
  ) {
    super(message);
  }
}
