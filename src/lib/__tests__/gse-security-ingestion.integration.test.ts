// ---------------------------------------------------------------------------
// Integration tests for the GSE security-price manual-import pipeline.
//
// Real database, no HTTP to mock — this provider reads an in-memory
// buffer, not a live page (see gse-security-provider.ts for why: GSE's
// robots.txt disallows AI agents site-wide). Test tickers use a
// "ZZ"-prefixed synthetic namespace (ZZTEST1/ZZTEST2) that can never
// collide with a real GSE share code, so cleanup can target exactly what
// these tests create without touching real imported data. Every
// IngestionRun created is tracked and deleted in afterAll.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { importGseSecurityPrices } from "../ingestion/gse-security-provider";

const db = getPrisma();
const TEST_TICKERS = ["ZZTEST1", "ZZTEST2", "ZZTEST3"];
const createdRunIds: string[] = [];

async function trackedImport(...args: Parameters<typeof importGseSecurityPrices>) {
  const result = await importGseSecurityPrices(...args);
  if (result.runId) createdRunIds.push(result.runId);
  return result;
}

function csvBuffer(rows: string[]): Buffer {
  const header = "Trading Date,Share Code,Previous Closing Price - VWAP,Opening Price,Last Transaction Price,Closing Price - VWAP,Price Change,Closing Bid,Closing Offer,Total Shares Traded,Total Value Traded,Year High,Year Low";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

afterEach(async () => {
  const securities = await db.security.findMany({ where: { ticker: { in: TEST_TICKERS } }, select: { id: true } });
  await db.securityPrice.deleteMany({ where: { securityId: { in: securities.map((s) => s.id) } } });
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  const securities = await db.security.findMany({ where: { ticker: { in: TEST_TICKERS } }, select: { id: true, companyId: true } });
  await db.security.deleteMany({ where: { id: { in: securities.map((s) => s.id) } } });
  await db.company.deleteMany({ where: { id: { in: securities.map((s) => s.companyId) } } });
});

describe("importGseSecurityPrices — preview", () => {
  it("parses and validates without creating an IngestionRun or persisting anything", async () => {
    const buffer = csvBuffer(["2026-08-17,ZZTEST1,2.45,2.45,2.50,2.50,0.05,2.48,2.52,150000,375000,2.60,1.90"]);
    const result = await importGseSecurityPrices("preview.csv", buffer, "daily", { commit: false });

    expect(result.status).toBe("PREVIEW");
    expect(result.runId).toBeNull();
    expect(result.recordsAccepted).toBe(1);
    expect(result.tickers).toEqual(["ZZTEST1"]);

    const security = await db.security.findUnique({ where: { ticker: "ZZTEST1" } });
    expect(security).toBeNull(); // preview must not touch the database at all
  });

  it("reports an unparseable file as a graceful PREVIEW error, not a thrown exception", async () => {
    const result = await importGseSecurityPrices("prices.pdf", Buffer.from("whatever"), "daily", { commit: false });
    expect(result.status).toBe("PREVIEW");
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("importGseSecurityPrices — commit", () => {
  it("persists a valid row with full provenance through IngestionRun -> DataSource", async () => {
    const buffer = csvBuffer(["2026-08-17,ZZTEST1,2.45,2.45,2.50,2.50,0.05,2.48,2.52,150000,375000,2.60,1.90"]);
    const result = await trackedImport("daily-shares.csv", buffer, "daily", { commit: true });

    expect(result.status).toBe("SUCCESS");
    expect(result.persisted).toBe(1);

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST1" }, include: { company: true } });
    const stored = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-17T00:00:00.000Z") } },
      include: { ingestionRun: { include: { dataSource: true } } },
    });
    expect(Number(stored.closeVwap)).toBe(2.5);
    expect(stored.ingestionRunId).toBe(result.runId);
    expect(stored.ingestionRun.dataSource.name).toBe("Ghana Stock Exchange — Daily Shares & ETFs");
    expect(stored.ingestionRun.dataSource.ingestionMethod).toBe("FILE_IMPORT");
    expect(stored.ingestionRun.artifactName).toBe("daily-shares.csv");
  });

  it("auto-creates the Company from the known-ticker reference map when company_name isn't supplied", async () => {
    // ZZTEST1 isn't in the known-name map, so it should fall back to the ticker itself — never a fabricated name.
    const buffer = csvBuffer(["2026-08-17,ZZTEST1,,,,2.50,,,,,,,"]);
    await trackedImport("daily-shares.csv", buffer, "daily", { commit: true });

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST1" }, include: { company: true } });
    expect(security.company.name).toBe("ZZTEST1");
    expect(security.securityType).toBe("ORDINARY_SHARE");
  });

  it("distinguishes a blank volume (missing) from an explicit 0 (real no-trade day) end to end", async () => {
    const buffer = csvBuffer([
      "2026-08-17,ZZTEST1,,,,2.50,,,,0,0,,",
      "2026-08-18,ZZTEST1,,,,2.50,,,,,,,",
    ]);
    await trackedImport("daily-shares.csv", buffer, "daily", { commit: true });

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST1" } });
    const day1 = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-17T00:00:00.000Z") } },
    });
    const day2 = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-18T00:00:00.000Z") } },
    });
    expect(day1.volume).toBe(BigInt(0));
    expect(day2.volume).toBeNull();
  });

  it("is idempotent across a repeated identical import", async () => {
    const buffer = csvBuffer(["2026-08-17,ZZTEST1,,,,2.50,,,,,,,"]);
    await trackedImport("daily-shares.csv", buffer, "daily", { commit: true });
    await trackedImport("daily-shares.csv", buffer, "daily", { commit: true });

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST1" } });
    const count = await db.securityPrice.count({ where: { securityId: security.id } });
    expect(count).toBe(1);
  });

  it("upserts a corrected value for the same trading date and moves provenance to the correcting run", async () => {
    const buffer1 = csvBuffer(["2026-08-17,ZZTEST1,,,,2.50,,,,,,,"]);
    const run1 = await trackedImport("daily-shares.csv", buffer1, "daily", { commit: true });

    const buffer2 = csvBuffer(["2026-08-17,ZZTEST1,,,,2.55,,,,,,,"]);
    const run2 = await trackedImport("daily-shares-corrected.csv", buffer2, "daily", { commit: true });

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST1" } });
    const stored = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-17T00:00:00.000Z") } },
    });
    expect(stored.closeVwap.toString()).toBe("2.55");
    expect(stored.ingestionRunId).toBe(run2.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
  });

  it("produces a FAILED IngestionRun (not a silent exception) when the file can't be parsed at commit time", async () => {
    const result = await trackedImport("prices.pdf", Buffer.from("not a real file"), "daily", { commit: true });
    expect(result.status).toBe("FAILED");
    expect(result.runId).not.toBeNull();
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId! } });
    expect(run.status).toBe("FAILED");
    expect(run.completedAt).not.toBeNull();
    expect(run.errorMessage).toBeTruthy();
  });

  it("rejects a row with a malformed price without persisting it", async () => {
    const buffer = csvBuffer(["2026-08-17,ZZTEST3,,,,not-a-price,,,,,,,"]);
    const result = await trackedImport("daily-shares.csv", buffer, "daily", { commit: true });
    expect(result.recordsRejected).toBe(1);
    expect(result.persisted).toBe(0);
    const security = await db.security.findUnique({ where: { ticker: "ZZTEST3" } });
    expect(security).toBeNull();
  });
});

