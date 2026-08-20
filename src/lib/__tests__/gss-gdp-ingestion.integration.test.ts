// ---------------------------------------------------------------------------
// Integration tests for the GSS Quarterly GDP ingestion pipeline.
//
// Real database, mocked HTTP. Synthetic periods use year 2099 so cleanup
// can target exactly what these tests create. Every IngestionRun created
// is tracked and deleted in afterAll — ingestGssGdp upserts against the
// same DataSource live ingestion uses.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/gss-http", () => ({
  postGssJson: vi.fn(),
  fetchGssJson: vi.fn(),
}));

import { postGssJson } from "../ingestion/gss-http";
import { ingestGssGdp } from "../ingestion/gss-gdp-provider";

const db = getPrisma();
const mockPost = vi.mocked(postGssJson);

const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");
const createdRunIds: string[] = [];

async function trackedIngest() {
  const result = await ingestGssGdp();
  createdRunIds.push(result.runId);
  return result;
}

function mockGdpResponse(entries: [string, number | null][]) {
  const index: Record<string, number> = {};
  const value: (number | null)[] = [];
  entries.forEach(([period, v], i) => {
    index[period] = i;
    value.push(v);
  });
  mockPost.mockResolvedValue({
    dimension: {
      Quarter: { category: { index } },
      GDP_Series: { category: { index: { "Real GDP growth rate (year-on-year %)": 0 } } },
      Variable: { category: { index: { "Overall GDP": 0 } } },
    },
    value,
  });
}

async function getSeries() {
  return db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_REAL_GDP_GROWTH_YOY" } });
}

beforeEach(() => {
  mockPost.mockReset();
});

afterEach(async () => {
  await db.macroObservation.deleteMany({
    where: { series: { code: "GSS_REAL_GDP_GROWTH_YOY" }, observationDate: { gte: SYNTHETIC_FLOOR } },
  });
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestGssGdp", () => {
  it("persists a valid quarter with correct end-of-quarter dating, headline series, and provenance", async () => {
    mockGdpResponse([["2099Q1", 6.4]]);

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.latest).toBe("2099-03-31");

    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: "GSS_REAL_GDP_GROWTH_YOY" }, include: { source: true } });
    expect(series.category).toBe("GDP");
    expect(series.frequency).toBe("QUARTERLY");

    const stored = await db.macroObservation.findFirstOrThrow({
      where: { seriesId: series.id, observationDate: new Date("2099-03-31T00:00:00.000Z") },
      include: { ingestionRun: true },
    });
    expect(stored.value.toString()).toBe("6.4");
    // Provenance: MacroObservation -> IngestionRun -> DataSource -> Ghana Statistical Service
    expect(stored.ingestionRunId).toBe(result.runId);
    expect(stored.ingestionRun.dataSourceId).toBe(series.sourceId);
    expect(series.source.provider).toBe("Ghana Statistical Service");
  });

  it("rejects a malformed quarter without persisting it", async () => {
    mockGdpResponse([["Q1-2099", 6.4]]);

    await trackedIngest();

    const series = await getSeries();
    const count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: { gte: SYNTHETIC_FLOOR } } });
    expect(count).toBe(0);
  });

  it("rejects a non-numeric growth value, and never stores missing as zero", async () => {
    mockGdpResponse([
      ["2099Q2", Number.NaN],
      ["2099Q3", null],
    ]);

    const result = await trackedIngest();

    const series = await getSeries();
    const count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: { gte: SYNTHETIC_FLOOR } } });
    expect(count).toBe(0);
    expect(result.recordsRejected).toBeGreaterThanOrEqual(2);
  });

  it("does not duplicate on a second identical run, and moves provenance on a revised value", async () => {
    mockGdpResponse([["2099Q4", 5.0]]);
    const run1 = await trackedIngest();

    mockGdpResponse([["2099Q4", 5.0]]);
    const run2 = await trackedIngest();

    const series = await getSeries();
    let count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: new Date("2099-12-31T00:00:00.000Z") } });
    expect(count).toBe(1);

    // GSS revises the published growth rate for the same quarter.
    mockGdpResponse([["2099Q4", 5.3]]);
    const run3 = await trackedIngest();

    count = await db.macroObservation.count({ where: { seriesId: series.id, observationDate: new Date("2099-12-31T00:00:00.000Z") } });
    expect(count).toBe(1);

    const stored = await db.macroObservation.findFirstOrThrow({
      where: { seriesId: series.id, observationDate: new Date("2099-12-31T00:00:00.000Z") },
    });
    expect(stored.value.toString()).toBe("5.3");
    expect(stored.ingestionRunId).toBe(run3.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
    expect(stored.ingestionRunId).not.toBe(run2.runId);
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
