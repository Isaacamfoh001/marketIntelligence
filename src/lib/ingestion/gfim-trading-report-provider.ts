// ---------------------------------------------------------------------------
// GFIM Daily Trading Report ingestion provider (M7.2) — real secondary-
// market observations (price/yield/volume) for government and corporate
// bonds already in the Securities Master.
//
// Mode A (primary): gfim.com.gh exposes the report file through its own
// standard, public, self-documenting WordPress core REST API
// (`/wp-json/wp/v2/media`) — not a reverse-engineered or authenticated
// endpoint (contrast with the plugin-specific FileBird routes, which
// returned 401 Forbidden when tried — those were correctly left alone).
// `discoverLatestDailyTradingReport` queries that API, finds the most
// recent "TRADING REPORT FOR GFIM-DDMMYYYY" attachment, and returns its
// direct, stable `source_url` under gfim.com.gh/wp-content/uploads/.
//
// Mode B (fallback): `importGfimTradingReportFromBuffer` is the same
// parse/match/persist core, usable from the Data Centre Import Wizard for
// an analyst-supplied file when automated discovery is unavailable.
//
// Matching is ISIN-only (M7.2 §5) — never issuer+coupon fuzzy matching.
// An ISIN with no matching FixedIncomeSecurity is reported, never
// silently dropped or auto-created as a new security (a trading report
// alone doesn't carry the contractual terms a Securities Master row
// needs).
//
// observationKind is always SECONDARY_MARKET here. If an AUCTION_PRIMARY
// observation already exists for the same (security, date) — the only
// other observationKind this platform writes — that row is left alone
// and reported as a conflict rather than silently overwritten (M7.2 §4).
// ---------------------------------------------------------------------------

import ExcelJS from "exceljs";
import { getPrisma } from "../prisma";
import { fetchGfimJson, fetchGfimBuffer } from "./gfim-http";
import { extractAllSheets, validateTradingReportRows, extractReportDateFromWorkbook, type NormalisedTradingObservationRow, type TradingReportSheetKind } from "./gfim-trading-report-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const WP_MEDIA_API = "https://gfim.com.gh/wp-json/wp/v2/media";
const DATA_SOURCE_NAME = "Ghana Fixed Income Market — Daily Trading Reports";
const SOURCE_PAGE_URL = "https://gfim.com.gh/daily-trading-reports/";

export const PREVIEW_SAMPLE_SIZE = 50;

export async function ensureGfimTradingReportDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Fixed Income Market",
      sourceType: "AUTOMATED",
      url: SOURCE_PAGE_URL,
      expectedFrequency: "DAILY",
      ingestionMethod: "API",
      active: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Mode A — discovery via GFIM's public WordPress media REST API
// ---------------------------------------------------------------------------

export interface DiscoveredReport {
  url: string;
  filename: string;
  reportDate: Date;
  mediaId: number;
}

const FILENAME_DATE_RE = /GFIM-(\d{2})(\d{2})(\d{4})/i;

/** Parses the DDMMYYYY embedded in GFIM's own filename/title convention (e.g. "TRADING REPORT FOR GFIM-02102026" -> 2026-10-02). */
export function parseReportDateFromTitle(title: string): Date | null {
  const match = FILENAME_DATE_RE.exec(title);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isReal ? date : null;
}

interface WpMediaItem {
  id: number;
  title: { rendered: string };
  source_url: string;
  mime_type: string;
}

