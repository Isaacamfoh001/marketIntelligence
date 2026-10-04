// ---------------------------------------------------------------------------
// Integration tests for M7.3.1 Fixed Income data quality — real database.
// Seeds synthetic securities through the real import provider, then feeds
// synthetic GFIM-structured workbooks through importGfimTradingReportFromBuffer
// (the production path) to exercise:
//   - TRADED vs NOT_TRADED classification and carried-price de-duplication;
//   - in-place correction of an existing row for the same date;
//   - terms-conflict and post-maturity reporting at ingestion;
//   - analytics eligibility in the workspace: questionable observations stay
//     visible with provenance but never reach the curve, benchmark or spread.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getPrisma } from "../prisma";
import { importFixedIncomeSecurities } from "../ingestion/fixed-income-securities-provider";
import { importGfimTradingReportFromBuffer } from "../ingestion/gfim-trading-report-provider";
import { getFixedIncomeWorkspace, getFixedIncomeObservationRecords, attachBenchmarks } from "../queries/fixed-income";

const db = getPrisma();
const createdRunIds: string[] = [];
const CORP = "ZZDQCORP0001"; // corporate that trades once, then is only carried
const GOV_OK = "ZZDQGOVT0001"; // sovereign with a clean trade
const GOV_BAD = "ZZDQGOVT0002"; // sovereign whose quoted yield contradicts its price
const MATURED = "ZZDQCORP0002"; // corporate whose source maturity disagrees and is past master maturity
const ISINS = [CORP, GOV_OK, GOV_BAD, MATURED];
const ISSUER = "ZZDQ Test Issuer PLC";
const GOV_ISSUER = "ZZDQ Government";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function securitiesCsv(): Buffer {
  const header = "Instrument Code,Instrument Name,Issuer Name,Ticker,Instrument Type,Currency,Issue Date,Maturity Date,Coupon Type,Coupon Rate,Coupon Frequency,Face Value,Status,ISIN";
  return Buffer.from(
    [
      header,
      `${CORP},ZZDQ Corp Bond,${ISSUER},,CORPORATE_BOND,GHS,2025-03-01,2028-03-01,FIXED,24,SEMI_ANNUAL,100,ACTIVE,${CORP}`,
      `${GOV_OK},ZZDQ Gov Bond OK,${GOV_ISSUER},,GOVERNMENT_BOND,GHS,2024-03-01,2028-03-01,FIXED,20,SEMI_ANNUAL,100,ACTIVE,${GOV_OK}`,
      `${GOV_BAD},ZZDQ Gov Bond Contradictory,${GOV_ISSUER},,GOVERNMENT_BOND,GHS,2024-03-01,2028-04-01,FIXED,20,SEMI_ANNUAL,100,ACTIVE,${GOV_BAD}`,
      `${MATURED},ZZDQ Corp Bond Matured,${ISSUER},,CORPORATE_BOND,GHS,2023-01-10,2026-01-10,FIXED,22,SEMI_ANNUAL,100,ACTIVE,${MATURED}`,
    ].join("\n"),
    "utf-8",
  );
}

type CorpRow = [string, string, number | null, number | null, number | null, Date];
type GovRow = [string, string, number | null, number | null, number | null, number | null, Date];

