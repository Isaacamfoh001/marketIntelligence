// ---------------------------------------------------------------------------
// Shared read queries for the Companies landing page and Company Explorer
// (M7) — the ONE place Prisma querying for company financials happens, so
// /companies and /companies/[ticker] never duplicate it (mirrors
// market-data.ts and queries/equities.ts).
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import type { FiscalPeriod, StatementScope } from "@/generated/prisma/enums";
import { computeReturn, type DatedValue } from "../returns";
import { computeROE, computeROA, computePE, computePB, computeDividendYield, type RatioResult } from "../financial-ratios";

import { formatPeriodLabel } from "../financial-period-label";
export { formatPeriodLabel } from "../financial-period-label";

const INTERIM_PERIODS: FiscalPeriod[] = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "NINE_MONTH"];

// ---------------------------------------------------------------------------
// Period resolution — annual history prefers CONSOLIDATED over SEPARATE
// per year (M7 §14), but never silently drops a year that only has
// SEPARATE: it's used, and the scope actually used is exposed to callers
// so the UI can flag it rather than pretend perfect comparability.
// ---------------------------------------------------------------------------

interface PeriodRow {
  id: string;
  period: FiscalPeriod;
  fiscalYear: number;
  startDate: Date;
  endDate: Date;
  statementScope: StatementScope;
  audited: boolean | null;
}

async function getAnnualPeriods(companyId: string): Promise<PeriodRow[]> {
  const prisma = getPrisma();
  const periods = await prisma.financialPeriod.findMany({
    where: { companyId, period: "ANNUAL" },
    orderBy: { fiscalYear: "asc" },
  });
  const byYear = new Map<number, PeriodRow>();
  for (const p of periods) {
    const existing = byYear.get(p.fiscalYear);
    if (!existing || (existing.statementScope === "SEPARATE" && p.statementScope === "CONSOLIDATED")) {
      byYear.set(p.fiscalYear, p);
    }
  }
  return Array.from(byYear.values()).sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/** Most recent interim (Q1-Q4/H1/H2/9M) period by end date, and its prior-year comparable (same `period`, fiscalYear - 1) if one exists — never FY vs interim (M7 §15/§30). */
async function getLatestInterimPeriod(companyId: string): Promise<{ latest: PeriodRow; priorComparable: PeriodRow | null } | null> {
  const prisma = getPrisma();
  const interims = await prisma.financialPeriod.findMany({
    where: { companyId, period: { in: INTERIM_PERIODS } },
    orderBy: { endDate: "desc" },
  });
  if (interims.length === 0) return null;
  const latest = interims[0];
  const priorComparable = interims.find((p) => p.period === latest.period && p.fiscalYear === latest.fiscalYear - 1) ?? null;
  return { latest, priorComparable };
}

// ---------------------------------------------------------------------------
// Metric value lookup
// ---------------------------------------------------------------------------

async function getObservationsForPeriods(periodIds: string[]): Promise<Map<string, Map<string, number>>> {
  const prisma = getPrisma();
  if (periodIds.length === 0) return new Map();
  const rows = await prisma.companyFinancialObservation.findMany({
    where: { financialPeriodId: { in: periodIds } },
    include: { metric: true },
  });
  const byPeriod = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const forPeriod = byPeriod.get(row.financialPeriodId) ?? new Map<string, number>();
    forPeriod.set(row.metric.code, Number(row.value));
    byPeriod.set(row.financialPeriodId, forPeriod);
  }
  return byPeriod;
}

export interface AnnualSeriesPoint {
  fiscalYear: number;
  value: number;
  statementScope: StatementScope;
  audited: boolean | null;
}

export interface CompanyFinancialsAnnual {
  periods: PeriodRow[];
  seriesByMetric: Record<string, AnnualSeriesPoint[]>;
}

/** Annual 2020-2025-style history for a fixed set of metric codes — never mixes in interim rows (M7 §29/§16). */
export async function getAnnualFinancials(companyId: string, metricCodes: string[]): Promise<CompanyFinancialsAnnual> {
  const periods = await getAnnualPeriods(companyId);
  const obsByPeriod = await getObservationsForPeriods(periods.map((p) => p.id));

  const seriesByMetric: Record<string, AnnualSeriesPoint[]> = {};
  for (const code of metricCodes) {
    seriesByMetric[code] = periods
      .map((p) => {
        const value = obsByPeriod.get(p.id)?.get(code);
        if (value === undefined) return null;
        return { fiscalYear: p.fiscalYear, value, statementScope: p.statementScope, audited: p.audited };
      })
      .filter((v): v is AnnualSeriesPoint => v !== null);
  }
  return { periods, seriesByMetric };
}

