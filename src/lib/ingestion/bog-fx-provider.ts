// ---------------------------------------------------------------------------
// Bank of Ghana FX ingestion provider.
//
// Source discovery (see final report for full detail):
//
//  - Live/daily: https://www.bog.gov.gh/treasury-and-the-markets/daily-interbank-fx-rates/
//    Official page. Server-renders a table with the latest published
//    day's rates for every currency pair directly in its initial HTML —
//    no JavaScript execution or AJAX call needed to read it. This is
//    "official HTML/table parsing" (tier 3 of the source preference
//    order): there is no documented BoG API or downloadable file.
//
//  - Backfill: https://www.bog.gov.gh/treasury-and-the-markets/historical-interbank-fx-rates/
//    This page's table is paginated client-side via a WordPress
//    "wpDataTables" plugin AJAX endpoint (admin-ajax.php). That endpoint
//    is not documented by BoG as a public API, but it is the exact,
//    unauthenticated, nonce-protected mechanism the official page's own
//    JavaScript uses to serve every visitor — not a reverse-engineered
//    secret, not a third-party mirror, and not an access-control bypass.
//    It is used here for a single bounded, read-only request (equivalent
//    to a visitor clicking "Show All" on the page) rather than repeated
//    scraping. Treated explicitly as brittler than the daily HTML path:
//    if the page structure changes, backfill degrades to a clear error
//    without affecting daily ingestion.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { fetchBogText, postBogForm } from "./http";
import {
  extractRowsFromHtml,
  extractRowsFromAjaxJson,
  validateBogFxRows,
  type RawBogFxRow,
} from "./bog-fx-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const DAILY_FX_URL = "https://www.bog.gov.gh/treasury-and-the-markets/daily-interbank-fx-rates/";
const HISTORICAL_FX_URL = "https://www.bog.gov.gh/treasury-and-the-markets/historical-interbank-fx-rates/";
const AJAX_URL = "https://www.bog.gov.gh/wp-admin/admin-ajax.php?action=get_wdtable";

const DATA_SOURCE_NAME = "Bank of Ghana — Daily Interbank FX Rates";

// Extensible: adding GBPGHS/EURGHS later is a matter of adding entries
// here and passing the code to ingestBogFxDaily/ingestBogFxBackfill.
const SUPPORTED_PAIRS: Record<string, { base: string; quote: string }> = {
  USDGHS: { base: "USD", quote: "GHS" },
};

// ---------------------------------------------------------------------------
// DataSource / CurrencyPair bootstrap
// ---------------------------------------------------------------------------

async function ensureDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Bank of Ghana",
      sourceType: "AUTOMATED",
      url: DAILY_FX_URL,
      expectedFrequency: "DAILY",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
}

async function ensureCurrencyPair(pairCode: string) {
  const spec = SUPPORTED_PAIRS[pairCode];
  if (!spec) {
    throw new Error(`Unsupported currency pair: ${pairCode}`);
  }
  const db = getPrisma();
  return db.currencyPair.upsert({
    where: { code: pairCode },
    update: {},
    create: { code: pairCode, baseCurrency: spec.base, quoteCurrency: spec.quote },
  });
}

// ---------------------------------------------------------------------------
// Persist with idempotency (upsert on currencyPairId + observationDate)
// ---------------------------------------------------------------------------

async function persistExchangeRates(
  runId: string,
  currencyPairId: string,
  sourceId: string,
  rows: { observationDate: Date; buyingRate: string | null; sellingRate: string | null; midRate: string }[],
): Promise<number> {
  const db = getPrisma();
  let persisted = 0;

  for (const row of rows) {
    await db.exchangeRate.upsert({
      where: {
        currencyPairId_observationDate: { currencyPairId, observationDate: row.observationDate },
      },
      update: {
        buyingRate: row.buyingRate,
        sellingRate: row.sellingRate,
        midRate: row.midRate,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        currencyPairId,
        observationDate: row.observationDate,
        buyingRate: row.buyingRate,
        sellingRate: row.sellingRate,
        midRate: row.midRate,
        sourceId,
        ingestionRunId: runId,
      },
    });
    persisted++;
  }

  return persisted;
}

// ---------------------------------------------------------------------------
// Result shape shared by daily + backfill
// ---------------------------------------------------------------------------

