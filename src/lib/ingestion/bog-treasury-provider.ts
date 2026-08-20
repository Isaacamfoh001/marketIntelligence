// ---------------------------------------------------------------------------
// Bank of Ghana Treasury Bill Rates ingestion provider.
//
// Source discovery: https://www.bog.gov.gh/treasury-and-the-markets/treasury-bill-rates/
// is the same WordPress "wpDataTables" mechanism as the Day 3 FX pages
// (see bog-fx-provider.ts for full background). Its initial HTML already
// server-renders the ~10 most recent auction rows across every security
// type BoG issues — enough for routine refreshes without any AJAX call.
// Deeper history uses the same paginated AJAX mechanism as FX backfill,
// once per supported tenor (the endpoint's per-column search filters to
// exactly one security type per request).
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { fetchBogText, postBogForm } from "./http";
import {
  extractRowsFromHtml,
  extractRowsFromAjaxJson,
  validateTreasuryRows,
  SUPPORTED_SECURITY_TYPES,
  type RawTreasuryRow,
} from "./bog-treasury-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const TREASURY_URL = "https://www.bog.gov.gh/treasury-and-the-markets/treasury-bill-rates/";
const AJAX_URL = "https://www.bog.gov.gh/wp-admin/admin-ajax.php?action=get_wdtable";

const DATA_SOURCE_NAME = "Bank of Ghana — Treasury Bill Rates";

const INSTRUMENTS: Record<(typeof SUPPORTED_SECURITY_TYPES)[number], { code: string; name: string; tenorDays: number }> = {
  "91 DAY BILL": { code: "91_DAY_BILL", name: "91 DAY BILL", tenorDays: 91 },
  "182 DAY BILL": { code: "182_DAY_BILL", name: "182 DAY BILL", tenorDays: 182 },
  "364 DAY BILL": { code: "364_DAY_BILL", name: "364 DAY BILL", tenorDays: 364 },
};

// ---------------------------------------------------------------------------
// DataSource / TreasuryInstrument bootstrap
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
      url: TREASURY_URL,
      expectedFrequency: "WEEKLY",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
}

async function ensureInstrument(securityType: string) {
  const spec = INSTRUMENTS[securityType as keyof typeof INSTRUMENTS];
  if (!spec) throw new Error(`Unsupported security type: ${securityType}`);
  const db = getPrisma();
  return db.treasuryInstrument.upsert({
    where: { code: spec.code },
    update: {},
    create: { code: spec.code, name: spec.name, tenorDays: spec.tenorDays, instrumentType: "BILL" },
  });
}

async function ensureInstrumentsByType(): Promise<Map<string, { id: string }>> {
  const entries = await Promise.all(
    SUPPORTED_SECURITY_TYPES.map(async (type) => [type, await ensureInstrument(type)] as const),
  );
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Persist with idempotency (upsert on instrumentId + observationDate)
// ---------------------------------------------------------------------------

async function persistTreasuryRates(
  runId: string,
  sourceId: string,
  instrumentsByType: Map<string, { id: string }>,
  rows: { observationDate: Date; securityType: string; tenderNumber: string | null; discountRate: string; interestRate: string }[],
): Promise<number> {
  const db = getPrisma();
  let persisted = 0;

  for (const row of rows) {
    const instrument = instrumentsByType.get(row.securityType);
    if (!instrument) continue;

    await db.treasuryRate.upsert({
      where: {
        instrumentId_observationDate: { instrumentId: instrument.id, observationDate: row.observationDate },
      },
      update: {
        tenderNumber: row.tenderNumber,
        discountRate: row.discountRate,
        interestRate: row.interestRate,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        instrumentId: instrument.id,
        observationDate: row.observationDate,
        tenderNumber: row.tenderNumber,
        discountRate: row.discountRate,
        interestRate: row.interestRate,
        sourceId,
        ingestionRunId: runId,
      },
    });
    persisted++;
  }

  return persisted;
}

// ---------------------------------------------------------------------------
// Result shape shared by routine + backfill
// ---------------------------------------------------------------------------

export interface TreasuryIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  latestBySecurityType: Record<string, string | null>;
  errors: { row: RawTreasuryRow; errors: string[] }[];
}