export interface InterimSnapshot {
  latest: PeriodRow;
  priorComparable: PeriodRow | null;
  latestValues: Record<string, number | undefined>;
  priorValues: Record<string, number | undefined>;
}

/** Latest interim (H1/Q-whatever) plus its prior-year comparable period, for the "Latest Results" section — never FY. */
export async function getLatestInterim(companyId: string, metricCodes: string[]): Promise<InterimSnapshot | null> {
  const found = await getLatestInterimPeriod(companyId);
  if (!found) return null;
  const { latest, priorComparable } = found;

  const periodIds = [latest.id, ...(priorComparable ? [priorComparable.id] : [])];
  const obsByPeriod = await getObservationsForPeriods(periodIds);
  const latestValues: Record<string, number | undefined> = {};
  const priorValues: Record<string, number | undefined> = {};
  for (const code of metricCodes) {
    latestValues[code] = obsByPeriod.get(latest.id)?.get(code);
    priorValues[code] = priorComparable ? obsByPeriod.get(priorComparable.id)?.get(code) : undefined;
  }
  return { latest, priorComparable, latestValues, priorValues };
}

/**
 * Latest ANNUAL value for a metric — deliberately never falls back to an
 * interim period. Every cross-sectional "latest" figure used for company
 * comparison or ratio inputs (Companies landing page, ratios bundle) goes
 * through this, not a broader latest-including-interim lookup, so a
 * ratio never silently mixes a full-year PAT with an interim equity
 * snapshot (M7 §15/§29/§30: never conflate annual and interim). The
 * Company Explorer's separate "Latest Interim" section is the only place
 * interim figures are shown, and always clearly labeled as such.
 */
