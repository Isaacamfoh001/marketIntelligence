// ---------------------------------------------------------------------------
// Integration tests for the GSS CPI/Inflation ingestion pipeline.
//
// Real database, mocked HTTP. Synthetic periods use year 2099 so cleanup
// can target exactly what these tests create. Every IngestionRun created
// is tracked and deleted in afterAll — ingestGssInflation upserts against
// the same DataSource live ingestion uses.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/gss-http", () => ({
  postGssJson: vi.fn(),
  fetchGssJson: vi.fn(),
}));

import { postGssJson } from "../ingestion/gss-http";
import { ingestGssInflation } from "../ingestion/gss-cpi-provider";

const db = getPrisma();
const mockPost = vi.mocked(postGssJson);

const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");
const createdRunIds: string[] = [];

async function trackedIngest() {
  const result = await ingestGssInflation();
  createdRunIds.push(result.runId);
  return result;
}

function jsonStat2(entries: [string, number | null][]): { dimension: unknown; value: (number | null)[] } {
  const index: Record<string, number> = {};
  const value: (number | null)[] = [];
  entries.forEach(([period, v], i) => {
    index[period] = i;
    value.push(v);
  });
  return { dimension: { Month: { category: { index } } }, value };
}

/** Mocks postGssJson to return `yoy` for the YoY query and `mom` for the MoM query, keyed off the indicator filter value in the query body. */
function mockIndicators(
  yoy: [string, number | null][],
  mom: [string, number | null][] = [],
) {
  mockPost.mockImplementation(async (_url: string, body: unknown) => {
    const indicator = (body as { query: { code: string; selection: { values: string[] } }[] }).query[0].selection.values[0];
    if (indicator === "Year-on-year inflation (%)") return jsonStat2(yoy);
    if (indicator === "Month-on-month inflation (%)") return jsonStat2(mom);
    throw new Error(`unexpected indicator in test: ${indicator}`);
  });
}

beforeEach(() => {
  mockPost.mockReset();
});

afterEach(async () => {
  await db.macroObservation.deleteMany({
    where: { series: { code: { in: ["GSS_CPI_INFLATION_YOY", "GSS_CPI_INFLATION_MOM"] } }, observationDate: { gte: SYNTHETIC_FLOOR } },
  });
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestGssInflation", () => {
  it("persists a valid observation with correct end-of-month dating and provenance", async () => {
    mockIndicators([["2099M01", 15.2]]);

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.latestYoy).toBe("2099-01-31");

    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_CPI_INFLATION_YOY" }, include: { source: true } });
    const stored = await db.macroObservation.findFirstOrThrow({
      where: { seriesId: series.id, observationDate: new Date("2099-01-31T00:00:00.000Z") },
      include: { ingestionRun: true },
    });
    expect(stored.value.toString()).toBe("15.2");
    // Provenance: MacroObservation -> IngestionRun -> DataSource -> Ghana Statistical Service
    expect(stored.ingestionRunId).toBe(result.runId);
    expect(stored.ingestionRun.dataSourceId).toBe(series.sourceId);
    expect(series.source.provider).toBe("Ghana Statistical Service");
  });

  it("rejects a malformed period without persisting it", async () => {
    mockIndicators([["Jan-2099", 15.2]]);

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRejected).toBeGreaterThan(0);
    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_CPI_INFLATION_YOY" } });
    const count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: { gte: SYNTHETIC_FLOOR } } });
    expect(count).toBe(0);
  });

  it("rejects a non-numeric/malformed value without persisting it, and never stores missing as zero", async () => {
    mockIndicators([
      ["2099M02", Number.NaN],
      ["2099M03", null],
    ]);

    const result = await trackedIngest();

    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_CPI_INFLATION_YOY" } });
    const count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: { gte: SYNTHETIC_FLOOR } } });
    expect(count).toBe(0);
    expect(result.recordsRejected).toBeGreaterThanOrEqual(2);
  });

  it("does not duplicate on a second identical run, and moves provenance on a revised value", async () => {
    mockIndicators([["2099M04", 10.0]]);
    const run1 = await trackedIngest();

    mockIndicators([["2099M04", 10.0]]);
    const run2 = await trackedIngest();

    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_CPI_INFLATION_YOY" } });
    let count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: new Date("2099-04-30T00:00:00.000Z") } });
    expect(count).toBe(1);

    // GSS revises the published rate for the same reference month.
    mockIndicators([["2099M04", 10.25]]);
    const run3 = await trackedIngest();

    count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: new Date("2099-04-30T00:00:00.000Z") } });
    expect(count).toBe(1);

    const stored = await db.macroObservation.findFirstOrThrow({
      where: { seriesId: series.id, observationDate: new Date("2099-04-30T00:00:00.000Z") },
    });
    expect(stored.value.toString()).toBe("10.25");
    expect(stored.ingestionRunId).toBe(run3.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
    expect(stored.ingestionRunId).not.toBe(run2.runId);
  });

  it("persists the MoM series alongside YoY from the same run", async () => {
    mockIndicators([["2099M05", 12.0]], [["2099M05", 1.1]]);

    await trackedIngest();

    const momSeries = await db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_CPI_INFLATION_MOM" } });
    const stored = await db.macroObservation.findFirstOrThrow({
      where: { seriesId: momSeries.id, observationDate: new Date("2099-05-31T00:00:00.000Z") },
    });
    expect(stored.value.toString()).toBe("1.1");
  });

  it("marks the run FAILED with completedAt and an error message when the fetch throws", async () => {
    mockPost.mockRejectedValue(new Error("simulated network failure"));

    const result = await trackedIngest();

    expect(result.status).toBe("FAILED");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.completedAt).not.toBeNull();
    expect(run.errorMessage).toContain("simulated network failure");
  });
});