describe("importGseSecurityPrices — source priority (Daily Shares & ETFs vs Market Report Backfill)", () => {
  it("lets a backfill import populate a date the daily source has never covered", async () => {
    const buffer = csvBuffer(["2026-01-15,ZZTEST2,,,,1.80,,,,,,,"]);
    const result = await trackedImport("monthly-report.csv", buffer, "backfill", { commit: true });
    expect(result.status).toBe("SUCCESS");

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST2" } });
    const stored = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-01-15T00:00:00.000Z") } },
    });
    expect(Number(stored.closeVwap)).toBe(1.8);
  });

  it("never lets a backfill import silently overwrite a daily-source value for a date it already owns — reports a conflict instead", async () => {
    const dailyBuffer = csvBuffer(["2026-08-17,ZZTEST2,,,,2.50,,,,,,,"]);
    const dailyResult = await trackedImport("daily-shares.csv", dailyBuffer, "daily", { commit: true });

    const backfillBuffer = csvBuffer(["2026-08-17,ZZTEST2,,,,2.60,,,,,,,"]);
    const backfillResult = await trackedImport("monthly-report.csv", backfillBuffer, "backfill", { commit: true });

    expect(backfillResult.conflicts).toHaveLength(1);
    expect(backfillResult.conflicts[0].ticker).toBe("ZZTEST2");
    expect(backfillResult.conflicts[0].tradingDate).toBe("2026-08-17");
    expect(Number(backfillResult.conflicts[0].incomingCloseVwap)).toBe(2.6);
    expect(Number(backfillResult.conflicts[0].existingCloseVwap)).toBe(2.5);

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST2" } });
    const stored = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-17T00:00:00.000Z") } },
    });
    expect(Number(stored.closeVwap)).toBe(2.5);
    expect(stored.ingestionRunId).toBe(dailyResult.runId);
  });

  it("is idempotent when a backfill import agrees with the existing daily-source value", async () => {
    const dailyBuffer = csvBuffer(["2026-08-17,ZZTEST2,,,,2.50,,,,,,,"]);
    const dailyResult = await trackedImport("daily-shares.csv", dailyBuffer, "daily", { commit: true });

    const backfillBuffer = csvBuffer(["2026-08-17,ZZTEST2,,,,2.50,,,,,,,"]);
    const backfillResult = await trackedImport("monthly-report.csv", backfillBuffer, "backfill", { commit: true });

    expect(backfillResult.conflicts).toHaveLength(0);
    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST2" } });
    const stored = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-17T00:00:00.000Z") } },
    });
    expect(stored.ingestionRunId).toBe(dailyResult.runId); // provenance untouched — backfill deferred
  });

  it("lets a later daily import overwrite an earlier backfill value for the same date (daily always outranks backfill)", async () => {
    const backfillBuffer = csvBuffer(["2026-08-17,ZZTEST2,,,,2.60,,,,,,,"]);
    await trackedImport("monthly-report.csv", backfillBuffer, "backfill", { commit: true });

    const dailyBuffer = csvBuffer(["2026-08-17,ZZTEST2,,,,2.50,,,,,,,"]);
    const dailyResult = await trackedImport("daily-shares.csv", dailyBuffer, "daily", { commit: true });

    const security = await db.security.findUniqueOrThrow({ where: { ticker: "ZZTEST2" } });
    const stored = await db.securityPrice.findUniqueOrThrow({
      where: { securityId_tradingDate: { securityId: security.id, tradingDate: new Date("2026-08-17T00:00:00.000Z") } },
    });
    expect(Number(stored.closeVwap)).toBe(2.5);
    expect(stored.ingestionRunId).toBe(dailyResult.runId);
  });
});
