// ---------------------------------------------------------------------------
// Integration tests for the Company Financials import pipeline (M7, revised
// M7.1 for the single-`period` fiscal model).
//
// Real database. Synthetic ticker (ZZFIN1) can never collide with a real
// GSE share code — same isolation pattern as gse-security-ingestion.
// integration.test.ts. Every IngestionRun created is tracked and deleted
// in afterAll.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { importCompanyFinancials } from "../ingestion/financials-provider";

const db = getPrisma();
const TEST_TICKERS = ["ZZFIN1", "ZZFIN2"];
const createdRunIds: string[] = [];

async function trackedImport(...args: Parameters<typeof importCompanyFinancials>) {
  const result = await importCompanyFinancials(...args);
  if (result.runId) createdRunIds.push(result.runId);
  return result;
}

function csvBuffer(rows: string[]): Buffer {
  const header = "Ticker,Period,Fiscal Year,Period Start,Period End,Metric,Value,Currency,Unit,Audited,Statement Scope";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

afterEach(async () => {
  const company = await db.company.findUnique({ where: { ticker: "ZZFIN1" } });
  if (company) {
    const periods = await db.financialPeriod.findMany({ where: { companyId: company.id }, select: { id: true } });
    await db.companyFinancialObservation.deleteMany({ where: { financialPeriodId: { in: periods.map((p) => p.id) } } });
    await db.financialPeriod.deleteMany({ where: { companyId: company.id } });
  }
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.company.deleteMany({ where: { ticker: { in: TEST_TICKERS } } });
});

describe("importCompanyFinancials — preview", () => {
  it("validates without creating a run or persisting anything", async () => {
    const buffer = csvBuffer(["ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Profit after tax,3200,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED"]);
    const result = await importCompanyFinancials("financials.csv", buffer, { commit: false });

    expect(result.status).toBe("PREVIEW");
    expect(result.runId).toBeNull();
    expect(result.recordsAccepted).toBe(1);

    const company = await db.company.findUnique({ where: { ticker: "ZZFIN1" } });
    expect(company).toBeNull();
  });
});

describe("importCompanyFinancials — commit", () => {
  it("persists a valid ANNUAL row with correct unit normalization and full provenance", async () => {
    // 3,200 reported in GHS millions -> normalized to 3,200,000,000 GHS.
    const buffer = csvBuffer(["ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Profit after tax,3200,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED"]);
    const result = await trackedImport("mtn-fy2025.csv", buffer, { commit: true });

    expect(result.status).toBe("SUCCESS");
    expect(result.inserted).toBe(1);

    const company = await db.company.findUniqueOrThrow({ where: { ticker: "ZZFIN1" } });
    const period = await db.financialPeriod.findFirstOrThrow({ where: { companyId: company.id, period: "ANNUAL", fiscalYear: 2025 } });
    expect(period.audited).toBe(true);
    expect(period.statementScope).toBe("CONSOLIDATED");

    const metric = await db.financialMetric.findUniqueOrThrow({ where: { code: "PROFIT_AFTER_TAX" } });
    const obs = await db.companyFinancialObservation.findUniqueOrThrow({
      where: { financialPeriodId_metricId: { financialPeriodId: period.id, metricId: metric.id } },
      include: { ingestionRun: { include: { dataSource: true } } },
    });
    expect(Number(obs.value)).toBe(3_200_000_000);
    expect(Number(obs.reportedValue)).toBe(3200);
    expect(obs.reportedUnit).toBe("GHS_MILLIONS");
    expect(obs.ingestionRunId).toBe(result.runId);
    expect(obs.ingestionRun.dataSource.name).toBe("Ghana Stock Exchange — Listed Company Financial Statements");
  });

  it("auto-creates the Company from the known-ticker reference map when no GSE Security exists yet", async () => {
    const buffer = csvBuffer(["ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Revenue,1,GHS,GHS_MILLIONS,,"]);
    await trackedImport("financials.csv", buffer, { commit: true });
    const company = await db.company.findUniqueOrThrow({ where: { ticker: "ZZFIN1" } });
    expect(company.name).toBe("ZZFIN1"); // not in the known-name map -> falls back to the ticker itself
  });

  it("keeps ANNUAL FY2025, H1 2026, and 9M 2026 as distinct periods, never comparable as the same row", async () => {
    const buffer = csvBuffer([
      "ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Revenue,1000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED",
      "ZZFIN1,H1,2026,2026-01-01,2026-06-30,Revenue,550,GHS,GHS_MILLIONS,FALSE,CONSOLIDATED",
      "ZZFIN1,9M,2026,2026-01-01,2026-09-30,Revenue,850,GHS,GHS_MILLIONS,FALSE,CONSOLIDATED",
    ]);
    const result = await trackedImport("financials.csv", buffer, { commit: true });
    expect(result.inserted).toBe(3);

    const company = await db.company.findUniqueOrThrow({ where: { ticker: "ZZFIN1" } });
    const periods = await db.financialPeriod.findMany({ where: { companyId: company.id }, orderBy: { period: "asc" } });
    expect(periods).toHaveLength(3);
    const annual = periods.find((p) => p.period === "ANNUAL")!;
    const half = periods.find((p) => p.period === "H1")!;
    const nineMonth = periods.find((p) => p.period === "NINE_MONTH")!;
    expect(annual.audited).toBe(true);
    expect(half.audited).toBe(false);
    expect(nineMonth.audited).toBe(false);
  });

  it("is idempotent across a repeated identical import", async () => {
    const buffer = csvBuffer(["ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Revenue,1000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED"]);
    await trackedImport("financials.csv", buffer, { commit: true });
    const r2 = await trackedImport("financials.csv", buffer, { commit: true });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(1);
    expect(r2.restatements).toHaveLength(0); // same value -> not a restatement
  });

  it("detects and reports a restatement without silently hiding the change, and moves provenance to the correcting run", async () => {
    const original = csvBuffer(["ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Revenue,1000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED"]);
    const run1 = await trackedImport("financials-v1.csv", original, { commit: true });

    const restated = csvBuffer(["ZZFIN1,ANNUAL,2025,2025-01-01,2025-12-31,Revenue,1050,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED"]);
    const run2 = await trackedImport("financials-v2-restated.csv", restated, { commit: true });

    expect(run2.restatements).toHaveLength(1);
    expect(run2.restatements[0]).toMatchObject({ ticker: "ZZFIN1", metricCode: "REVENUE", previousValue: "1000000000", newValue: "1050000000" });

    const company = await db.company.findUniqueOrThrow({ where: { ticker: "ZZFIN1" } });
    const period = await db.financialPeriod.findFirstOrThrow({ where: { companyId: company.id, period: "ANNUAL", fiscalYear: 2025 } });
    const metric = await db.financialMetric.findUniqueOrThrow({ where: { code: "REVENUE" } });
    const obs = await db.companyFinancialObservation.findUniqueOrThrow({
      where: { financialPeriodId_metricId: { financialPeriodId: period.id, metricId: metric.id } },
    });
    expect(Number(obs.value)).toBe(1_050_000_000);
    expect(obs.ingestionRunId).toBe(run2.runId);
    expect(obs.ingestionRunId).not.toBe(run1.runId);
  });

  it("produces a FAILED IngestionRun (not a silent exception) when the file can't be parsed at commit time", async () => {
    const result = await trackedImport("statements.pdf", Buffer.from("not a real file"), { commit: true });
    expect(result.status).toBe("FAILED");
    expect(result.runId).not.toBeNull();
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId! } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toBeTruthy();
  });

  it("rejects a row with an unrecognised metric label without persisting it", async () => {
    const buffer = csvBuffer(["ZZFIN2,ANNUAL,2025,2025-01-01,2025-12-31,Some Unknown Line Item,100,GHS,GHS_MILLIONS,,"]);
    const result = await trackedImport("financials.csv", buffer, { commit: true });
    expect(result.recordsRejected).toBe(1);
    expect(result.inserted).toBe(0);
    const company = await db.company.findUnique({ where: { ticker: "ZZFIN2" } });
    expect(company).toBeNull();
  });
});