/** Finds the most recent "TRADING REPORT FOR GFIM-..." .xlsx attachment via GFIM's public media API. Returns null if none found (never throws for "nothing new"). */
export async function discoverLatestDailyTradingReport(): Promise<DiscoveredReport | null> {
  const url = `${WP_MEDIA_API}?search=${encodeURIComponent("trading report for gfim")}&orderby=date&order=desc&per_page=10`;
  const json = await fetchGfimJson(url);
  if (!Array.isArray(json)) return null;

  let best: DiscoveredReport | null = null;
  for (const item of json as WpMediaItem[]) {
    const title = item.title?.rendered ?? "";
    if (!/^TRADING REPORT FOR GFIM-/i.test(title.trim())) continue;
    if (!item.mime_type?.includes("spreadsheet")) continue;
    const reportDate = parseReportDateFromTitle(title);
    if (!reportDate) continue;
    if (!best || reportDate.getTime() > best.reportDate.getTime()) {
      best = { url: item.source_url, filename: title.trim(), reportDate, mediaId: item.id };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Security matching + persistence
// ---------------------------------------------------------------------------

export interface UnmatchedIsin {
  isin: string;
  sheet: TradingReportSheetKind;
  securityDescription: string | null;
}

export interface AuctionConflict {
  isin: string;
  observationDate: string;
}

async function persistObservations(
  runId: string,
  sourceId: string,
  reportDate: Date,
  rows: NormalisedTradingObservationRow[],
): Promise<{ inserted: number; updated: number; unmatched: UnmatchedIsin[]; auctionConflicts: AuctionConflict[] }> {
  const db = getPrisma();
  let inserted = 0;
  let updated = 0;
  const unmatched: UnmatchedIsin[] = [];
  const auctionConflicts: AuctionConflict[] = [];
  const securityIdCache = new Map<string, string | null>();

  for (const row of rows) {
    let securityId = securityIdCache.get(row.isin);
    if (securityId === undefined) {
      const security = await db.fixedIncomeSecurity.findUnique({ where: { isin: row.isin } });
      securityId = security?.id ?? null;
      securityIdCache.set(row.isin, securityId);
    }
    if (!securityId) {
      unmatched.push({ isin: row.isin, sheet: row.sheet, securityDescription: row.securityDescription });
      continue;
    }

    const existing = await db.fixedIncomeObservation.findUnique({
      where: { securityId_observationDate: { securityId, observationDate: reportDate } },
    });
    if (existing && existing.observationKind === "AUCTION_PRIMARY") {
      // Never let a secondary-market trade silently overwrite a primary
      // auction clearing rate recorded for the same security/date.
      auctionConflicts.push({ isin: row.isin, observationDate: reportDate.toISOString().slice(0, 10) });
      continue;
    }

    await db.fixedIncomeObservation.upsert({
      where: { securityId_observationDate: { securityId, observationDate: reportDate } },
      update: {
        cleanPrice: row.cleanPrice,
        sourceYieldPct: row.sourceYieldPct,
        volumeTradedGhs: row.volumeTradedGhs,
        observationKind: "SECONDARY_MARKET",
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        securityId,
        observationDate: reportDate,
        cleanPrice: row.cleanPrice,
        sourceYieldPct: row.sourceYieldPct,
        volumeTradedGhs: row.volumeTradedGhs,
        observationKind: "SECONDARY_MARKET",
        sourceId,
        ingestionRunId: runId,
      },
    });
    if (existing) updated++;
    else inserted++;
  }

  return { inserted, updated, unmatched, auctionConflicts };
}

// ---------------------------------------------------------------------------
// Import entrypoint — two-phase (preview / commit), mirrors every other
// fixed-income import provider.
// ---------------------------------------------------------------------------

export interface GfimTradingReportImportResult {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "PREVIEW";
  reportDate: string;
  reportFilename: string;
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  noTradeCount: number;
  inserted: number;
  updated: number;
  unmatched: UnmatchedIsin[];
  auctionConflicts: AuctionConflict[];
  errors: { row: unknown; errors: string[] }[];
  sampleValid: NormalisedTradingObservationRow[];
}

/**
 * `reportDate` is optional: Mode A (CLI) already knows it from the
 * discovered file's title, but Mode B (an analyst's manual upload through
 * the Data Centre wizard) may not have a filename following GFIM's exact
 * convention — in that case the report's own in-file "Date: Friday, 02
 * October, 2026" text (present on every sheet) is used instead. If
 * neither source yields a date, the import fails clearly rather than
 * guessing or defaulting to "today" (CLAUDE.md: never fabricate an
 * observation date).
 */
export async function importGfimTradingReportFromBuffer(
  filename: string,
  buffer: Buffer,
  reportDate: Date | null,
  opts: { commit: boolean; triggeredBy?: string; acquisitionMethod?: string } = { commit: false },
): Promise<GfimTradingReportImportResult> {
  const parseAndValidate = async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const resolvedDate = reportDate ?? extractReportDateFromWorkbook(workbook);
    if (!resolvedDate) {
      throw new Error("Could not determine the report date from the filename or the file's own content — expected GFIM's 'Date: <Weekday>, DD Month, YYYY' text on a sheet.");
    }
    const rawRows = extractAllSheets(workbook);
    const validation = validateTradingReportRows(rawRows);
    return { rawRows, validation, resolvedDate };
  };

  if (!opts.commit) {
    try {
      const { rawRows, validation, resolvedDate } = await parseAndValidate();
      return {
        runId: null,
        status: "PREVIEW",
        reportDate: resolvedDate.toISOString().slice(0, 10),
        reportFilename: filename,
        recordsRead: rawRows.length,
        recordsAccepted: validation.traded.length,
        recordsRejected: validation.invalid.length,
        noTradeCount: validation.noTrade.length,
        inserted: 0,
        updated: 0,
        unmatched: [],
        auctionConflicts: [],
        errors: validation.invalid,
        sampleValid: validation.traded.slice(0, PREVIEW_SAMPLE_SIZE),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        runId: null,
        status: "PREVIEW",
        reportDate: reportDate?.toISOString().slice(0, 10) ?? "unknown",
        reportFilename: filename,
        recordsRead: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        noTradeCount: 0,
        inserted: 0,
        updated: 0,
        unmatched: [],
        auctionConflicts: [],
        errors: [{ row: {}, errors: [message] }],
        sampleValid: [],
      };
    }
  }

  const dataSource = await ensureGfimTradingReportDataSource();
  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: opts.triggeredBy ?? "cli",
    artifactName: filename,
    acquisitionMethod: opts.acquisitionMethod ?? "OFFICIAL_WEB_FETCH",
  });

  try {
    const { rawRows, validation, resolvedDate } = await parseAndValidate();
    const { inserted, updated, unmatched, auctionConflicts } = await persistObservations(runId, dataSource.id, resolvedDate, validation.traded);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.traded.length - unmatched.length - auctionConflicts.length,
      recordsRejected: validation.invalid.length + unmatched.length + auctionConflicts.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      reportDate: resolvedDate.toISOString().slice(0, 10),
      reportFilename: filename,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      noTradeCount: validation.noTrade.length,
      inserted,
      updated,
      unmatched,
      auctionConflicts,
      errors: validation.invalid,
      sampleValid: validation.traded.slice(0, PREVIEW_SAMPLE_SIZE),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      reportDate: reportDate?.toISOString().slice(0, 10) ?? "unknown",
      reportFilename: filename,
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      noTradeCount: 0,
      inserted: 0,
      updated: 0,
      unmatched: [],
      auctionConflicts: [],
      errors: [],
      sampleValid: [],
    };
  }
}

/** Mode A entrypoint: discovers the latest report via GFIM's public media API, downloads it, and commits directly — no human preview step, mirroring the BoG automated CLIs. */
export async function ingestLatestGfimTradingReport(): Promise<GfimTradingReportImportResult | { status: "NO_REPORT_FOUND" }> {
  const discovered = await discoverLatestDailyTradingReport();
  if (!discovered) return { status: "NO_REPORT_FOUND" };

  const buffer = await fetchGfimBuffer(discovered.url);
  return importGfimTradingReportFromBuffer(discovered.filename, buffer, discovered.reportDate, {
    commit: true,
    triggeredBy: "cli",
    acquisitionMethod: "OFFICIAL_WEB_FETCH",
  });
}
