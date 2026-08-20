// ---------------------------------------------------------------------------
// Bank of Ghana Monetary Policy Rate ingestion provider.
//
// Source hierarchy (see final report for full detail):
//   1. AUTHORITATIVE for rate values — Policy Rate Trends page's
//      "Historical Policy Rate Decisions" table. Explicit per-decision
//      Effective Date + resulting rate. HIKE/CUT/HOLD and the bps change
//      are computed here from consecutive rate comparisons — BoG doesn't
//      publish that classification directly.
//   2. AUTHORITATIVE for meeting occurrence only — the MPC Press Release
//      archive index. Confirms a meeting happened on a given date even
//      before table (1) catches up (observed lag: table 1 stops at
//      18 Mar 2026; the archive already lists 20 May and 22 Jul 2026).
//      The archive does not state the resulting rate or decision type —
//      that's only in each release's linked PDF, which this milestone
//      deliberately does not parse (HTML over PDF, per source policy).
//      Meetings confirmed here but absent from table (1) are recorded as
//      HOLD at the carried-forward rate — a hold is defined as "the rate
//      didn't change," not an invented number.
//   3. Never used to write data — the Highcharts series embedded on the
//      Policy Rate Trends page (same underlying data as table 1,
//      cross-checked only) and news/press coverage of MPC outcomes.
//
// Two DataSources exist so provenance stays honest about which fact came
// from which mechanism: a real rate change is attributed to the rate
// table; a gap-filled HOLD is attributed to the press-release archive
// that confirmed the meeting occurred.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { fetchBogText } from "./http";
import {
  extractRowsFromHtml,
  validateMprRows,
  computeDecisionsFromRateHistory,
  extractArchiveEntries,
  validateArchiveEntries,
  deriveHoldDecisionsFromMeetings,
  type RawMprRow,
  type RawArchiveEntry,
  type DerivedDecision,
} from "./bog-mpr-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const MPR_URL = "https://www.bog.gov.gh/monetary-policy/policy-rate-trends/";
const ARCHIVE_URL = "https://www.bog.gov.gh/mpc_press_release/";

const RATE_SOURCE_NAME = "Bank of Ghana — Monetary Policy Rate";
const ARCHIVE_SOURCE_NAME = "Bank of Ghana — MPC Press Releases";

async function ensureRateSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: RATE_SOURCE_NAME },
    update: {},
    create: {
      name: RATE_SOURCE_NAME,
      provider: "Bank of Ghana",
      sourceType: "AUTOMATED",
      url: MPR_URL,
      expectedFrequency: "AD_HOC",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
}

async function ensureArchiveSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: ARCHIVE_SOURCE_NAME },
    update: {},
    create: {
      name: ARCHIVE_SOURCE_NAME,
      provider: "Bank of Ghana",
      sourceType: "AUTOMATED",
      url: ARCHIVE_URL,
      expectedFrequency: "AD_HOC",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
}

async function persistDecisions(runId: string, sourceId: string, decisions: DerivedDecision[]): Promise<number> {
  const db = getPrisma();
  let persisted = 0;

  for (const d of decisions) {
    await db.policyDecision.upsert({
      where: { decisionDate: d.decisionDate },
      update: {
        resultingRate: d.resultingRate,
        decisionType: d.decisionType,
        changeBps: d.changeBps,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        decisionDate: d.decisionDate,
        resultingRate: d.resultingRate,
        decisionType: d.decisionType,
        changeBps: d.changeBps,
        sourceId,
        ingestionRunId: runId,
      },
    });
    persisted++;
  }

  return persisted;
}

interface SubRunResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
}

export interface MprIngestResult {
  rateTableRun: SubRunResult;
  archiveRun: SubRunResult;
  currentRate: string | null;
  latestDecisionDate: string | null;
  latestDecisionType: string | null;
  lastChangeDate: string | null;
  lastChangeType: string | null;
  lastChangeBps: number | null;
  errors: {
    rateTable: { row: RawMprRow; errors: string[] }[];
    archive: { row: RawArchiveEntry; errors: string[] }[];
  };
}

/**
 * Ingests the full Historical Policy Rate Decisions table (computing
 * HIKE/CUT/HOLD for every row), then confirms whether any more recent
 * MPC meetings exist in the press-release archive without a rate-table
 * row yet, recording those as HOLD at the carried-forward rate. Both
 * steps are idempotent full resyncs — there's no separate backfill mode.
 */