export async function getLatestAnnualMetricValue(companyId: string, metricCode: string): Promise<{ value: number; period: PeriodRow } | null> {
  const periods = await getAnnualPeriods(companyId); // ascending by fiscalYear
  if (periods.length === 0) return null;
  const obsByPeriod = await getObservationsForPeriods(periods.map((p) => p.id));
  for (let i = periods.length - 1; i >= 0; i--) {
    const period = periods[i];
    const value = obsByPeriod.get(period.id)?.get(metricCode);
    if (value !== undefined) return { value, period };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Company resolution + landing-page snapshot
// ---------------------------------------------------------------------------

export interface CompanySummary {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
}

export async function getCompanyByTicker(ticker: string): Promise<CompanySummary | null> {
  const prisma = getPrisma();
  return prisma.company.findUnique({ where: { ticker }, select: { id: true, name: true, ticker: true, sector: true } });
}

export interface StatementProvenance {
  periodLabel: string;
  audited: boolean | null;
  statementScope: StatementScope;
  sourceName: string;
  artifactName: string | null;
  retrievedAt: Date;
}

/** Provenance for the company's single most-recently-ended ANNUAL period — "where did this number come from" (M7 §13/§36), keyed off whichever observation happens to carry it (they all share the same run for a given import, but this doesn't assume that — it just takes the most recent). */
export async function getLatestAnnualStatementProvenance(companyId: string): Promise<StatementProvenance | null> {
  const periods = await getAnnualPeriods(companyId);
  if (periods.length === 0) return null;
  const latest = periods[periods.length - 1];

  const prisma = getPrisma();
  const obs = await prisma.companyFinancialObservation.findFirst({
    where: { financialPeriodId: latest.id },
    orderBy: { retrievedAt: "desc" },
    include: { source: true, ingestionRun: true },
  });
  if (!obs) return null;

  return {
    periodLabel: formatPeriodLabel(latest),
    audited: latest.audited,
    statementScope: latest.statementScope,
    sourceName: obs.source.name,
    artifactName: obs.ingestionRun.artifactName,
    retrievedAt: obs.retrievedAt,
  };
}

export interface CompanyLandingRow {
  ticker: string;
  name: string;
  sector: string | null;
  latestPrice: number | null;
  latestPriceDate: string | null;
  ytdReturnPct: number | null;
  primaryRevenueMetric: "REVENUE" | "OPERATING_INCOME" | null;
  latestRevenue: number | null;
  latestRevenueYear: number | null;
  latestPat: number | null;
  latestEps: number | null;
}

/** One row per company that has EITHER a Security (M6) or any FinancialPeriod (M7) — a company isn't hidden just because only one side of the data has arrived yet. */
export async function getCompanyLandingRows(): Promise<CompanyLandingRow[]> {
  const prisma = getPrisma();
  const companies = await prisma.company.findMany({
    where: { ticker: { not: null }, active: true },
    include: { securities: { where: { active: true }, take: 1 } },
    orderBy: { ticker: "asc" },
  });

  return Promise.all(
    companies.map(async (company) => {
      const security = company.securities[0];
      let latestPrice: number | null = null;
      let latestPriceDate: string | null = null;
      let ytdReturnPct: number | null = null;

      if (security) {
        const prices = await prisma.securityPrice.findMany({
          where: { securityId: security.id },
          orderBy: { tradingDate: "asc" },
          select: { tradingDate: true, closeVwap: true },
        });
        if (prices.length > 0) {
          const latest = prices[prices.length - 1];
          latestPrice = Number(latest.closeVwap);
          latestPriceDate = latest.tradingDate.toISOString().slice(0, 10);
          const history: DatedValue[] = prices.map((p) => ({ date: p.tradingDate, value: Number(p.closeVwap) }));
          ytdReturnPct = computeReturn(history, "YTD")?.pct ?? null;
        }
      }

      const revenue = await getLatestAnnualMetricValue(company.id, "REVENUE");
      const operatingIncome = revenue ? null : await getLatestAnnualMetricValue(company.id, "OPERATING_INCOME");
      const pat = await getLatestAnnualMetricValue(company.id, "PROFIT_AFTER_TAX");
      const eps = await getLatestAnnualMetricValue(company.id, "EPS");

      return {
        ticker: company.ticker!,
        name: company.name,
        sector: company.sector,
        latestPrice,
        latestPriceDate,
        ytdReturnPct,
        primaryRevenueMetric: revenue ? "REVENUE" : operatingIncome ? "OPERATING_INCOME" : null,
        latestRevenue: revenue?.value ?? operatingIncome?.value ?? null,
        latestRevenueYear: revenue?.period.fiscalYear ?? operatingIncome?.period.fiscalYear ?? null,
        latestPat: pat?.value ?? null,
        latestEps: eps?.value ?? null,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Ratios bundle
// ---------------------------------------------------------------------------

export interface CompanyRatios {
  roe: RatioResult | null;
  roa: RatioResult | null;
  pe: RatioResult | null;
  pb: RatioResult | null;
  dividendYield: RatioResult | null;
  priceDate: string | null;
}

/** The prior year's ANNUAL value for `metricCode`, same statement scope as `current` — null if that year isn't in the system (never falls back to a different year or scope). */
async function getPriorAnnualValue(companyId: string, metricCode: string, current: { period: PeriodRow }): Promise<number | null> {
  const prisma = getPrisma();
  const obs = await prisma.companyFinancialObservation.findFirst({
    where: {
      metric: { code: metricCode },
      financialPeriod: {
        companyId,
        period: "ANNUAL",
        fiscalYear: current.period.fiscalYear - 1,
        statementScope: current.period.statementScope,
      },
    },
  });
  return obs ? Number(obs.value) : null;
}

/** Every ratio independently null-safe — a company missing shares outstanding still gets ROE/ROA if equity/assets are present. */
export async function getCompanyRatios(companyId: string, latestMarketPrice: number | null, priceDate: string | null): Promise<CompanyRatios> {
  const [pat, equity, assets, eps, dps, shares] = await Promise.all([
    getLatestAnnualMetricValue(companyId, "PROFIT_AFTER_TAX"),
    getLatestAnnualMetricValue(companyId, "TOTAL_EQUITY"),
    getLatestAnnualMetricValue(companyId, "TOTAL_ASSETS"),
    getLatestAnnualMetricValue(companyId, "EPS"),
    getLatestAnnualMetricValue(companyId, "DIVIDEND_PER_SHARE"),
    getLatestAnnualMetricValue(companyId, "SHARES_OUTSTANDING"),
  ]);

  const [priorEquity, priorAssets] = await Promise.all([
    equity ? getPriorAnnualValue(companyId, "TOTAL_EQUITY", equity) : Promise.resolve(null),
    assets ? getPriorAnnualValue(companyId, "TOTAL_ASSETS", assets) : Promise.resolve(null),
  ]);

  return {
    roe: pat && equity ? computeROE(pat.value, equity.value, priorEquity) : null,
    roa: pat && assets ? computeROA(pat.value, assets.value, priorAssets) : null,
    pe: latestMarketPrice && eps ? computePE(latestMarketPrice, eps.value) : null,
    pb: latestMarketPrice && equity && shares ? computePB(latestMarketPrice, equity.value, shares.value) : null,
    dividendYield: latestMarketPrice && dps ? computeDividendYield(dps.value, latestMarketPrice) : null,
    priceDate,
  };
}
