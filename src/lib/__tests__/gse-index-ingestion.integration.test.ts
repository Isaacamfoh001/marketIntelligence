// ---------------------------------------------------------------------------
// Integration tests for the GSE Daily Market Summary manual-import
// pipeline. Real database. Synthetic dates use year 2099 so cleanup can
// target exactly what these tests create without touching real imported
// index/market-summary history. Every IngestionRun created is tracked and
// deleted in afterAll.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { importGseMarketSummary } from "../ingestion/gse-index-provider";

const db = getPrisma();
const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");
const createdRunIds: string[] = [];

async function trackedImport(...args: Parameters<typeof importGseMarketSummary>) {
  const result = await importGseMarketSummary(...args);
  if (result.runId) createdRunIds.push(result.runId);
  return result;
}

function csvBuffer(rows: string[]): Buffer {
  const header = "Trading Date,GSE-CI,GSE-FSI,Market Capitalization,Total Volume,Total Value Traded";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

afterEach(async () => {
  await db.marketIndexObservation.deleteMany({ where: { observationDate: { gte: SYNTHETIC_FLOOR } } });
  await db.marketSummary.deleteMany({ where: { tradingDate: { gte: SYNTHETIC_FLOOR } } });
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("importGseMarketSummary — preview", () => {
  it("validates without creating a run or persisting anything", async () => {
    const buffer = csvBuffer(["2099-01-15,6120.45,3980.10,95000000000,1250000,3400000"]);
    const result = await importGseMarketSummary("preview.csv", buffer, { commit: false });

    expect(result.status).toBe("PREVIEW");
    expect(result.runId).toBeNull();
    expect(result.recordsAccepted).toBe(1);

    const ci = await db.marketIndex.findUnique({ where: { code: "GSE-CI" } });
    if (ci) {
      const count = await db.marketIndexObservation.count({ where: { marketIndexId: ci.id, observationDate: { gte: SYNTHETIC_FLOOR } } });
      expect(count).toBe(0);
    }
  });
});

describe("importGseMarketSummary — commit", () => {
  it("splits one row into GSE-CI + GSE-FSI observations and a MarketSummary row, all with correct provenance", async () => {
    const buffer = csvBuffer(["2099-01-15,6120.45,3980.10,95000000000,1250000,3400000"]);
    const result = await trackedImport("market-summary.csv", buffer, { commit: true });

    expect(result.status).toBe("SUCCESS");
    expect(result.indexObservationsPersisted).toBe(2);
    expect(result.summariesPersisted).toBe(1);

    const ci = await db.marketIndex.findUniqueOrThrow({ where: { code: "GSE-CI" } });
    const fsi = await db.marketIndex.findUniqueOrThrow({ where: { code: "GSE-FSI" } });
    const ciObs = await db.marketIndexObservation.findUniqueOrThrow({
      where: { marketIndexId_observationDate: { marketIndexId: ci.id, observationDate: new Date("2099-01-15T00:00:00.000Z") } },
      include: { ingestionRun: { include: { dataSource: true } } },
    });
    const fsiObs = await db.marketIndexObservation.findUniqueOrThrow({
      where: { marketIndexId_observationDate: { marketIndexId: fsi.id, observationDate: new Date("2099-01-15T00:00:00.000Z") } },
    });
    expect(ciObs.level.toString()).toBe("6120.45");
    expect(Number(fsiObs.level)).toBe(3980.1);
    expect(ciObs.ingestionRunId).toBe(result.runId);
    expect(ciObs.ingestionRun.dataSource.name).toBe("Ghana Stock Exchange — Daily Market Summary");

    const summary = await db.marketSummary.findUniqueOrThrow({ where: { tradingDate: new Date("2099-01-15T00:00:00.000Z") } });
    expect(summary.marketCapGhs?.toString()).toBe("95000000000");
    expect(summary.totalVolume).toBe(BigInt(1250000));
  });

  it("never derives GSE-CI from anything but the imported level — no MarketSummary row when only GSE-CI is present", async () => {
    const buffer = csvBuffer(["2099-01-16,6130.00,,,,"]);
    await trackedImport("market-summary.csv", buffer, { commit: true });

    const summary = await db.marketSummary.findUnique({ where: { tradingDate: new Date("2099-01-16T00:00:00.000Z") } });
    expect(summary).toBeNull();
  });

  it("is idempotent across a repeated identical import", async () => {
    const buffer = csvBuffer(["2099-01-17,6120.45,,,,"]);
    await trackedImport("market-summary.csv", buffer, { commit: true });
    await trackedImport("market-summary.csv", buffer, { commit: true });

    const ci = await db.marketIndex.findUniqueOrThrow({ where: { code: "GSE-CI" } });
    const count = await db.marketIndexObservation.count({
      where: { marketIndexId: ci.id, observationDate: new Date("2099-01-17T00:00:00.000Z") },
    });
    expect(count).toBe(1);
  });

  it("upserts a corrected index level and moves provenance to the correcting run", async () => {
    const run1 = await trackedImport("market-summary.csv", csvBuffer(["2099-01-18,6120.45,,,,"]), { commit: true });
    const run2 = await trackedImport("market-summary-corrected.csv", csvBuffer(["2099-01-18,6125.10,,,,"]), { commit: true });

    const ci = await db.marketIndex.findUniqueOrThrow({ where: { code: "GSE-CI" } });
    const stored = await db.marketIndexObservation.findUniqueOrThrow({
      where: { marketIndexId_observationDate: { marketIndexId: ci.id, observationDate: new Date("2099-01-18T00:00:00.000Z") } },
    });
    expect(Number(stored.level)).toBe(6125.1);
    expect(stored.ingestionRunId).toBe(run2.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
  });

  it("produces a FAILED IngestionRun when the file can't be parsed at commit time", async () => {
    const result = await trackedImport("report.pdf", Buffer.from("not a real file"), { commit: true });
    expect(result.status).toBe("FAILED");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId! } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toBeTruthy();
  });

  it("rejects a row with no recognised data column without persisting it", async () => {
    const buffer = csvBuffer(["2099-01-19,,,,,"]);
    const result = await trackedImport("market-summary.csv", buffer, { commit: true });
    expect(result.recordsRejected).toBe(1);
    expect(result.indexObservationsPersisted).toBe(0);
    expect(result.summariesPersisted).toBe(0);
  });
});
