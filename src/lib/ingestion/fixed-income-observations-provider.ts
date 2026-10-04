// ---------------------------------------------------------------------------
// Fixed Income Market Observations — import provider (M7).
//
// Mirrors gse-security-provider.ts's shape: a row references an already-
// existing FixedIncomeSecurity by instrumentCode (created via the
// Securities Master import) — an observation for an unknown instrument
// code is rejected with a clear error rather than silently creating a
// placeholder security with no contractual terms, which would produce
// meaningless analytics downstream.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { parseImportFile } from "./file-parse";
import {
  extractFixedIncomeObservationRows,
  validateFixedIncomeObservationRows,
  type NormalisedFixedIncomeObservationRow,
  type RawFixedIncomeObservationRow,
} from "./fixed-income-observations-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const DATA_SOURCE_NAME = "Ghana Fixed Income Market — Market Observations";

export const PREVIEW_SAMPLE_SIZE = 50;

export async function ensureFixedIncomeObservationsDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Fixed Income Market",
      sourceType: "MANUAL",
      url: null,
      expectedFrequency: "AD_HOC",
      ingestionMethod: "FILE_IMPORT",
      active: true,
    },
  });
}

export interface UnknownInstrumentError {
  instrumentCode: string;
  rowNumber: number;
}

async function persistObservations(
  runId: string,
  sourceId: string,
  rows: NormalisedFixedIncomeObservationRow[],
  rowNumberByRow: Map<NormalisedFixedIncomeObservationRow, number>,
): Promise<{ inserted: number; updated: number; unknownInstruments: UnknownInstrumentError[] }> {
  const db = getPrisma();
  let inserted = 0;
  let updated = 0;
  const unknownInstruments: UnknownInstrumentError[] = [];
  const securityIdCache = new Map<string, string | null>();

  for (const row of rows) {
    let securityId = securityIdCache.get(row.instrumentCode);
    if (securityId === undefined) {
      const security = await db.fixedIncomeSecurity.findUnique({ where: { instrumentCode: row.instrumentCode } });
      securityId = security?.id ?? null;
      securityIdCache.set(row.instrumentCode, securityId);
    }
    if (!securityId) {
      unknownInstruments.push({ instrumentCode: row.instrumentCode, rowNumber: rowNumberByRow.get(row) ?? 0 });
      continue;
    }

    const existing = await db.fixedIncomeObservation.findUnique({
      where: { securityId_observationDate: { securityId, observationDate: row.observationDate } },
    });

    await db.fixedIncomeObservation.upsert({
      where: { securityId_observationDate: { securityId, observationDate: row.observationDate } },
      update: {
        cleanPrice: row.cleanPrice,
        sourceYieldPct: row.sourceYieldPct,
        volumeTradedGhs: row.volumeTradedGhs,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        securityId,
        observationDate: row.observationDate,
        cleanPrice: row.cleanPrice,
        sourceYieldPct: row.sourceYieldPct,
        volumeTradedGhs: row.volumeTradedGhs,
        sourceId,
        ingestionRunId: runId,
      },
    });

    if (existing) updated++;
    else inserted++;
  }

  return { inserted, updated, unknownInstruments };
}

export interface FixedIncomeObservationsImportResult {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "PREVIEW";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  inserted: number;
  updated: number;
  instrumentCodes: string[];
  earliestObservationDate: string | null;
  latestObservationDate: string | null;
  errors: { row: RawFixedIncomeObservationRow; errors: string[]; rowNumber: number }[];
  unknownInstruments: UnknownInstrumentError[];
  sampleValid: NormalisedFixedIncomeObservationRow[];
}

function dateRange(rows: { observationDate: Date }[]): { earliest: string | null; latest: string | null } {
  if (rows.length === 0) return { earliest: null, latest: null };
  const sorted = rows.map((r) => r.observationDate).sort((a, b) => a.getTime() - b.getTime());
  return { earliest: sorted[0].toISOString().slice(0, 10), latest: sorted[sorted.length - 1].toISOString().slice(0, 10) };
}

export async function importFixedIncomeObservations(
  filename: string,
  buffer: Buffer,
  opts: { commit: boolean; triggeredBy?: string } = { commit: false },
): Promise<FixedIncomeObservationsImportResult> {
  if (!opts.commit) {
    try {
      const parsedFile = await parseImportFile(filename, buffer);
      const rawRows = extractFixedIncomeObservationRows(parsedFile);
      const validation = validateFixedIncomeObservationRows(rawRows);
      const instrumentCodes = Array.from(new Set(validation.valid.map((r) => r.instrumentCode))).sort();
      const { earliest, latest } = dateRange(validation.valid);
      return {
        runId: null,
        status: "PREVIEW",
        recordsRead: rawRows.length,
        recordsAccepted: validation.valid.length,
        recordsRejected: validation.invalid.length,
        inserted: 0,
        updated: 0,
        instrumentCodes,
        earliestObservationDate: earliest,
        latestObservationDate: latest,
        errors: validation.invalid,
        unknownInstruments: [],
        sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        runId: null,
        status: "PREVIEW",
        recordsRead: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        inserted: 0,
        updated: 0,
        instrumentCodes: [],
        earliestObservationDate: null,
        latestObservationDate: null,
        errors: [{ row: {}, errors: [message], rowNumber: 0 }],
        unknownInstruments: [],
        sampleValid: [],
      };
    }
  }

  const dataSource = await ensureFixedIncomeObservationsDataSource();
  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: opts.triggeredBy ?? "cli",
    artifactName: filename,
    acquisitionMethod: "MANUAL_FILE_IMPORT",
  });

  try {
    const parsedFile = await parseImportFile(filename, buffer);
    const rawRows = extractFixedIncomeObservationRows(parsedFile);
    const validation = validateFixedIncomeObservationRows(rawRows);
    const instrumentCodes = Array.from(new Set(validation.valid.map((r) => r.instrumentCode))).sort();
    const { earliest, latest } = dateRange(validation.valid);

    const rowNumberByRow = new Map<NormalisedFixedIncomeObservationRow, number>();
    validation.valid.forEach((row, i) => rowNumberByRow.set(row, i + 2));

    const { inserted, updated, unknownInstruments } = await persistObservations(runId, dataSource.id, validation.valid, rowNumberByRow);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length - unknownInstruments.length,
      recordsRejected: validation.invalid.length + unknownInstruments.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      inserted,
      updated,
      instrumentCodes,
      earliestObservationDate: earliest,
      latestObservationDate: latest,
      errors: validation.invalid,
      unknownInstruments,
      sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
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
      inserted: 0,
      updated: 0,
      instrumentCodes: [],
      earliestObservationDate: null,
      latestObservationDate: null,
      errors: [],
      unknownInstruments: [],
      sampleValid: [],
    };
  }
}
