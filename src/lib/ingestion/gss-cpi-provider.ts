// ---------------------------------------------------------------------------
// Ghana Statistical Service CPI/Inflation ingestion provider.
//
// See gss-cpi-parser.ts for source/table details. One IngestionRun
// covers both series (Year-on-year and Month-on-month inflation): they
// come from the same table via two small queries, and grouping them
// keeps the CLI to one command instead of splitting a single official
// table across two runs.
//
// The full available history (currently back to 1998) is ingested in
// one request per indicator — PxWeb returns the whole series at once,
// so there's no separate "daily" vs "backfill" split needed (same
// pattern as MPR's rate-decisions table in M4.1).
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { postGssJson } from "./gss-http";
import { extractCpiRows, validateCpiRows, type RawCpiRow } from "./gss-cpi-parser";
import { persistMacroObservations } from "./macro-provider";
import { startRun, completeRun, failRun } from "./ingestion-service";
import type { JsonStat2Response } from "./gss-pxweb";

const CPI_TABLE_URL =
  "https://statsbank.statsghana.gov.gh/api/v1/en/Macroeconomic%20Indicators/Prices%20and%20Inflation/cpi.px";

const DATA_SOURCE_NAME = "Ghana Statistical Service — Consumer Price Index";

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

export interface CpiIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  earliestYoy: string | null;
  latestYoy: string | null;
  errors: { row: RawCpiRow; errors: string[] }[];
}

function earliestLatest(rows: { observationDate: Date }[]): { earliest: string | null; latest: string | null } {
  if (rows.length === 0) return { earliest: null, latest: null };
  const dates = rows.map((r) => r.observationDate.getTime());
  return {
    earliest: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    latest: new Date(Math.max(...dates)).toISOString().slice(0, 10),
  };
}

export async function ingestGssInflation(): Promise<CpiIngestResult> {
  const dataSource = await ensureDataSource();
  const yoySeries = await ensureSeries(dataSource.id, YOY_SERIES_CODE, "Ghana CPI Inflation — YoY");
  const momSeries = await ensureSeries(dataSource.id, MOM_SERIES_CODE, "Ghana CPI Inflation — MoM");

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "cli",
    artifactName: CPI_TABLE_URL,
  });

  try {
    const [yoyRaw, momRaw] = await Promise.all([fetchIndicatorRows(YOY_INDICATOR), fetchIndicatorRows(MOM_INDICATOR)]);

    const yoyValidation = validateCpiRows(yoyRaw);
    const momValidation = validateCpiRows(momRaw);

    const [yoyPersisted, momPersisted] = await Promise.all([
      persistMacroObservations(runId, yoySeries.id, yoyValidation.valid),
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
      errors: [],
    };
  }
}