/** A GFIM-structured workbook. Corp rows: [desc, isin, closingPrice, volume, numberTraded, maturity]. Gov rows: [desc, isin, yield, price, volume, numberTraded, maturity]. */
async function workbook(dateText: string, corp: CorpRow[], gov: GovRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const c = wb.addWorksheet("CORPORATE   ");
  c.addRow([]);
  c.addRow(["GHANA FIXED INCOME MARKET"]);
  c.addRow([dateText]);
  c.addRow(["ISSUERS", "NO. ", "SECURITY DESCRIPTION", "ISIN", "OPENING PRICE", "CLOSING PRICE", "VOLUME TRADED", "NUMBER \nTRADED", "DAY LOW PRICE", "DAY HIGH\nPRICE", "DAYS TO MATURITY", "MATURITY\nDATE", "APPLICABLE\nDATE"]);
  corp.forEach(([desc, isin, px, vol, n, mat], i) => c.addRow([null, i + 1, desc, isin, px, px, vol, n, px, px, 100, mat]));
  const g = wb.addWorksheet("OLD GOG NOTES AND BONDS");
  g.addRow([]);
  g.addRow(["GHANA FIXED INCOME MARKET"]);
  g.addRow([dateText]);
  g.addRow(["NO.", "TENOR", "SECURITY DESCRIPTION", "ISIN", "OPENING\nYIELD", "CLOSING\n YIELD", "END OF DAY CLOSING\n PRICE", "VOLUME", "NUMBER \nTRADED", "DAY LOW YIELD ", "DAY HIGH\n YIELD", "DAYS TO \nMATURITY", "MATURITY\nDATE", "APPLICABLE\nDATE"]);
  gov.forEach(([desc, isin, y, px, vol, n, mat], i) => g.addRow([i + 1, null, desc, isin, y, y, px, vol, n, y, y, 100, mat]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function ingest(date: string, buf: Buffer) {
  const r = await importGfimTradingReportFromBuffer(`zzdq-${date}.xlsx`, buf, d(date), { commit: true });
  if (r.runId) createdRunIds.push(r.runId);
  return r;
}

const CORP_DESC = "ZZD-BD-01/03/28-C0001-24.00";
const GOV_OK_DESC = "GOG-BD-01/03/28-A0001-0001-20.00";
const GOV_BAD_DESC = "GOG-BD-01/04/28-A0002-0002-20.00";

beforeAll(async () => {
  const s = await importFixedIncomeSecurities("zzdq-seed.csv", securitiesCsv(), { commit: true });
  if (s.runId) createdRunIds.push(s.runId);

  // Day 1: corporate and good sovereign TRADE; contradictory sovereign trades at a price that cannot produce its quoted yield.
  await ingest(
    "2026-09-01",
    await workbook(
      "Date: Tuesday, 01 September, 2026",
      [[CORP_DESC, CORP, 99.5, 100000, 1, d("2028-03-01")]],
      [
        [GOV_OK_DESC, GOV_OK, null, 99.0, 50000, 1, d("2028-03-01")],
        [GOV_BAD_DESC, GOV_BAD, 45.0, 99.0, 50000, 1, d("2028-04-01")],
      ],
    ),
  );
});

afterAll(async () => {
  const securities = await db.fixedIncomeSecurity.findMany({ where: { isin: { in: ISINS } } });
  await db.fixedIncomeObservation.deleteMany({ where: { securityId: { in: securities.map((s) => s.id) } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { isin: { in: ISINS } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.company.deleteMany({ where: { name: { in: [ISSUER, GOV_ISSUER] } } });
});

async function observations(isin: string) {
  const sec = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { isin } });
  return db.fixedIncomeObservation.findMany({ where: { securityId: sec.id }, orderBy: { observationDate: "asc" } });
}

describe("GFIM ingestion — trade status (M7.3.1)", () => {
  it("records a real trade as TRADED with its trade count and the source's own terms", async () => {
    const [o] = await observations(CORP);
    expect(o.tradeStatus).toBe("TRADED");
    expect(o.numberOfTrades).toBe(1);
    expect(o.sourceSecurityDescription).toBe(CORP_DESC);
    expect(o.sourceMaturityDate?.toISOString().slice(0, 10)).toBe("2028-03-01");
  });

  it("does not store a carried price that merely repeats the last trade, but stores a changed one as NOT_TRADED", async () => {
    const r = await ingest("2026-09-02", await workbook("Date: Wednesday, 02 September, 2026", [[CORP_DESC, CORP, 99.5, null, null, d("2028-03-01")]], []));
    expect(r.notTradedCount).toBe(1);
    expect(r.carriedSkipped).toBe(1);
    expect(await observations(CORP)).toHaveLength(1);

    const r2 = await ingest("2026-09-03", await workbook("Date: Thursday, 03 September, 2026", [[CORP_DESC, CORP, 98.0, null, null, d("2028-03-01")]], []));
    expect(r2.inserted).toBe(1);
    const rows = await observations(CORP);
    expect(rows.map((o) => o.tradeStatus)).toEqual(["TRADED", "NOT_TRADED"]);
  });

  it("corrects an existing row for the same date in place when the source shows it did not trade", async () => {
    const r = await ingest("2026-09-01", await workbook("Date: Tuesday, 01 September, 2026", [[CORP_DESC, CORP, 99.5, null, null, d("2028-03-01")]], []));
    expect(r.updated).toBe(1);
    const first = (await observations(CORP))[0];
    expect(first.tradeStatus).toBe("NOT_TRADED");
    // restore the trade for the remaining tests
    await ingest("2026-09-01", await workbook("Date: Tuesday, 01 September, 2026", [[CORP_DESC, CORP, 99.5, 100000, 1, d("2028-03-01")]], []));
  });

  it("reports source-vs-master maturity conflicts and post-maturity rows at ingestion", async () => {
    const r = await ingest("2026-09-04", await workbook("Date: Friday, 04 September, 2026", [["ZZD-BD-10/01/27-C0002-22.00", MATURED, 100.1, 5000, 1, d("2027-01-10")]], []));
    expect(r.termsConflicts).toEqual([{ isin: MATURED, masterMaturityDate: "2026-01-10", sourceMaturityDate: "2027-01-10", sourceSecurityDescription: "ZZD-BD-10/01/27-C0002-22.00" }]);
    expect(r.postMaturity).toEqual([{ isin: MATURED, maturityDate: "2026-01-10", tradeStatus: "TRADED" }]);
    expect(await observations(MATURED)).toHaveLength(1); // kept for provenance, never deleted
  });
});

describe("workspace analytics eligibility (M7.3.1)", () => {
  const VALUATION = d("2026-09-10");

  it("uses the latest TRADED observation as the market observation, never a carried price", async () => {
    const w = await getFixedIncomeWorkspace(VALUATION);
    const corp = w.securities.find((s) => s.isin === CORP)!;
    expect(corp.latestObservationDate).toBe("2026-09-01");
    expect(corp.carriedPrice).toEqual({ cleanPrice: 98, sourceYieldPct: null, asOf: "2026-09-03" });
    expect(corp.analyticsEligible).toBe(true);
  });

  it("keeps a contradictory sovereign observation visible but out of the curve, benchmark pool and spreads", async () => {
    const w = await getFixedIncomeWorkspace(VALUATION);
    const bad = w.securities.find((s) => s.isin === GOV_BAD)!;
    expect(bad.analytics.quality?.status).toBe("REVIEW");
    expect(bad.analytics.quality?.issues.map((i) => i.code)).toContain("YIELD_MISMATCH");
    expect(bad.analyticsEligible).toBe(false);
    expect(w.curve.some((p) => p.instrumentCode === GOV_BAD)).toBe(false);
    expect(w.excludedCurvePoints.find((e) => e.instrumentCode === GOV_BAD)?.reason).toContain("Yield mismatch");

    // The corporate's date-matched benchmark can only be the valid sovereign (same tenor as GOV_BAD would otherwise tie).
    const corp = w.securities.find((s) => s.isin === CORP)!;
    expect(corp.benchmark?.benchmark.instrumentCode).not.toBe(bad.instrumentCode);
    expect(corp.spreadBps).not.toBeNull();

    // Excluded rows are never offered as alternatives.
    expect(w.comparables.find((c) => c.instrumentCode === bad.instrumentCode)?.analyticsEligible).toBe(false);
  });

  it("a valid secondary sovereign observation is drawn on the curve", async () => {
    const w = await getFixedIncomeWorkspace(VALUATION);
    const ok = w.securities.find((s) => s.isin === GOV_OK)!;
    expect(ok.analyticsEligible).toBe(true);
    expect(w.curve.some((p) => p.instrumentCode === ok.instrumentCode)).toBe(true);
  });

  it("gives no benchmark and no spread when no eligible sovereign observation is within the date window", async () => {
    const w = await getFixedIncomeWorkspace(VALUATION);
    const corp = w.securities.find((s) => s.isin === CORP)!;
    const farAway = { tenorDays: 900, tenorLabel: "2Y", yieldPct: 20, instrumentLabel: "Old GoG print", instrumentCode: "X", isGovernmentBond: true, observationDate: "2025-01-15", observationKind: "SECONDARY_MARKET" as const };
    for (const pool of [[], [farAway]]) {
      const attached = attachBenchmarks(corp, pool, "2026-09-10");
      expect(attached.benchmark).toBeNull();
      expect(attached.spreadBps).toBeNull(); // "Suitable benchmark unavailable" — never a misleading spread
    }
  });

  it("matured security: excluded from analytics, with full provenance still retrievable", async () => {
    const w = await getFixedIncomeWorkspace(VALUATION);
    const m = w.securities.find((s) => s.isin === MATURED)!;
    expect(m.lifecycle).toBe("MATURED");
    expect(m.observationAfterMaturity).toBe(true);
    expect(m.benchmark).toBeNull();
    const records = await getFixedIncomeObservationRecords(m.id);
    expect(records).toHaveLength(1);
    expect(records[0].sourceName).toBe("Ghana Fixed Income Market — Daily Trading Reports");
    expect(records[0].sourceSecurityDescription).toBe("ZZD-BD-10/01/27-C0002-22.00");
  });
});
