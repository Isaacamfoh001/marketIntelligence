// ---------------------------------------------------------------------------
// Ghana Statistical Service CPI/Inflation ingestion — two sources, one series.
//
// Source hierarchy (M5.1):
//
//   1. AUTHORITATIVE FOR A GIVEN MONTH ONCE PRESENT — "Ghana Statistical
//      Service — CPI Latest Release". Semi-automated/manual entry (see
//      gss-cpi-parser.ts for why): GSS's current latest-release surface
//      is not machine-readable — the homepage highlight is a banner
//      image (no text layer, confirmed by inspection: the "Inflation
//      Rate" tile renders an <img> pointing at
//      /images/banner/newcpi0726.png, not text), the CPI-release page
//      is a client-rendered SPA whose initial HTML contains no data (no
//      percentage, no month references — confirmed empirically) and no
//      discoverable JSON API, and monthly bulletin PDFs have no
//      predictable/indexed URL (filenames are hand-edited and
//      inconsistent across months, e.g. "-Final2", "-GSEdits-",
//      "-Rev"). An analyst reads the official release and enters
//      (reference month, headline YoY) through ingestGssInflationLatestRelease,
//      which validates and provenances it exactly like every automated
//      series — never hardcoded into UI/query code.
//
//   2. AUTHORITATIVE FOR HISTORICAL BACKFILL — "Ghana Statistical
//      Service — Consumer Price Index" (StatsBank/PxWeb, unchanged from
//      M5). Reliable, structured, but lags official releases by several
//      months (observed: stops at Jan 2026 while official releases
//      already cover July 2026).
//
// Both write into the SAME MacroSeries (GSS_CPI_INFLATION_YOY) — see
// prisma/schema.prisma's MacroObservation comment for why this isn't
// split into two series. Priority rule (persistYoyRespectingPriority):
// once a month is owned by the Latest Release source, the StatsBank run
// never silently overwrites it — a differing incoming StatsBank value
// is reported as a conflict, not applied. This is the full extent of
// the revision logic; there is no larger revision-history engine.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { postGssJson } from "./gss-http";
import {
  extractCpiRows,
  validateCpiRows,
  validateLatestReleaseRows,
  type RawCpiRow,
  type NormalisedCpiRow,
  type LatestReleaseRawRow,
} from "./gss-cpi-parser";
import { persistMacroObservations } from "./macro-provider";
import { startRun, completeRun, failRun } from "./ingestion-service";
import type { JsonStat2Response } from "./gss-pxweb";

const CPI_TABLE_URL =
  "https://statsbank.statsghana.gov.gh/api/v1/en/Macroeconomic%20Indicators/Prices%20and%20Inflation/cpi.px";

const DATA_SOURCE_NAME = "Ghana Statistical Service — Consumer Price Index";
const LATEST_RELEASE_SOURCE_NAME = "Ghana Statistical Service — CPI Latest Release";
const LATEST_RELEASE_DEFAULT_URL = "https://statsghana.gov.gh/highlights/inflation-rate";

const YOY_INDICATOR = "Year-on-year inflation (%)";
const MOM_INDICATOR = "Month-on-month inflation (%)";

const YOY_SERIES_CODE = "GSS_CPI_INFLATION_YOY";
const MOM_SERIES_CODE = "GSS_CPI_INFLATION_MOM";

async function ensureDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Statistical Service",
      sourceType: "AUTOMATED",
      url: CPI_TABLE_URL,
      expectedFrequency: "MONTHLY",
      ingestionMethod: "API",
      active: true,
    },
  });
}

async function ensureLatestReleaseDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: LATEST_RELEASE_SOURCE_NAME },
    update: {},
    create: {
      name: LATEST_RELEASE_SOURCE_NAME,
      provider: "Ghana Statistical Service",
      sourceType: "SEMI_AUTOMATED",
      url: LATEST_RELEASE_DEFAULT_URL,
      expectedFrequency: "MONTHLY",
      ingestionMethod: "MANUAL_ENTRY",
      active: true,
    },
  });
}

async function ensureSeries(sourceId: string, code: string, name: string) {
  const db = getPrisma();
  return db.macroSeries.upsert({
    where: { code },
    update: {},
    create: { code, name, category: "Inflation", unit: "%", frequency: "MONTHLY", sourceId },
  });
}

function buildIndicatorQuery(indicator: string) {
  return {
    query: [{ code: "Indicator", selection: { filter: "item", values: [indicator] } }],
    response: { format: "json-stat2" },
  };
}

async function fetchIndicatorRows(indicator: string): Promise<RawCpiRow[]> {
  const json = await postGssJson(CPI_TABLE_URL, buildIndicatorQuery(indicator));
  return extractCpiRows(json as JsonStat2Response);
}

