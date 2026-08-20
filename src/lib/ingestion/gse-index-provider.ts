// ---------------------------------------------------------------------------
// GSE Daily Market Summary — index & whole-market import provider.
//
// See gse-security-provider.ts for the full note on why this is a manual
// (CLAUDE.md Mode B/C) import rather than an automated fetch: gse.com.gh's
// robots.txt explicitly disallows AI-agent user agents site-wide.
//
// One row → up to two MarketIndexObservation rows (GSE-CI, GSE-FSI) and at
// most one MarketSummary row, split apart rather than reconstructed from
// each other — GSE publishes these as independent daily facts, and
// CLAUDE.md is explicit that Korbly must never derive an index level from
// constituent security prices.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { parseImportFile } from "./file-parse";
import { extractGseIndexRows, validateGseIndexRows, type NormalisedGseIndexRow, type RawGseIndexRow } from "./gse-index-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";

const DATA_SOURCE_NAME = "Ghana Stock Exchange — Daily Market Summary";

export const MARKET_INDEXES = {
  GSE_CI: { code: "GSE-CI", name: "GSE Composite Index" },
  GSE_FSI: { code: "GSE-FSI", name: "GSE Financial Stocks Index" },
} as const;

/** See ensureGseSecurityDataSources in gse-security-provider.ts — same rationale, so Data Centre can show this source before any import has run. */
export async function ensureGseIndexDataSource() {
  return ensureDataSource();
}

async function ensureDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Stock Exchange",
      sourceType: "MANUAL",
      url: "https://gse.com.gh/market-statistics/",
      expectedFrequency: "DAILY",
      ingestionMethod: "FILE_IMPORT",
      active: true,
    },
  });
}

async function ensureIndexes(): Promise<Record<keyof typeof MARKET_INDEXES, { id: string }>> {
  const db = getPrisma();
  const entries = await Promise.all(
    (Object.entries(MARKET_INDEXES) as [keyof typeof MARKET_INDEXES, { code: string; name: string }][]).map(
      async ([key, spec]) => {
        const index = await db.marketIndex.upsert({
          where: { code: spec.code },
          update: {},
          create: { code: spec.code, name: spec.name },
        });
        return [key, index] as const;
      },
    ),
  );
  return Object.fromEntries(entries) as unknown as Record<keyof typeof MARKET_INDEXES, { id: string }>;
}

async function persistIndexAndSummary(
  runId: string,
  sourceId: string,
  indexes: Record<keyof typeof MARKET_INDEXES, { id: string }>,
  rows: NormalisedGseIndexRow[],
): Promise<{ indexObservationsPersisted: number; summariesPersisted: number; inserted: number; updated: number }> {
  const db = getPrisma();
  let indexObservationsPersisted = 0;
  let summariesPersisted = 0;
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    for (const [key, level] of [
      ["GSE_CI", row.gseCi],
      ["GSE_FSI", row.gseFsi],
    ] as const) {
      if (level === null) continue;
      const marketIndexId = indexes[key].id;
      const existing = await db.marketIndexObservation.findUnique({
        where: { marketIndexId_observationDate: { marketIndexId, observationDate: row.tradingDate } },
        select: { id: true },
      });
      await db.marketIndexObservation.upsert({
        where: { marketIndexId_observationDate: { marketIndexId, observationDate: row.tradingDate } },
        update: { level, sourceId, retrievedAt: new Date(), ingestionRunId: runId },
        create: { marketIndexId, observationDate: row.tradingDate, level, sourceId, ingestionRunId: runId },
      });
      indexObservationsPersisted++;
      if (existing) updated++;
      else inserted++;
    }

    if (row.marketCapGhs !== null || row.totalVolume !== null || row.totalValueTradedGhs !== null) {
      await db.marketSummary.upsert({
        where: { tradingDate: row.tradingDate },
        update: {
          totalVolume: row.totalVolume !== null ? BigInt(Math.round(Number(row.totalVolume))) : null,
          totalValueTradedGhs: row.totalValueTradedGhs,
          marketCapGhs: row.marketCapGhs,
          sourceId,
          retrievedAt: new Date(),
          ingestionRunId: runId,
        },
        create: {
          tradingDate: row.tradingDate,
          totalVolume: row.totalVolume !== null ? BigInt(Math.round(Number(row.totalVolume))) : null,
          totalValueTradedGhs: row.totalValueTradedGhs,
          marketCapGhs: row.marketCapGhs,
          sourceId,
          ingestionRunId: runId,
        },
      });
      summariesPersisted++;
    }
  }

  return { indexObservationsPersisted, summariesPersisted, inserted, updated };
}

export interface GseIndexImportResult {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "PREVIEW";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  indexObservationsPersisted: number;
  summariesPersisted: number;
  inserted: number;
  updated: number;
  earliestTradingDate: string | null;
  latestTradingDate: string | null;
  errors: { row: RawGseIndexRow; errors: string[]; rowNumber: number }[];
  /** First PREVIEW_SAMPLE_SIZE accepted rows — for a UI preview table, never the full set. */
  sampleValid: NormalisedGseIndexRow[];
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

/** See importGseSecurityPrices for why preview parses standalone (no run) while commit creates the run before parsing, so a parse failure at commit time still produces a FAILED IngestionRun. */
export async function importGseMarketSummary(
  filename: string,
  buffer: Buffer,
  opts: { commit: boolean; triggeredBy?: string } = { commit: false },
): Promise<GseIndexImportResult> {
  if (!opts.commit) {
    try {
      const parsedFile = await parseImportFile(filename, buffer);
      const rawRows = extractGseIndexRows(parsedFile);
      const validation = validateGseIndexRows(rawRows);
      return {
        runId: null,
        status: "PREVIEW",
        recordsRead: rawRows.length,
        recordsAccepted: validation.valid.length,
        recordsRejected: validation.invalid.length,
        indexObservationsPersisted: 0,
        summariesPersisted: 0,
        inserted: 0,
        updated: 0,
        earliestTradingDate: earliestDate(validation.valid),
        latestTradingDate: latestDate(validation.valid),
        errors: validation.invalid,
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
        indexObservationsPersisted: 0,
        summariesPersisted: 0,
        inserted: 0,
        updated: 0,
        earliestTradingDate: null,
        latestTradingDate: null,
        errors: [{ row: {}, errors: [message], rowNumber: 0 }],
        sampleValid: [],
      };
    }
  }

  const dataSource = await ensureDataSource();
  const indexes = await ensureIndexes();
  const { runId } = await startRun({ dataSourceId: dataSource.id, triggeredBy: opts.triggeredBy ?? "cli", artifactName: filename });

  try {
    const parsedFile = await parseImportFile(filename, buffer);
    const rawRows = extractGseIndexRows(parsedFile);
    const validation = validateGseIndexRows(rawRows);

    const { indexObservationsPersisted, summariesPersisted, inserted, updated } = await persistIndexAndSummary(
      runId,
      dataSource.id,
      indexes,
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
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      indexObservationsPersisted,
      summariesPersisted,
      inserted,
      updated,
      earliestTradingDate: earliestDate(validation.valid),
      latestTradingDate: latestDate(validation.valid),
      errors: validation.invalid,
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
      indexObservationsPersisted: 0,
      summariesPersisted: 0,
      inserted: 0,
      updated: 0,
      earliestTradingDate: null,
      latestTradingDate: null,
      errors: [],
      sampleValid: [],
    };
  }
}
