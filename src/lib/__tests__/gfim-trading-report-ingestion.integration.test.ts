// ---------------------------------------------------------------------------
// Integration tests for GFIM Daily Trading Report ingestion (M7.2). Real
// database. Builds a synthetic in-memory XLSX workbook (same verified
// structure as the real report, synthetic figures) and seeds matching
// FixedIncomeSecurity rows with test ISINs so ISIN-based matching, the
// unmatched-ISIN path, and the AUCTION_PRIMARY conflict guard can all be
// exercised deterministically.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getPrisma } from "../prisma";
import { importFixedIncomeSecurities } from "../ingestion/fixed-income-securities-provider";
import { importGfimTradingReportFromBuffer } from "../ingestion/gfim-trading-report-provider";

const db = getPrisma();
const REPORT_DATE = new Date("2026-10-02T00:00:00.000Z");
const createdRunIds: string[] = [];
const TEST_ISINS = ["ZZGFIMTR0001", "ZZGFIMTR0002"];

function securitiesCsv(rows: string[]): Buffer {
  const header =
    "Instrument Code,Instrument Name,Issuer Name,Ticker,Instrument Type,Currency,Issue Date,Maturity Date,Coupon Type,Coupon Rate,Coupon Frequency,Face Value,Status,ISIN";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

async function buildWorkbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const corp = wb.addWorksheet("CORPORATE   ");
  corp.addRow([]);
  corp.addRow(["GHANA FIXED INCOME MARKET"]);
  corp.addRow(["Date: Friday, 02 October, 2026"]);
  corp.addRow([
    "ISSUERS",
    "NO. ",
    "SECURITY DESCRIPTION",
    "ISIN",
    "OPENING PRICE",
    "CLOSING PRICE",
    "VOLUME TRADED",
    "NUMBER \nTRADED",
    "DAY LOW PRICE",
    "DAY HIGH\nPRICE",
    "DAYS TO MATURITY",
    "MATURITY\nDATE",
    "APPLICABLE\nDATE",
  ]);
  corp.addRow(["ZZ TEST ISSUER PLC", 1, "ZZT-BD-01", TEST_ISINS[0], 95, 96.5, 750000, 3, 95, 96.5, 400, new Date("2027-11-06")]);
  corp.addRow([null, 2, "ZZT-BD-02", TEST_ISINS[1], null, null, null, null, null, null, 800, new Date("2028-12-11")]); // no trade
  corp.addRow([null, 3, "ZZT-BD-UNKNOWN", "ZZGFIMTRNOMAT9", 50, 51, 100, 1, 50, 51, 900, new Date("2029-03-01")]); // unmatched

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

beforeAll(async () => {
  const securities = await importFixedIncomeSecurities(
    "zz-gfim-tr-seed.csv",
    securitiesCsv([
      `ZZGFIMTR-SEC-1,ZZ Test Bond 1,ZZ Test Issuer PLC,,CORPORATE_BOND,GHS,2024-11-06,2027-11-06,FIXED,22,SEMI_ANNUAL,100,ACTIVE,${TEST_ISINS[0]}`,
      `ZZGFIMTR-SEC-2,ZZ Test Bond 2,ZZ Test Issuer PLC,,CORPORATE_BOND,GHS,2024-12-11,2028-12-11,FIXED,20,SEMI_ANNUAL,100,ACTIVE,${TEST_ISINS[1]}`,
    ]),
    { commit: true },
  );
  if (securities.runId) createdRunIds.push(securities.runId);
});

afterAll(async () => {
  const securities = await db.fixedIncomeSecurity.findMany({ where: { isin: { in: TEST_ISINS } } });
  const securityIds = securities.map((s) => s.id);
  await db.fixedIncomeObservation.deleteMany({ where: { securityId: { in: securityIds } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { isin: { in: TEST_ISINS } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.company.deleteMany({ where: { name: "ZZ Test Issuer PLC" } });
  await db.dataSource.deleteMany({ where: { name: "ZZ Test Auction Source" } });
});

describe("importGfimTradingReportFromBuffer — preview", () => {
  it("validates without creating a run or persisting anything", async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await importGfimTradingReportFromBuffer("zz-report.xlsx", buffer, REPORT_DATE, { commit: false });

    expect(result.status).toBe("PREVIEW");
    expect(result.runId).toBeNull();
    expect(result.recordsAccepted).toBe(2); // 2 traded rows (1 no-trade excluded)
    expect(result.noTradeCount).toBe(1);

    // Scoped to this test's own securities, not a global date count — the
    // real GFIM collector may have already persisted other securities'
    // real observations for this same calendar date elsewhere in the DB.
    const securities = await db.fixedIncomeSecurity.findMany({ where: { isin: { in: TEST_ISINS } } });
    const count = await db.fixedIncomeObservation.count({ where: { securityId: { in: securities.map((s) => s.id) }, observationDate: REPORT_DATE } });
    expect(count).toBe(0);
  });
});

describe("importGfimTradingReportFromBuffer — commit", () => {
  it("matches by ISIN, persists SECONDARY_MARKET observations, and reports the unmatched ISIN", async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await importGfimTradingReportFromBuffer("zz-report.xlsx", buffer, REPORT_DATE, { commit: true });
    createdRunIds.push(result.runId!);

    expect(result.status).toBe("SUCCESS");
    expect(result.inserted).toBe(1); // only ZZGFIMTR0001 actually traded and matched
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].isin).toBe("ZZGFIMTRNOMAT9");

    const security = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { isin: TEST_ISINS[0] } });
    const obs = await db.fixedIncomeObservation.findUniqueOrThrow({
      where: { securityId_observationDate: { securityId: security.id, observationDate: REPORT_DATE } },
      include: { source: true },
    });
    expect(obs.observationKind).toBe("SECONDARY_MARKET");
    expect(Number(obs.cleanPrice)).toBe(96.5);
    expect(Number(obs.volumeTradedGhs)).toBe(750000);
    expect(obs.source.provider).toBe("Ghana Fixed Income Market");
  });

  it("does not create an observation for a security with no trade that day", async () => {
    const security = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { isin: TEST_ISINS[1] } });
    const obs = await db.fixedIncomeObservation.findUnique({
      where: { securityId_observationDate: { securityId: security.id, observationDate: REPORT_DATE } },
    });
    expect(obs).toBeNull();
  });

  it("is idempotent across a re-run with the same report (upsert, no duplicate)", async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await importGfimTradingReportFromBuffer("zz-report-rerun.xlsx", buffer, REPORT_DATE, { commit: true });
    createdRunIds.push(result.runId!);

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);

    const security = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { isin: TEST_ISINS[0] } });
    const count = await db.fixedIncomeObservation.count({ where: { securityId: security.id } });
    expect(count).toBe(1);
  });

  it("never overwrites an existing AUCTION_PRIMARY observation for the same security/date", async () => {
    const security = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { isin: TEST_ISINS[1] } });
    const dataSource = await db.dataSource.upsert({
      where: { name: "ZZ Test Auction Source" },
      update: {},
      create: { name: "ZZ Test Auction Source", provider: "ZZ Test", sourceType: "AUTOMATED", ingestionMethod: "API" },
    });
    const run = await db.ingestionRun.create({ data: { dataSourceId: dataSource.id, status: "SUCCESS" } });
    createdRunIds.push(run.id);
    await db.fixedIncomeObservation.create({
      data: {
        securityId: security.id,
        observationDate: REPORT_DATE,
        sourceYieldPct: "20",
        observationKind: "AUCTION_PRIMARY",
        sourceId: dataSource.id,
        ingestionRunId: run.id,
      },
    });

    // This workbook has ZZGFIMTR0002 trading (unlike the earlier no-trade fixture).
    const wb = new ExcelJS.Workbook();
    const corp = wb.addWorksheet("CORPORATE   ");
    corp.addRow([]);
    corp.addRow(["GHANA FIXED INCOME MARKET"]);
    corp.addRow(["Date: Friday, 02 October, 2026"]);
    corp.addRow(["ISSUERS", "NO. ", "SECURITY DESCRIPTION", "ISIN", "OPENING PRICE", "CLOSING PRICE", "VOLUME TRADED", "NUMBER \nTRADED", "DAY LOW PRICE", "DAY HIGH\nPRICE", "DAYS TO MATURITY", "MATURITY\nDATE", "APPLICABLE\nDATE"]);
    corp.addRow([null, 1, "ZZT-BD-02", TEST_ISINS[1], 88, 89, 100, 1, 88, 89, 800, new Date("2028-12-11")]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await importGfimTradingReportFromBuffer("zz-conflict-report.xlsx", buffer, REPORT_DATE, { commit: true });
    createdRunIds.push(result.runId!);

    expect(result.auctionConflicts).toHaveLength(1);
    expect(result.auctionConflicts[0].isin).toBe(TEST_ISINS[1]);

    const obs = await db.fixedIncomeObservation.findUniqueOrThrow({
      where: { securityId_observationDate: { securityId: security.id, observationDate: REPORT_DATE } },
    });
    expect(obs.observationKind).toBe("AUCTION_PRIMARY"); // untouched
    expect(Number(obs.sourceYieldPct)).toBe(20);
    expect(obs.cleanPrice).toBeNull();

    await db.fixedIncomeObservation.deleteMany({ where: { securityId: security.id } });
  });
});
