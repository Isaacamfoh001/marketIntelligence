// ---------------------------------------------------------------------------
// Integration tests for the ingestion lifecycle.
//
// These hit a real PostgreSQL database (DATABASE_URL) rather than mocking
// Prisma, because the behaviour under test — status transitions, unique
// constraints, FK restrict behaviour — only exists at the database layer.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { startRun, completeRun, failRun } from "../ingestion/ingestion-service";
import { ingestMacroCsv, persistMacroObservations } from "../ingestion/macro-provider";

const db = getPrisma();

// Unique suffix so repeated test runs never collide with each other or with
// fixture data seeded by `npm run ingest:fixture`.
const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const dataSourceIds: string[] = [];
const seriesIds: string[] = [];

afterAll(async () => {
  // Children before parents: MacroObservation -> IngestionRun -> MacroSeries -> DataSource.
  await db.macroObservation.deleteMany({ where: { seriesId: { in: seriesIds } } });
  await db.ingestionRun.deleteMany({ where: { dataSourceId: { in: dataSourceIds } } });
  await db.macroSeries.deleteMany({ where: { id: { in: seriesIds } } });
  await db.dataSource.deleteMany({ where: { id: { in: dataSourceIds } } });
});

describe("ingestion lifecycle", () => {
  it("marks a run SUCCESS with completedAt and counts populated", async () => {
    const source = await db.dataSource.create({
      data: { name: `Lifecycle Source ${suffix}`, provider: "Test Provider" },
    });
    dataSourceIds.push(source.id);

    const { runId } = await startRun({ dataSourceId: source.id, triggeredBy: "test" });
    const before = await db.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(before.status).toBe("RUNNING");
    expect(before.completedAt).toBeNull();

    const result = await completeRun(runId, {
      recordsRead: 5,
      recordsAccepted: 4,
      recordsRejected: 1,
    });

    expect(result.status).toBe("SUCCESS");
    const after = await db.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(after.status).toBe("SUCCESS");
    expect(after.completedAt).not.toBeNull();
    expect(after.recordsRead).toBe(5);
    expect(after.recordsAccepted).toBe(4);
    expect(after.recordsRejected).toBe(1);
  });

  it("marks a run FAILED with completedAt and an error message when the pipeline throws", async () => {
    const source = await db.dataSource.create({
      data: { name: `Failure Source ${suffix}`, provider: "Test Provider" },
    });
    dataSourceIds.push(source.id);

    const { runId } = await startRun({ dataSourceId: source.id, triggeredBy: "test" });

    // Drive a genuine failure through the same try/persist/catch/failRun
    // pattern ingestMacroCsv uses internally: persisting against a
    // non-existent seriesId violates the FK and throws.
    try {
      await persistMacroObservations(runId, "nonexistent-series-id", [
        { observationDate: new Date("2026-01-01T00:00:00.000Z"), value: "1" },
      ]);
      throw new Error("expected persistMacroObservations to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failRun(runId, message);
    }

    const after = await db.ingestionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(after.status).toBe("FAILED");
    expect(after.completedAt).not.toBeNull();
    expect(after.errorMessage).toBeTruthy();
  });
});

describe("macro CSV ingestion — idempotency and provenance", () => {
  it("does not duplicate observations across repeated runs, and updates provenance on change", async () => {
    const seriesCode = `TEST_SERIES_${suffix}`;
    const csvV1 = "observation_date,value\n2026-01-01,10.0\n2026-02-01,11.0";

    const run1 = await ingestMacroCsv(csvV1, {
      sourceName: `Idempotency Source ${suffix}`,
      provider: "Test Provider",
      seriesCode,
      seriesName: "Test Series",
      unit: "%",
    });
    expect(run1.status).toBe("SUCCESS");
    expect(run1.persisted).toBe(2);

    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: seriesCode } });
    seriesIds.push(series.id);
    dataSourceIds.push(series.sourceId);

    const countAfterFirst = await db.macroObservation.count({ where: { seriesId: series.id } });
    expect(countAfterFirst).toBe(2);

    // Re-run the identical CSV — must not create duplicate rows.
    const run2 = await ingestMacroCsv(csvV1, {
      sourceName: `Idempotency Source ${suffix}`,
      provider: "Test Provider",
      seriesCode,
      seriesName: "Test Series",
      unit: "%",
    });
    expect(run2.status).toBe("SUCCESS");

    const countAfterRepeat = await db.macroObservation.count({ where: { seriesId: series.id } });
    expect(countAfterRepeat).toBe(2);

    // Provenance: every observation must reference the run that most
    // recently confirmed its value.
    const observations = await db.macroObservation.findMany({
      where: { seriesId: series.id },
      orderBy: { observationDate: "asc" },
    });
    expect(observations[0].ingestionRunId).toBe(run2.runId);
    expect(observations[1].ingestionRunId).toBe(run2.runId);

    // A corrected republish (revised value for an existing date) updates
    // the row in place rather than creating a second observation.
    const csvV2 = "observation_date,value\n2026-01-01,10.5\n2026-02-01,11.0";
    const run3 = await ingestMacroCsv(csvV2, {
      sourceName: `Idempotency Source ${suffix}`,
      provider: "Test Provider",
      seriesCode,
      seriesName: "Test Series",
      unit: "%",
    });
    expect(run3.status).toBe("SUCCESS");

    const countAfterRevision = await db.macroObservation.count({ where: { seriesId: series.id } });
    expect(countAfterRevision).toBe(2);

    const revised = await db.macroObservation.findUniqueOrThrow({
      where: { seriesId_observationDate: { seriesId: series.id, observationDate: new Date("2026-01-01T00:00:00.000Z") } },
    });
    expect(revised.value.toString()).toBe("10.5");
    expect(revised.ingestionRunId).toBe(run3.runId);
  });

  it("records rejected rows without persisting them or corrupting the run's accepted rows", async () => {
    const seriesCode = `TEST_MIXED_${suffix}`;
    const csv = "observation_date,value\n2026-01-01,10.0\n2026-13-40,11.0\nbad-date,abc";

    const result = await ingestMacroCsv(csv, {
      sourceName: `Mixed Source ${suffix}`,
      provider: "Test Provider",
      seriesCode,
      seriesName: "Test Mixed Series",
      unit: "%",
    });

    const series = await db.macroSeries.findUniqueOrThrow({ where: { code: seriesCode } });
    seriesIds.push(series.id);
    dataSourceIds.push(series.sourceId);

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(3);
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsRejected).toBe(2);
    expect(result.persisted).toBe(1);

    const count = await db.macroObservation.count({ where: { seriesId: series.id } });
    expect(count).toBe(1);
  });
});

describe("DataSource deletion protection", () => {
  it("blocks deleting a DataSource that has IngestionRuns", async () => {
    const source = await db.dataSource.create({
      data: { name: `Protected Source ${suffix}`, provider: "Test Provider" },
    });
    dataSourceIds.push(source.id);
    await startRun({ dataSourceId: source.id, triggeredBy: "test" });

    await expect(db.dataSource.delete({ where: { id: source.id } })).rejects.toThrow();

    const stillExists = await db.dataSource.findUnique({ where: { id: source.id } });
    expect(stillExists).not.toBeNull();
  });

  it("blocks deleting a DataSource that has a MacroSeries", async () => {
    const source = await db.dataSource.create({
      data: { name: `Series-Protected Source ${suffix}`, provider: "Test Provider" },
    });
    dataSourceIds.push(source.id);
    const series = await db.macroSeries.create({
      data: {
        code: `PROTECTED_SERIES_${suffix}`,
        name: "Protected Series",
        unit: "%",
        frequency: "MONTHLY",
        sourceId: source.id,
      },
    });
    seriesIds.push(series.id);

    await expect(db.dataSource.delete({ where: { id: source.id } })).rejects.toThrow();
  });
});
