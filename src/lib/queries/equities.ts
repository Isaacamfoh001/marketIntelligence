// ---------------------------------------------------------------------------
// Shared read queries for GSE market/equities snapshots — the ONE place
// Overview and /equities both go through, so Prisma querying and return
// calculations are never duplicated between pages (mirrors market-data.ts
// for macro/rates/FX).
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { computeAllReturns, computeReturn, type DatedValue, type ReturnResult, type ReturnWindow } from "../returns";
import { topGainers, topLosers, mostTraded, type RankableSecurity, type RankedSecurity, type MostTradedSecurity } from "../rankings";

export interface ChartPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Market indices (GSE-CI, GSE-FSI)
// ---------------------------------------------------------------------------

export interface MarketIndexObservationRow {
  observationDate: Date;
  level: unknown;
}

export interface MarketIndexSnapshot {
  code: string;
  name: string;
  latestTwo: MarketIndexObservationRow[];
  history: ChartPoint[];
}

export async function getMarketIndexSnapshot(code: string): Promise<MarketIndexSnapshot | null> {
  const prisma = getPrisma();
  const index = await prisma.marketIndex.findUnique({ where: { code } });
  if (!index) return null;

  const [latestTwo, history] = await Promise.all([
    prisma.marketIndexObservation.findMany({
      where: { marketIndexId: index.id },
      orderBy: { observationDate: "desc" },
      take: 2,
    }),
    prisma.marketIndexObservation.findMany({
      where: { marketIndexId: index.id },
      orderBy: { observationDate: "asc" },
      select: { observationDate: true, level: true },
    }),
  ]);

  return {
    code: index.code,
    name: index.name,
    latestTwo,
    history: history.map((row) => ({ date: row.observationDate.toISOString().slice(0, 10), value: Number(row.level) })),
  };
}

// ---------------------------------------------------------------------------
// Market summary (whole-market volume/value/cap)
// ---------------------------------------------------------------------------

export interface MarketSummaryRow {
  tradingDate: Date;
  totalVolume: unknown;
  totalValueTradedGhs: unknown;
  marketCapGhs: unknown;
}

export async function getLatestMarketSummary(): Promise<MarketSummaryRow | null> {
  const prisma = getPrisma();
  return prisma.marketSummary.findFirst({ orderBy: { tradingDate: "desc" } });
}

// ---------------------------------------------------------------------------
// Securities with computed returns
// ---------------------------------------------------------------------------

export interface SecuritySnapshot {
  securityId: string;
  ticker: string;
  companyName: string;
  securityType: string;
  latestPrice: number | null;
  latestDate: string | null;
  latestVolume: number | null;
  latestValueTradedGhs: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  returns: Record<ReturnWindow, ReturnResult | null>;
  priceHistory: ChartPoint[];
}

/**
 * Every active security with its full price history and computed
 * 1D/1M/YTD/1Y returns. V1 scale (a representative GSE universe, not the
 * full exchange tick-by-tick) makes one query per security acceptable —
 * same judgement call as Data Centre's per-source latest-observation
 * lookup (CLAUDE.md §27: correctness first, no premature optimisation).
 */
export async function getSecuritiesWithReturns(): Promise<SecuritySnapshot[]> {
  const prisma = getPrisma();
  const securities = await prisma.security.findMany({
    where: { active: true },
    include: { company: true },
    orderBy: { ticker: "asc" },
  });

  return Promise.all(
    securities.map(async (sec) => {
      const prices = await prisma.securityPrice.findMany({
        where: { securityId: sec.id },
        orderBy: { tradingDate: "asc" },
        select: { tradingDate: true, closeVwap: true, volume: true, valueTradedGhs: true, yearHigh: true, yearLow: true },
      });

      const history: DatedValue[] = prices.map((p) => ({ date: p.tradingDate, value: Number(p.closeVwap) }));
      const latest = prices[prices.length - 1];

      return {
        securityId: sec.id,
        ticker: sec.ticker,
        companyName: sec.company.name,
        securityType: sec.securityType,
        latestPrice: latest ? Number(latest.closeVwap) : null,
        latestDate: latest ? latest.tradingDate.toISOString().slice(0, 10) : null,
        latestVolume: latest?.volume != null ? Number(latest.volume) : null,
        latestValueTradedGhs: latest?.valueTradedGhs != null ? Number(latest.valueTradedGhs) : null,
        yearHigh: latest?.yearHigh != null ? Number(latest.yearHigh) : null,
        yearLow: latest?.yearLow != null ? Number(latest.yearLow) : null,
        returns: computeAllReturns(history),
        priceHistory: history.map((h) => ({ date: h.date.toISOString().slice(0, 10), value: h.value })),
      };
    }),
  );
}

function toRankable(securities: SecuritySnapshot[]): RankableSecurity[] {
  return securities.map((s) => ({
    securityId: s.securityId,
    ticker: s.ticker,
    companyName: s.companyName,
    priceHistory: s.priceHistory.map((p) => ({ date: new Date(`${p.date}T00:00:00.000Z`), value: p.value })),
    latestVolume: s.latestVolume,
    latestValueTradedGhs: s.latestValueTradedGhs,
  }));
}

export interface MarketActivity {
  gainers: RankedSecurity[];
  losers: RankedSecurity[];
  mostTradedByValue: MostTradedSecurity[];
  mostTradedByVolume: MostTradedSecurity[];
}

export function getMarketActivity(securities: SecuritySnapshot[], limit: number = 5): MarketActivity {
  const rankable = toRankable(securities);
  return {
    gainers: topGainers(rankable, limit),
    losers: topLosers(rankable, limit),
    mostTradedByValue: mostTraded(rankable, "value", limit),
    mostTradedByVolume: mostTraded(rankable, "volume", limit),
  };
}

/** Latest trading date across all securities — used for the Securities table's freshness state. */
export function getLatestSecurityTradingDate(securities: SecuritySnapshot[]): string | null {
  const dates = securities.map((s) => s.latestDate).filter((d): d is string => d != null);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (b > a ? b : a));
}

export { computeReturn };
