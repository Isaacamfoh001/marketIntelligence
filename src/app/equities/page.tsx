import { dailyFreshness, type Freshness } from "@/lib/freshness";
import { describeDirection, DIRECTION_ARROW } from "@/lib/direction";
import { DirectionText } from "@/components/DirectionText";
import { SecuritiesTable } from "@/components/SecuritiesTable";
import {
  getMarketIndexSnapshot,
  getLatestMarketSummary,
  getSecuritiesWithReturns,
  getMarketActivity,
  getLatestSecurityTradingDate,
} from "@/lib/queries/equities";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">{children}</div>;
}

function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const styles: Record<string, string> = {
    CURRENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    STALE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    MISSING: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${styles[freshness]}`}>
      {freshness}
    </span>
  );
}

function EmptyMetric({ label }: { label: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-300 dark:text-zinc-700">&mdash;</div>
      <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">Awaiting first official GSE import</div>
    </div>
  );
}

/** GSE-CI/GSE-FSI follow ordinary-equity polarity: rising is positive (the shared M6 direction rule) — the same treatment SecuritiesTable gives individual stocks. */
function IndexMetric({
  label,
  latest,
  previous,
}: {
  label: string;
  latest: { observationDate: Date; level: unknown } | undefined;
  previous: { observationDate: Date; level: unknown } | undefined;
}) {
  if (!latest) return <EmptyMetric label={label} />;

  const level = Number(latest.level);
  const freshness = dailyFreshness(latest.observationDate);

  let changeLine: React.ReactNode = <span className="text-zinc-400 dark:text-zinc-500">·</span>;
  if (previous) {
    const prevLevel = Number(previous.level);
    const pct = ((level - prevLevel) / prevLevel) * 100;
    const { arrow, sentiment } = describeDirection(level, prevLevel, "higherIsPositive");
    changeLine = <DirectionText arrow={arrow} text={`${Math.abs(pct).toFixed(2)}%`} suffix="vs previous trading day" sentiment={sentiment} />;
  }

  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
        <FreshnessBadge freshness={freshness} />
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        {level.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="mt-1 text-xs">{changeLine}</div>
      <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{formatDate(latest.observationDate.toISOString().slice(0, 10))} · GSE</div>
    </div>
  );
}

function RankingList({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: { ticker: string; companyName: string; right: React.ReactNode }[];
  emptyMessage: string;
}) {
  return (
    <SectionCard>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{emptyMessage}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.ticker} className="flex items-center justify-between text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.ticker}</span>{" "}
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{r.companyName}</span>
              </span>
              <span className="ml-2 shrink-0">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export default async function EquitiesPage() {
  const [gseCi, gseFsi, marketSummary, securities] = await Promise.all([
    getMarketIndexSnapshot("GSE-CI"),
    getMarketIndexSnapshot("GSE-FSI"),
    getLatestMarketSummary(),
    getSecuritiesWithReturns(),
  ]);

  // A Security is only ever created as a side effect of importing at
  // least one real price, but filtering here stays defensive rather than
  // assuming that invariant always holds (e.g. every price row for a
  // security later being corrected away) — a security with no price data
  // has nothing legitimate to show and must never render as a dash-filled
  // row or an empty ranking-list entry.
  const securitiesWithPrices = securities.filter((s) => s.latestPrice !== null);
  const activity = getMarketActivity(securitiesWithPrices);
  const latestTradingDate = getLatestSecurityTradingDate(securitiesWithPrices);
  const hasAnySecurities = securitiesWithPrices.length > 0;
  const hasAnyIndexData = (gseCi?.latestTwo.length ?? 0) > 0 || (gseFsi?.latestTwo.length ?? 0) > 0 || marketSummary !== null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Ghana Equities</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Ghana Stock Exchange — index levels, market activity, and security prices, sourced and dated at the observation level.
        </p>
      </div>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Market Summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <IndexMetric label="GSE Composite Index" latest={gseCi?.latestTwo[0]} previous={gseCi?.latestTwo[1]} />
          <IndexMetric label="GSE Financial Stocks Index" latest={gseFsi?.latestTwo[0]} previous={gseFsi?.latestTwo[1]} />
          {marketSummary?.marketCapGhs != null ? (
            <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Market Capitalization</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                GHS {Number(marketSummary.marketCapGhs).toLocaleString("en-GH", { maximumFractionDigits: 0 })}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{formatDate(marketSummary.tradingDate.toISOString().slice(0, 10))} · GSE</div>
            </div>
          ) : (
            <EmptyMetric label="Market Capitalization" />
          )}
          {marketSummary?.totalValueTradedGhs != null ? (
            <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total Value Traded</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                GHS {Number(marketSummary.totalValueTradedGhs).toLocaleString("en-GH", { maximumFractionDigits: 0 })}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{formatDate(marketSummary.tradingDate.toISOString().slice(0, 10))} · GSE</div>
            </div>
          ) : (
            <EmptyMetric label="Total Value Traded" />
          )}
        </div>
        {!hasAnyIndexData && (
          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            Latest trading date: {formatDate(latestTradingDate)}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Market Activity
        </h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <RankingList
            title="Top Gainers"
            emptyMessage={hasAnySecurities ? "No gainers today" : "Awaiting first official GSE import"}
            rows={activity.gainers.map((g) => ({
              ticker: g.ticker,
              companyName: g.companyName,
              right: <DirectionText arrow={DIRECTION_ARROW.up} text={`${g.oneDayChangePct.toFixed(2)}%`} sentiment="positive" />,
            }))}
          />
          <RankingList
            title="Top Losers"
            emptyMessage={hasAnySecurities ? "No losers today" : "Awaiting first official GSE import"}
            rows={activity.losers.map((l) => ({
              ticker: l.ticker,
              companyName: l.companyName,
              right: <DirectionText arrow={DIRECTION_ARROW.down} text={`${Math.abs(l.oneDayChangePct).toFixed(2)}%`} sentiment="negative" />,
            }))}
          />
          <RankingList
            title="Most Traded — By Value"
            emptyMessage={hasAnySecurities ? "No trading activity recorded" : "Awaiting first official GSE import"}
            rows={activity.mostTradedByValue.map((m) => ({
              ticker: m.ticker,
              companyName: m.companyName,
              right: (
                <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                  GHS {(m.latestValueTradedGhs ?? 0).toLocaleString("en-GH", { maximumFractionDigits: 0 })}
                </span>
              ),
            }))}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Securities
        </h2>
        {hasAnySecurities ? (
          <SecuritiesTable securities={securitiesWithPrices} />
        ) : (
          <div className="rounded border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Awaiting first official GSE import</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-zinc-400 dark:text-zinc-500">
              GSE market data is configured for validated official-file ingestion. Ghana Stock Exchange&rsquo;s public
              website blocks automated agents, so security prices and index levels are imported from official GSE
              exports (CSV/Excel) through the Data Centre&rsquo;s import pipeline rather than scraped live. Once a file
              is imported, securities, returns, and market activity will populate this page automatically.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
