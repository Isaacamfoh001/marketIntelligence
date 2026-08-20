// ---------------------------------------------------------------------------
// GSE Daily Shares & ETFs — security price import provider.
//
// Source discovery: gse.com.gh's robots.txt explicitly names and disallows
// AI-agent user agents (including this one — "User-agent: ClaudeBot /
// Disallow: /"), enforced with a site-wide 403 at the edge (verified: even
// a static PDF and /sitemap.xml were blocked, so this is not specific to
// the market-data pages). That is a deliberate, explicit opt-out from the
// site owner, not a login wall or paywall, and it is honoured in full: no
// code in this repository fetches gse.com.gh automatically, under any
// user agent. See CLAUDE.md §7.C, which already anticipated this exact
// situation ("production-grade automated market feeds should not assume
// unrestricted scraping... a future commercial feed/API agreement may be
// required") and PROJECT.md §14.3.
//
// This provider is therefore Mode B/C only (CLAUDE.md §20/§29): a human
// obtains an official GSE export (through their own ordinary browser
// session, which robots.txt does not restrict) and imports it as CSV or
// Excel. Two DataSources exist for the same row shape:
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
import { parseImportFile } from "./file-parse";
import { extractGseSecurityRows, validateGseSecurityRows, type NormalisedGseSecurityRow, type RawGseSecurityRow } from "./gse-security-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";
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
    update: {},
    create: {
      name,
      provider: "Ghana Stock Exchange",
      sourceType: "MANUAL",
      url: "https://gse.com.gh/market-statistics/",
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
): Promise<string> {
  const cached = cache.get(ticker);
  if (cached) return cached;

  const db = getPrisma();
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
  return security.id;
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
  runId: string,
  sourceId: string,
  importKind: SecurityImportKind,
  dailySourceId: string,
  backfillSourceId: string,
  securityIdByTicker: Map<string, string>,
  rows: NormalisedGseSecurityRow[],
): Promise<{ persisted: number; inserted: number; updated: number; conflicts: SecurityPriceConflict[] }> {
  const db = getPrisma();
  let inserted = 0;
  let updated = 0;
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

  return { persisted: inserted + updated, inserted, updated, conflicts };
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
  opts: { commit: boolean; triggeredBy?: string } = { commit: false },
): Promise<GseSecurityImportResult> {
  if (!opts.commit) {
    try {
      const parsedFile = await parseImportFile(filename, buffer);
      const rawRows = extractGseSecurityRows(parsedFile);
      const validation = validateGseSecurityRows(rawRows);
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

  const { runId } = await startRun({ dataSourceId: activeSource.id, triggeredBy: opts.triggeredBy ?? "cli", artifactName: filename });

  try {
    const parsedFile = await parseImportFile(filename, buffer);
    const rawRows = extractGseSecurityRows(parsedFile);
    const validation = validateGseSecurityRows(rawRows);
    const tickers = Array.from(new Set(validation.valid.map((r) => r.ticker))).sort();

    const securityIdByTicker = new Map<string, string>();
    for (const row of validation.valid) {
      const id = await ensureSecurity(row.ticker, row.companyName, row.securityType, securityIdByTicker);
      securityIdByTicker.set(row.ticker, id);
    }

    const { persisted, inserted, updated, conflicts } = await persistSecurityPrices(
      runId,
      activeSource.id,
      kind,
      dailySource.id,
      backfillSource.id,
      securityIdByTicker,
      validation.valid,
    );

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      kind,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      inserted,
      updated,
      tickers,
      earliestTradingDate: earliestDate(validation.valid),
      latestTradingDate: latestDate(validation.valid),
      errors: validation.invalid,
      conflicts,
      sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      kind,
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      persisted: 0,
      inserted: 0,
      updated: 0,
      tickers: [],
      earliestTradingDate: null,
      latestTradingDate: null,
      errors: [],
      conflicts: [],
      sampleValid: [],
    };
  }
}
