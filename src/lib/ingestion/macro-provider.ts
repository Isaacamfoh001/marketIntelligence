// ---------------------------------------------------------------------------
// Macro ingestion provider.
//
// Demonstrates the full ingestion lifecycle using a local CSV fixture.
// Future providers (BoG, GSS, etc.) follow the same pattern.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { parseDate, parseDecimal, requireString } from "../validation/index";
import {
  startRun,
  completeRun,
  failRun,
} from "./ingestion-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawRow {
  observation_date: string;
  value: string;
}

interface NormalisedRow {
  observationDate: Date;
  value: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseCsvLines(raw: string): RawRow[] {
  const lines = raw.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const rows: RawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = cols[j] ?? "";
    }
    rows.push(row as unknown as RawRow);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Validate + normalise
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: NormalisedRow[];
  invalid: { row: RawRow; errors: string[] }[];
}

export function validateMacroRows(rows: RawRow[]): ValidationResult {
  const valid: NormalisedRow[] = [];
  const invalid: { row: RawRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const dateErr = requireString(row.observation_date, "observation_date");
    const parsedDate = dateErr ? null : parseDate(row.observation_date, "observation_date");
    if (dateErr) errors.push(dateErr.message);
    else if (parsedDate?.error) errors.push(parsedDate.error.message);

    const numCheck = parseDecimal(row.value, "value");
    if (numCheck.error) errors.push(numCheck.error.message);

    if (errors.length > 0) {
      invalid.push({ row, errors });
    } else {
      valid.push({ observationDate: parsedDate!.date!, value: numCheck.value! });
    }
  }

  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// Persist with idempotency (upsert)
// ---------------------------------------------------------------------------

export async function persistMacroObservations(
  runId: string,
  seriesId: string,
  rows: NormalisedRow[],
): Promise<number> {
  const db = getPrisma();
  let persisted = 0;

  for (const row of rows) {
    await db.macroObservation.upsert({
      where: {
        seriesId_observationDate: {
          seriesId,
          observationDate: row.observationDate,
        },
      },
      update: {
        value: row.value,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        seriesId,
        observationDate: row.observationDate,
        value: row.value,
        ingestionRunId: runId,
      },
    });
    persisted++;
  }

  return persisted;
}

// ---------------------------------------------------------------------------
// Full ingestion pipeline
// ---------------------------------------------------------------------------

export interface IngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  errors: { row: RawRow; errors: string[] }[];
}

/**
 * Ingest macro observations from raw CSV content.
 *
 * 1. Find/create fixture DataSource
 * 2. Find/create MacroSeries
 * 3. Start IngestionRun
 * 4. Parse CSV
 * 5. Validate rows
 * 6. Persist valid observations (upsert for idempotency)
 * 7. Complete/fail the run
 */
export async function ingestMacroCsv(
  csvContent: string,
  opts: {
    sourceName: string;
    provider: string;
    seriesCode: string;
    seriesName: string;
    unit: string;
    category?: string;
  },
): Promise<IngestResult> {
  const db = getPrisma();

  // 1. Find or create DataSource
  const dataSource = await db.dataSource.upsert({
    where: { name: opts.sourceName },
    update: {},
    create: {
      name: opts.sourceName,
      provider: opts.provider,
      sourceType: "SEMI_AUTOMATED",
      ingestionMethod: "FILE_IMPORT",
      expectedFrequency: "MONTHLY",
    },
  });

  // 2. Find or create MacroSeries
  const series = await db.macroSeries.upsert({
    where: { code: opts.seriesCode },
    update: {},
    create: {
      code: opts.seriesCode,
      name: opts.seriesName,
      unit: opts.unit,
      frequency: "MONTHLY",
      sourceId: dataSource.id,
      category: opts.category ?? null,
    },
  });

  // 3. Start run
  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "fixture-script",
    artifactName: "macro_fixture.csv",
  });

  try {
    // 4. Parse
    const rawRows = parseCsvLines(csvContent);

    // 5. Validate
    const validation = validateMacroRows(rawRows);

    // 6. Persist valid observations
    const persisted = await persistMacroObservations(
      runId,
      series.id,
      validation.valid,
    );

    // 7. Complete run
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
      errors: [],
    };
  }
}
