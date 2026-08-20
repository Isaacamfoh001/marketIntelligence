// ---------------------------------------------------------------------------
// Market Activity rankings — Top Gainers, Top Losers, Most Traded.
//
// Operates on each security's latest 1D return (from returns.ts, so the
// exact same "latest on/before" trading-date rule applies here as
// everywhere else) plus its latest observation's volume/value. A security
// with no computable 1D return (e.g. it just started trading, or a
// non-trading gap left insufficient history) is excluded from gainers/
// losers rather than silently treated as flat — CLAUDE.md: missing is not
// zero. Direction/sentiment for the rendered rows comes from the shared
// direction.ts module (equity polarity: higherIsPositive), not duplicated
// here.
// ---------------------------------------------------------------------------

import { computeReturn, type DatedValue } from "./returns";

export interface RankableSecurity {
  securityId: string;
  ticker: string;
  companyName: string;
  priceHistory: DatedValue[]; // ascending by date, close_vwap
  latestVolume: number | null;
  latestValueTradedGhs: number | null;
}

export interface RankedSecurity {
  securityId: string;
  ticker: string;
  companyName: string;
  latestPrice: number;
  latestDate: string;
  oneDayChangePct: number;
}

export interface MostTradedSecurity {
  securityId: string;
  ticker: string;
  companyName: string;
  latestVolume: number | null;
  latestValueTradedGhs: number | null;
  latestDate: string | null;
}

const FLAT_EPSILON = 1e-9;

/** Every security with a computable 1D return, most-recent-price-first ties broken by ticker for determinism. */
function withOneDayReturns(securities: RankableSecurity[]): RankedSecurity[] {
  const result: RankedSecurity[] = [];
  for (const sec of securities) {
    const oneDay = computeReturn(sec.priceHistory, "1D");
    if (!oneDay) continue; // insufficient history — excluded, not treated as flat
    result.push({
      securityId: sec.securityId,
      ticker: sec.ticker,
      companyName: sec.companyName,
      latestPrice: oneDay.currentValue,
      latestDate: oneDay.currentDate,
      oneDayChangePct: oneDay.pct,
    });
  }
  return result;
}

/** Strictly positive 1D movers, largest gain first. Flat securities (0% or effectively 0%) never appear here merely to fill space. */
export function topGainers(securities: RankableSecurity[], limit: number = 5): RankedSecurity[] {
  return withOneDayReturns(securities)
    .filter((s) => s.oneDayChangePct > FLAT_EPSILON)
    .sort((a, b) => b.oneDayChangePct - a.oneDayChangePct || a.ticker.localeCompare(b.ticker))
    .slice(0, limit);
}

/** Strictly negative 1D movers, largest loss first. */
export function topLosers(securities: RankableSecurity[], limit: number = 5): RankedSecurity[] {
  return withOneDayReturns(securities)
    .filter((s) => s.oneDayChangePct < -FLAT_EPSILON)
    .sort((a, b) => a.oneDayChangePct - b.oneDayChangePct || a.ticker.localeCompare(b.ticker))
    .slice(0, limit);
}

/** Most traded by value (the institutional default) or by volume, highest first. Securities with a missing (never-published) figure are excluded — not treated as 0. */
export function mostTraded(
  securities: RankableSecurity[],
  by: "value" | "volume" = "value",
  limit: number = 5,
): MostTradedSecurity[] {
  const field = by === "value" ? "latestValueTradedGhs" : "latestVolume";
  return securities
    .filter((s) => s[field] !== null)
    .sort((a, b) => (b[field] as number) - (a[field] as number) || a.ticker.localeCompare(b.ticker))
    .slice(0, limit)
    .map((s) => ({
      securityId: s.securityId,
      ticker: s.ticker,
      companyName: s.companyName,
      latestVolume: s.latestVolume,
      latestValueTradedGhs: s.latestValueTradedGhs,
      latestDate: s.priceHistory.length > 0 ? s.priceHistory[s.priceHistory.length - 1].date.toISOString().slice(0, 10) : null,
    }));
}