function earliestLatest(rows: { observationDate: Date }[]): { earliest: string | null; latest: string | null } {
  if (rows.length === 0) return { earliest: null, latest: null };
  const dates = rows.map((r) => r.observationDate.getTime());
  return {
    earliest: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    latest: new Date(Math.max(...dates)).toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Priority-aware persist for the headline YoY series only (MoM has no
// competing higher-priority source, so it keeps using the plain
// persistMacroObservations upsert).
// ---------------------------------------------------------------------------

export interface CpiConflict {
  observationDate: string;
  incomingValue: string;
  existingValue: string;
}

async function persistYoyRespectingPriority(
  runId: string,
  seriesId: string,
  higherPrioritySourceId: string,
  rows: NormalisedCpiRow[],
): Promise<{ persisted: number; conflicts: CpiConflict[] }> {
  const db = getPrisma();
  let persisted = 0;
  const conflicts: CpiConflict[] = [];

  for (const row of rows) {
    const existing = await db.macroObservation.findUnique({
      where: { seriesId_observationDate: { seriesId, observationDate: row.observationDate } },
      include: { ingestionRun: true },
    });

    if (existing && existing.ingestionRun.dataSourceId === higherPrioritySourceId) {
      if (Number(existing.value) !== Number(row.value)) {
        conflicts.push({
          observationDate: row.observationDate.toISOString().slice(0, 10),
          incomingValue: row.value,
          existingValue: existing.value.toString(),
        });
      }
      continue; // never overwrite the higher-priority source
    }

    await db.macroObservation.upsert({
      where: { seriesId_observationDate: { seriesId, observationDate: row.observationDate } },
      update: { value: row.value, retrievedAt: new Date(), ingestionRunId: runId },
      create: { seriesId, observationDate: row.observationDate, value: row.value, ingestionRunId: runId },
    });
    persisted++;
  }

  return { persisted, conflicts };
}

// ---------------------------------------------------------------------------
// StatsBank historical/backfill ingestion
// ---------------------------------------------------------------------------

export interface CpiIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  earliestYoy: string | null;
  latestYoy: string | null;
  conflicts: CpiConflict[];
  errors: { row: RawCpiRow; errors: string[] }[];
}

export async function ingestGssInflation(): Promise<CpiIngestResult> {
  const dataSource = await ensureDataSource();
  const yoySeries = await ensureSeries(dataSource.id, YOY_SERIES_CODE, "Ghana CPI Inflation — YoY");
  const momSeries = await ensureSeries(dataSource.id, MOM_SERIES_CODE, "Ghana CPI Inflation — MoM");
  const latestReleaseSource = await ensureLatestReleaseDataSource();

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "cli",
    artifactName: CPI_TABLE_URL,
  });

  try {
    const [yoyRaw, momRaw] = await Promise.all([fetchIndicatorRows(YOY_INDICATOR), fetchIndicatorRows(MOM_INDICATOR)]);

    const yoyValidation = validateCpiRows(yoyRaw);
    const momValidation = validateCpiRows(momRaw);

    const [{ persisted: yoyPersisted, conflicts }, momPersisted] = await Promise.all([
      persistYoyRespectingPriority(runId, yoySeries.id, latestReleaseSource.id, yoyValidation.valid),
      persistMacroObservations(runId, momSeries.id, momValidation.valid),
    ]);

    const recordsRead = yoyRaw.length + momRaw.length;
    const recordsAccepted = yoyValidation.valid.length + momValidation.valid.length;
    const recordsRejected = yoyValidation.invalid.length + momValidation.invalid.length;

    const run = await completeRun(runId, { recordsRead, recordsAccepted, recordsRejected });
    const { earliest, latest } = earliestLatest(yoyValidation.valid);

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted: yoyPersisted + momPersisted,
      earliestYoy: earliest,
      latestYoy: latest,
      conflicts,
      errors: [...yoyValidation.invalid, ...momValidation.invalid],
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
      earliestYoy: null,
      latestYoy: null,
      conflicts: [],
      errors: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Latest official release — semi-automated/manual entry
// ---------------------------------------------------------------------------

export interface CpiLatestReleaseResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  latest: string | null;
  errors: { row: LatestReleaseRawRow; errors: string[] }[];
}

/**
 * Records one or more official monthly CPI releases (reference month +
 * headline YoY) sourced by an analyst from the official GSS release
 * surface. Always takes priority over StatsBank for the same month —
 * see persistYoyRespectingPriority.
 */
export async function ingestGssInflationLatestRelease(
  observations: LatestReleaseRawRow[],
  sourceUrl?: string,
): Promise<CpiLatestReleaseResult> {
  const cpiDataSource = await ensureDataSource();
  const yoySeries = await ensureSeries(cpiDataSource.id, YOY_SERIES_CODE, "Ghana CPI Inflation — YoY");
  const latestReleaseSource = await ensureLatestReleaseDataSource();

  const { runId } = await startRun({
    dataSourceId: latestReleaseSource.id,
    triggeredBy: "manual",
    artifactName: sourceUrl ?? LATEST_RELEASE_DEFAULT_URL,
  });

  try {
    const validation = validateLatestReleaseRows(observations);
    const db = getPrisma();
    let persisted = 0;

    for (const row of validation.valid) {
      await db.macroObservation.upsert({
        where: { seriesId_observationDate: { seriesId: yoySeries.id, observationDate: row.observationDate } },
        update: { value: row.value, retrievedAt: new Date(), ingestionRunId: runId },
        create: { seriesId: yoySeries.id, observationDate: row.observationDate, value: row.value, ingestionRunId: runId },
      });
      persisted++;
    }

    const run = await completeRun(runId, {
      recordsRead: observations.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    const { latest } = earliestLatest(validation.valid);

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      latest,
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
      latest: null,
      errors: [],
    };
  }
}
