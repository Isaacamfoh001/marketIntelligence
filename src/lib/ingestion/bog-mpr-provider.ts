// ---------------------------------------------------------------------------
// Bank of Ghana Monetary Policy Rate ingestion provider.
//
// Source hierarchy (see final report for full detail):
//   1. AUTHORITATIVE — Policy Rate Trends page's "Historical Policy Rate
//      Decisions" table (this file's source). Explicitly labeled as MPC
//      decisions, carries a clean per-decision Effective Date, and is
//      the only source used to write data.
//   2. Cross-check only, never ingested — the Highcharts series embedded
//      on the same page (same data, redundant) and BoG's own news/press
//      releases. Never news articles or third-party sites.
//
// Reuses the existing MacroSeries/MacroObservation domain (per CLAUDE.md
// §9: don't build a separate model for one policy series) with
// frequency AD_HOC — this is an event-driven decision series, not a
// monthly statistic, so one MacroObservation is stored per real decision
// effective date. No monthly rows are manufactured.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { fetchBogText } from "./http";
import { extractRowsFromHtml, validateMprRows, type RawMprRow, type NormalisedMprRow } from "./bog-mpr-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const MPR_URL = "https://www.bog.gov.gh/monetary-policy/policy-rate-trends/";
const DATA_SOURCE_NAME = "Bank of Ghana — Monetary Policy Rate";
const SERIES_CODE = "BOG_MPR";

async function ensureDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Bank of Ghana",
      sourceType: "AUTOMATED",
      url: MPR_URL,
      expectedFrequency: "AD_HOC",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
}

async function ensureSeries(sourceId: string) {
  const db = getPrisma();
  return db.macroSeries.upsert({
    where: { code: SERIES_CODE },
    update: {},
    create: {
      code: SERIES_CODE,
      name: "Bank of Ghana Monetary Policy Rate",
      category: "Monetary Policy",
      unit: "%",
      frequency: "AD_HOC",
      sourceId,
    },
  });
}

async function persistObservations(
  runId: string,
  seriesId: string,
  rows: { effectiveDate: Date; rate: string }[],
): Promise<number> {
  const db = getPrisma();
  let persisted = 0;

  for (const row of rows) {
    await db.macroObservation.upsert({
      where: { seriesId_observationDate: { seriesId, observationDate: row.effectiveDate } },
      update: { value: row.rate, retrievedAt: new Date(), ingestionRunId: runId },
      create: { seriesId, observationDate: row.effectiveDate, value: row.rate, ingestionRunId: runId },
    });
    persisted++;
  }

  return persisted;
}

export interface MprIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  latestRate: string | null;
  latestEffectiveDate: string | null;
  errors: { row: RawMprRow; errors: string[] }[];
}

/**
 * Fetch → parse → validate → persist the full historical Policy Rate
 * Decisions table. There is no separate "daily" vs "backfill" split
 * (unlike FX/Treasury): the authoritative page already serves its whole
 * history in one request, so every run is naturally a full, idempotent
 * resync.
 */
export async function ingestBogMpr(): Promise<MprIngestResult> {
  const dataSource = await ensureDataSource();
  const series = await ensureSeries(dataSource.id);

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "cli",
    artifactName: MPR_URL,
  });

  try {
    const html = await fetchBogText(MPR_URL);
    const rawRows = extractRowsFromHtml(html);
    const validation = validateMprRows(rawRows);
    const persisted = await persistObservations(runId, series.id, validation.valid);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    const latest = validation.valid.reduce<NormalisedMprRow | null>(
      (max, r) => (!max || r.effectiveDate > max.effectiveDate ? r : max),
      null,
    );

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      latestRate: latest ? latest.rate : null,
      latestEffectiveDate: latest ? latest.effectiveDate.toISOString().slice(0, 10) : null,
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
      latestRate: null,
      latestEffectiveDate: null,
      errors: [],
    };
  }
}
