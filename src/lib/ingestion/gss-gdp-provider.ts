// ---------------------------------------------------------------------------
// Ghana Statistical Service Quarterly GDP ingestion provider.
//
// See gss-gdp-parser.ts for source/table/series-selection details. Only
// the headline "Real GDP growth rate (year-on-year %)" / "Overall GDP"
// series is ingested — production approach only, never mixed with the
// separate expenditure-approach table. Full available history (currently
// back to 2006Q1) is fetched in one query, same "no separate backfill
// mode needed" pattern as CPI and MPR.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { postGssJson } from "./gss-http";
import { extractGdpRows, validateGdpRows, GDP_SERIES_YOY_GROWTH, GDP_VARIABLE_OVERALL, type RawGdpRow } from "./gss-gdp-parser";
import { persistMacroObservations } from "./macro-provider";
import { startRun, completeRun, failRun } from "./ingestion-service";
import type { JsonStat2Response } from "./gss-pxweb";

const GDP_TABLE_URL =
  "https://statsbank.statsghana.gov.gh/api/v1/en/Macroeconomic%20Indicators/Real%20Sector%20(GDP)/Quarterly%20GDP/qgdp_p_px.px";

const DATA_SOURCE_NAME = "Ghana Statistical Service — Quarterly GDP";
const SERIES_CODE = "GSS_REAL_GDP_GROWTH_YOY";

async function ensureDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Statistical Service",
      sourceType: "AUTOMATED",
      url: GDP_TABLE_URL,
      expectedFrequency: "QUARTERLY",
      ingestionMethod: "API",
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
      name: "Ghana Real GDP Growth — YoY (Overall, Production Approach)",
      category: "GDP",
      unit: "%",
      frequency: "QUARTERLY",
      sourceId,
    },
  });
}

function buildGdpQuery() {
  return {
    query: [
      { code: "GDP_Series", selection: { filter: "item", values: [GDP_SERIES_YOY_GROWTH] } },
      { code: "Variable", selection: { filter: "item", values: [GDP_VARIABLE_OVERALL] } },
    ],
    response: { format: "json-stat2" },
  };
}

export interface GdpIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  persisted: number;
  earliest: string | null;
  latest: string | null;
  errors: { row: RawGdpRow; errors: string[] }[];
}

export async function ingestGssGdp(): Promise<GdpIngestResult> {
  const dataSource = await ensureDataSource();
  const series = await ensureSeries(dataSource.id);

  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: "cli",
    artifactName: GDP_TABLE_URL,
  });

  try {
    const json = await postGssJson(GDP_TABLE_URL, buildGdpQuery());
    const rawRows = extractGdpRows(json as JsonStat2Response);
    const validation = validateGdpRows(rawRows);
    const persisted = await persistMacroObservations(runId, series.id, validation.valid);

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    const dates = validation.valid.map((r) => r.observationDate.getTime());
    const earliest = dates.length > 0 ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null;
    const latest = dates.length > 0 ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null;

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      persisted,
      earliest,
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
      earliest: null,
      latest: null,
      errors: [],
    };
  }
}