export interface BogFxIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  pair: string;
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  latestObservationDate: string | null;
  errors: { row: RawBogFxRow; errors: string[] }[];
}

function latestDate(rows: { observationDate: Date }[]): string | null {
  const max = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.observationDate > acc ? r.observationDate : acc),
    null,
  );
  return max ? max.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Live daily ingestion
// ---------------------------------------------------------------------------

/**
 * Fetch → parse → validate → persist the current published day's rate
 * for one currency pair from the official Daily Interbank FX Rates page.
 */
export async function ingestBogFxDaily(pairCode: string = "USDGHS"): Promise<BogFxIngestResult> {
  const dataSource = await ensureDataSource();
  const pair = await ensureCurrencyPair(pairCode);

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "cli",
    artifactName: DAILY_FX_URL,
  });

  try {
    const html = await fetchBogText(DAILY_FX_URL);
    const rawRows = extractRowsFromHtml(html).filter((r) => r.pairCode === pairCode);
    const validation = validateBogFxRows(rawRows);
    const persisted = await persistExchangeRates(runId, pair.id, dataSource.id, validation.valid);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      pair: pairCode,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      latestObservationDate: latestDate(validation.valid),
      errors: validation.invalid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      pair: pairCode,
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      persisted: 0,
      latestObservationDate: null,
      errors: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Historical backfill (best-effort)
// ---------------------------------------------------------------------------

function extractNonce(html: string): string {
  const match = /wdtNonceFrontendServerSide_\d+"\s+name="wdtNonceFrontendServerSide_\d+"\s+value="([a-f0-9]+)"/.exec(html);
  if (!match) {
    throw new Error("Could not find the wpDataTables nonce on the historical FX page — page structure may have changed");
  }
  return match[1];
}

function extractTableId(html: string): string {
  const match = /"tableWpId":(\d+)/.exec(html);
  if (!match) {
    throw new Error("Could not find the wpDataTables table id on the historical FX page — page structure may have changed");
  }
  return match[1];
}

/**
 * Best-effort backfill of historical daily rates for one currency pair,
 * from `fromDate` (inclusive) through the latest available date. Uses
 * the historical page's own paginated data-loading mechanism (see file
 * header). `length` bounds how many of the most recent rows are
 * requested in the single lookback query — 600 comfortably covers
 * 2025-01-01 to present for a daily series with margin to spare.
 */
export async function ingestBogFxBackfill(
  pairCode: string = "USDGHS",
  fromDate: string = "2025-01-01",
  length: number = 600,
): Promise<BogFxIngestResult> {
  const dataSource = await ensureDataSource();
  const pair = await ensureCurrencyPair(pairCode);

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "backfill",
    artifactName: HISTORICAL_FX_URL,
  });

  try {
    const historicalPageHtml = await fetchBogText(HISTORICAL_FX_URL);
    const nonce = extractNonce(historicalPageHtml);
    const tableId = extractTableId(historicalPageHtml);

    const json = await postBogForm(`${AJAX_URL}&table_id=${tableId}`, HISTORICAL_FX_URL, {
      draw: "1",
      start: "0",
      length: String(length),
      "order[0][column]": "0",
      "order[0][dir]": "desc",
      "columns[2][data]": "2",
      "columns[2][searchable]": "true",
      "columns[2][search][value]": pairCode,
      "columns[2][search][regex]": "false",
      wdtNonce: nonce,
    });

    const parsed: unknown = JSON.parse(json);
    const rawRows = extractRowsFromAjaxJson(parsed).filter((r) => r.pairCode === pairCode);
    const validation = validateBogFxRows(rawRows);

    const cutoff = new Date(`${fromDate}T00:00:00.000Z`);
    const inRange = validation.valid.filter((r) => r.observationDate >= cutoff);

    const persisted = await persistExchangeRates(runId, pair.id, dataSource.id, inRange);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: inRange.length,
      recordsRejected: validation.invalid.length + (validation.valid.length - inRange.length),
    });

    return {
      runId: run.runId,
      status: run.status,
      pair: pairCode,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      latestObservationDate: latestDate(inRange),
      errors: validation.invalid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      pair: pairCode,
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      persisted: 0,
      latestObservationDate: null,
      errors: [],
    };
  }
}