export async function ingestBogMpr(): Promise<MprIngestResult> {
  const db = getPrisma();
  const rateSource = await ensureRateSource();
  const archiveSource = await ensureArchiveSource();

  // --- Step 1: authoritative rate-decision table --------------------------
  const { runId: rateTableRunId } = await startRun({
    dataSourceId: rateSource.id,
    triggeredBy: "cli",
    artifactName: MPR_URL,
  });

  let tableErrors: { row: RawMprRow; errors: string[] }[] = [];
  let rateTableRun: SubRunResult;
  try {
    const html = await fetchBogText(MPR_URL);
    const rawRows = extractRowsFromHtml(html);
    const validation = validateMprRows(rawRows);
    const decisions = computeDecisionsFromRateHistory(validation.valid);
    const persisted = await persistDecisions(rateTableRunId, rateSource.id, decisions);

    const run = await completeRun(rateTableRunId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });
    tableErrors = validation.invalid;
    rateTableRun = { runId: run.runId, status: run.status, recordsRead: run.recordsRead, recordsAccepted: run.recordsAccepted, recordsRejected: run.recordsRejected, persisted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(rateTableRunId, message);
    rateTableRun = { runId: run.runId, status: "FAILED", recordsRead: 0, recordsAccepted: 0, recordsRejected: 0, persisted: 0 };
  }

  // --- Step 2: press-release archive (meeting-date confirmation) ---------
  const { runId: archiveRunId } = await startRun({
    dataSourceId: archiveSource.id,
    triggeredBy: "cli",
    artifactName: ARCHIVE_URL,
  });

  let archiveErrors: { row: RawArchiveEntry; errors: string[] }[] = [];
  let archiveRun: SubRunResult;
  try {
    const html = await fetchBogText(ARCHIVE_URL);
    const rawEntries = extractArchiveEntries(html);
    const validation = validateArchiveEntries(rawEntries);

    // Anchor against the DB's current state, not just this run's table
    // fetch — self-healing if step 1 failed but prior decisions exist.
    const existing = await db.policyDecision.findMany({
      select: { decisionDate: true, resultingRate: true, decisionType: true, changeBps: true },
    });
    const knownDecisions: DerivedDecision[] = existing.map((d) => ({
      decisionDate: d.decisionDate,
      resultingRate: d.resultingRate.toString(),
      decisionType: d.decisionType,
      changeBps: d.changeBps,
    }));

    const gapHolds = deriveHoldDecisionsFromMeetings(validation.valid, knownDecisions);
    const persisted = await persistDecisions(archiveRunId, archiveSource.id, gapHolds);

    const run = await completeRun(archiveRunId, {
      recordsRead: rawEntries.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });
    archiveErrors = validation.invalid;
    archiveRun = { runId: run.runId, status: run.status, recordsRead: run.recordsRead, recordsAccepted: run.recordsAccepted, recordsRejected: run.recordsRejected, persisted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(archiveRunId, message);
    archiveRun = { runId: run.runId, status: "FAILED", recordsRead: 0, recordsAccepted: 0, recordsRejected: 0, persisted: 0 };
  }

  // --- Final summary, reflecting current DB state -------------------------
  const [latestDecision, lastChange] = await Promise.all([
    db.policyDecision.findFirst({ orderBy: { decisionDate: "desc" } }),
    db.policyDecision.findFirst({ where: { decisionType: { not: "HOLD" } }, orderBy: { decisionDate: "desc" } }),
  ]);

  return {
    rateTableRun,
    archiveRun,
    currentRate: latestDecision ? latestDecision.resultingRate.toString() : null,
    latestDecisionDate: latestDecision ? latestDecision.decisionDate.toISOString().slice(0, 10) : null,
    latestDecisionType: latestDecision ? latestDecision.decisionType : null,
    lastChangeDate: lastChange ? lastChange.decisionDate.toISOString().slice(0, 10) : null,
    lastChangeType: lastChange ? lastChange.decisionType : null,
    lastChangeBps: lastChange ? lastChange.changeBps : null,
    errors: { rateTable: tableErrors, archive: archiveErrors },
  };
}
