// ---------------------------------------------------------------------------
// Integration tests for the Companies/Company Explorer query layer (M7).
// Real database. Synthetic ticker (ZZQRY1) isolates cleanup. Exercises the
// market+financial join, annual-vs-interim separation, and missing-data
// handling explicitly required by M7 §41.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../prisma";
import { importCompanyFinancials } from "../../ingestion/financials-provider";
import { getAnnualFinancials, getLatestInterim, getLatestAnnualMetricValue, getCompanyRatios, getCompanyByTicker, getCompanyHighlights } from "../companies";

const db = getPrisma();
const TICKER = "ZZQRY1";
const BANK_TICKER = "ZZQRY2";
const LOSS_TO_PROFIT_TICKER = "ZZQRY3";
const createdRunIds: string[] = [];

function csvBuffer(rows: string[]): Buffer {
  const header = "Ticker,Period,Fiscal Year,Period Start,Period End,Metric,Value,Currency,Unit,Audited,Statement Scope";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

async function seed() {
  const rows = [
    `${TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Revenue,900,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Profit after tax,150,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Total equity,4000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Total assets,9000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Revenue,1000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Profit after tax,200,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Total equity,4500,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Total assets,9800,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,EPS,0.5,GHS,PER_SHARE_GHS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Dividend per share,0.1,GHS,PER_SHARE_GHS,TRUE,CONSOLIDATED`,
    `${TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Shares outstanding,400,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${TICKER},H1,2025,2025-01-01,2025-06-30,Revenue,480,GHS,GHS_MILLIONS,FALSE,CONSOLIDATED`,
    `${TICKER},H1,2026,2026-01-01,2026-06-30,Revenue,540,GHS,GHS_MILLIONS,FALSE,CONSOLIDATED`,
  ];
  const result = await importCompanyFinancials("query-fixture.csv", csvBuffer(rows), { commit: true });
  if (result.runId) createdRunIds.push(result.runId);
  return result;
}

async function seedBank() {
  // OPERATING_INCOME (bank profile), not REVENUE — must never enter the
  // Revenue Growth ranking, only PAT growth / ROE (M8 §35-36).
  const rows = [
    `${BANK_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Operating income,500,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${BANK_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Profit after tax,100,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${BANK_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Total equity,2000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${BANK_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Operating income,650,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${BANK_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Profit after tax,150,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${BANK_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Total equity,2400,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
  ];
  const result = await importCompanyFinancials("query-fixture-bank.csv", csvBuffer(rows), { commit: true });
  if (result.runId) createdRunIds.push(result.runId);
}

async function seedLossToProfit() {
  // A loss year turning into a profit has no honest "% growth" — must be
  // excluded from PAT growth ranking (M8 §35: positive-base guard).
  const rows = [
    `${LOSS_TO_PROFIT_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Revenue,300,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${LOSS_TO_PROFIT_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Profit after tax,-50,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${LOSS_TO_PROFIT_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Revenue,320,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    `${LOSS_TO_PROFIT_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Profit after tax,10,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
  ];
  const result = await importCompanyFinancials("query-fixture-loss.csv", csvBuffer(rows), { commit: true });
  if (result.runId) createdRunIds.push(result.runId);
}

async function cleanupTicker(ticker: string) {
  const company = await db.company.findUnique({ where: { ticker } });
  if (!company) return;
  const periods = await db.financialPeriod.findMany({ where: { companyId: company.id }, select: { id: true } });
  await db.companyFinancialObservation.deleteMany({ where: { financialPeriodId: { in: periods.map((p) => p.id) } } });
  await db.financialPeriod.deleteMany({ where: { companyId: company.id } });
  await db.company.deleteMany({ where: { id: company.id } });
}

afterAll(async () => {
  await cleanupTicker(TICKER);
  await cleanupTicker(BANK_TICKER);
  await cleanupTicker(LOSS_TO_PROFIT_TICKER);
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("getCompanyByTicker", () => {
  it("resolves the company auto-created by the financials import", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    expect(company).not.toBeNull();
    expect(company!.ticker).toBe(TICKER);
  });

  it("returns null for a ticker that has never been imported", async () => {
    expect(await getCompanyByTicker("ZZNOTHING")).toBeNull();
  });
});

describe("getAnnualFinancials — annual history never mixes in interim rows", () => {
  it("returns exactly the two ANNUAL fiscal years, excluding the HALF_YEAR rows", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    const annual = await getAnnualFinancials(company!.id, ["REVENUE", "PROFIT_AFTER_TAX"]);

    expect(annual.periods.map((p) => p.fiscalYear)).toEqual([2024, 2025]);
    expect(annual.seriesByMetric.REVENUE).toEqual([
      { fiscalYear: 2024, value: 900_000_000, statementScope: "CONSOLIDATED", audited: true },
      { fiscalYear: 2025, value: 1_000_000_000, statementScope: "CONSOLIDATED", audited: true },
    ]);
  });

  it("returns an empty series (not an error) for a metric this company never reported", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    const annual = await getAnnualFinancials(company!.id, ["NET_INTEREST_INCOME"]);
    expect(annual.seriesByMetric.NET_INTEREST_INCOME).toEqual([]);
  });
});

describe("getLatestInterim — H1 2026 vs its H1 2025 comparable, never vs FY2025", () => {
  it("pairs the latest interim with the same-period prior year, not the latest annual", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    const interim = await getLatestInterim(company!.id, ["REVENUE"]);

    expect(interim).not.toBeNull();
    expect(interim!.latest.fiscalYear).toBe(2026);
    expect(interim!.latest.period).toBe("H1");
    expect(interim!.priorComparable?.fiscalYear).toBe(2025);
    expect(interim!.priorComparable?.period).toBe("H1");
    expect(interim!.latestValues.REVENUE).toBe(540_000_000);
    expect(interim!.priorValues.REVENUE).toBe(480_000_000);
  });
});

describe("getLatestAnnualMetricValue — never falls back to an interim period", () => {
  it("returns the latest ANNUAL revenue (2025), not the more recent H1 2026 interim revenue", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    const revenue = await getLatestAnnualMetricValue(company!.id, "REVENUE");
    expect(revenue!.value).toBe(1_000_000_000);
    expect(revenue!.period.period).toBe("ANNUAL");
    expect(revenue!.period.fiscalYear).toBe(2025);
  });

  it("returns null for a metric with no data at all, rather than throwing", async () => {
    const company = await getCompanyByTicker(TICKER);
    const result = await getLatestAnnualMetricValue(company!.id, "CUSTOMER_DEPOSITS");
    expect(result).toBeNull();
  });
});

describe("getCompanyRatios — market + financial join, missing-data handling", () => {
  it("computes ROE/ROA using both 2024 and 2025 annual equity/assets, and P/E/P/B/yield when a market price is supplied", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    const ratios = await getCompanyRatios(company!.id, 10, "2026-08-20");

    expect(ratios.roe!.value).toBeCloseTo((200_000_000 / ((4_000_000_000 + 4_500_000_000) / 2)) * 100, 5);
    expect(ratios.roa!.value).toBeCloseTo((200_000_000 / ((9_000_000_000 + 9_800_000_000) / 2)) * 100, 5);
    expect(ratios.pe!.value).toBeCloseTo(10 / 0.5, 5);
    expect(ratios.pb!.value).toBeCloseTo(10 / (4_500_000_000 / 400_000_000), 5);
    expect(ratios.dividendYield!.value).toBeCloseTo((0.1 / 10) * 100, 5);
  });

  it("returns null ratios (not zeros or errors) when there is no market price at all", async () => {
    await seed();
    const company = await getCompanyByTicker(TICKER);
    const ratios = await getCompanyRatios(company!.id, null, null);
    expect(ratios.pe).toBeNull();
    expect(ratios.pb).toBeNull();
    expect(ratios.dividendYield).toBeNull();
    expect(ratios.roe).not.toBeNull(); // ROE/ROA don't depend on market price
  });

  it("returns null ratios for a company with no financial data at all", async () => {
    const empty = await db.company.create({ data: { name: "Empty Co", ticker: "ZZEMPTYQ" } });
    try {
      const ratios = await getCompanyRatios(empty.id, 10, "2026-08-20");
      expect(ratios.roe).toBeNull();
      expect(ratios.roa).toBeNull();
      expect(ratios.pe).toBeNull();
      expect(ratios.pb).toBeNull();
      expect(ratios.dividendYield).toBeNull();
    } finally {
      await db.company.delete({ where: { id: empty.id } });
    }
  });
});

describe("getCompanyHighlights — cross-company leaders, only where genuinely comparable", () => {
  const EXTREME_TICKER = "ZZQRY4";

  afterAll(async () => {
    await cleanupTicker(EXTREME_TICKER);
  });

  it("never ranks a bank's OPERATING_INCOME growth in Revenue Growth (no REVENUE metric at all)", async () => {
    await seedBank();
    const highlights = await getCompanyHighlights();
    expect(highlights.highestRevenueGrowth?.ticker).not.toBe(BANK_TICKER);
  });

  it("never ranks a loss-to-profit transition in PAT Growth (no honest positive-base percentage)", async () => {
    await seedLossToProfit();
    const highlights = await getCompanyHighlights();
    expect(highlights.strongestPatGrowth?.ticker).not.toBe(LOSS_TO_PROFIT_TICKER);
  });

  it("surfaces the company with unambiguously the largest revenue/PAT growth as the leader", async () => {
    const rows = [
      `${EXTREME_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Revenue,100,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
      `${EXTREME_TICKER},ANNUAL,2024,2024-01-01,2024-12-31,Profit after tax,10,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
      `${EXTREME_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Revenue,100000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
      `${EXTREME_TICKER},ANNUAL,2025,2025-01-01,2025-12-31,Profit after tax,10000,GHS,GHS_MILLIONS,TRUE,CONSOLIDATED`,
    ];
    const result = await importCompanyFinancials("query-fixture-extreme.csv", csvBuffer(rows), { commit: true });
    if (result.runId) createdRunIds.push(result.runId);

    const highlights = await getCompanyHighlights();
    expect(highlights.highestRevenueGrowth?.ticker).toBe(EXTREME_TICKER);
    expect(highlights.strongestPatGrowth?.ticker).toBe(EXTREME_TICKER);
  });
});