function latestBySecurityType(rows: { observationDate: Date; securityType: string }[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const type of SUPPORTED_SECURITY_TYPES) result[type] = null;
  for (const row of rows) {
    const current = result[row.securityType];
    const dateStr = row.observationDate.toISOString().slice(0, 10);
    if (!current || dateStr > current) result[row.securityType] = dateStr;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Routine ingestion (main page — most recent ~10 auction rows)
// ---------------------------------------------------------------------------

export async function ingestBogTreasury(): Promise<TreasuryIngestResult> {
  const dataSource = await ensureDataSource();
  const instrumentsByType = await ensureInstrumentsByType();

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "cli",
    artifactName: TREASURY_URL,
  });

  try {
    const html = await fetchBogText(TREASURY_URL);
    const rawRows = extractRowsFromHtml(html).filter((r) =>
      SUPPORTED_SECURITY_TYPES.includes(r.securityType as (typeof SUPPORTED_SECURITY_TYPES)[number]),
    );
    const validation = validateTreasuryRows(rawRows);
    const persisted = await persistTreasuryRates(runId, dataSource.id, instrumentsByType, validation.valid);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      latestBySecurityType: latestBySecurityType(validation.valid),
      errors: validation.invalid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      persisted: 0,
      latestBySecurityType: latestBySecurityType([]),
      errors: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Historical backfill (best-effort, one AJAX call per tenor)
// ---------------------------------------------------------------------------

function extractNonce(html: string): string {
  const match = /wdtNonceFrontendServerSide_\d+"\s+name="wdtNonceFrontendServerSide_\d+"\s+value="([a-f0-9]+)"/.exec(html);
  if (!match) {
    throw new Error("Could not find the wpDataTables nonce on the Treasury Bill Rates page — page structure may have changed");
  }
  return match[1];
}

function extractTableId(html: string): string {
  const match = /"tableWpId":(\d+)/.exec(html);
  if (!match) {
    throw new Error("Could not find the wpDataTables table id on the Treasury Bill Rates page — page structure may have changed");
  }
  return match[1];
}

/**
 * Best-effort backfill from `fromDate` (inclusive) through the latest
 * available auction, one AJAX request per supported tenor (the endpoint
 * filters to one security type per request). `length` bounds each
 * request's lookback — 150 comfortably covers weekly auctions back to
 * 2025-01-01 with margin.
 */
export async function ingestBogTreasuryBackfill(
  fromDate: string = "2025-01-01",
  length: number = 150,
): Promise<TreasuryIngestResult> {
  const dataSource = await ensureDataSource();
  const instrumentsByType = await ensureInstrumentsByType();

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "backfill",
    artifactName: TREASURY_URL,
  });

  try {
    const pageHtml = await fetchBogText(TREASURY_URL);
    const nonce = extractNonce(pageHtml);
    const tableId = extractTableId(pageHtml);
    const cutoff = new Date(`${fromDate}T00:00:00.000Z`);

    let allRawRows: RawTreasuryRow[] = [];
    for (const securityType of SUPPORTED_SECURITY_TYPES) {
      const json = await postBogForm(`${AJAX_URL}&table_id=${tableId}`, TREASURY_URL, {
        draw: "1",
        start: "0",
        length: String(length),
        "order[0][column]": "0",
        "order[0][dir]": "desc",
        "columns[2][data]": "2",
        "columns[2][searchable]": "true",
        "columns[2][search][value]": securityType,
        "columns[2][search][regex]": "false",
        wdtNonce: nonce,
      });
      const parsed: unknown = JSON.parse(json);
      allRawRows = allRawRows.concat(extractRowsFromAjaxJson(parsed).filter((r) => r.securityType === securityType));
    }

    const validation = validateTreasuryRows(allRawRows);
    const inRange = validation.valid.filter((r) => r.observationDate >= cutoff);
    const persisted = await persistTreasuryRates(runId, dataSource.id, instrumentsByType, inRange);

    const run = await completeRun(runId, {
      recordsRead: allRawRows.length,
      recordsAccepted: inRange.length,
      recordsRejected: validation.invalid.length + (validation.valid.length - inRange.length),
    });

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      latestBySecurityType: latestBySecurityType(inRange),
      errors: validation.invalid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      persisted: 0,
      latestBySecurityType: latestBySecurityType([]),
      errors: [],
    };
  }
}
