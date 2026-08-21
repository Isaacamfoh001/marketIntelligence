import Link from "next/link";
import { notFound } from "next/navigation";
import { dailyFreshness, type Freshness } from "@/lib/freshness";
import { describeDirection } from "@/lib/direction";
import { DirectionText } from "@/components/DirectionText";
import { RatesChart } from "@/components/RatesChart";
import { FinancialBarChart } from "@/components/FinancialBarChart";
import { CompanyLogo } from "@/components/CompanyLogo";
import { getSecuritiesWithReturns } from "@/lib/queries/equities";
import {
  getCompanyByTicker,
  getAnnualFinancials,
  getLatestInterim,
  getCompanyRatios,
  getLatestAnnualStatementProvenance,
  formatPeriodLabel,
} from "@/lib/queries/companies";
import { FINANCIAL_METRICS, type MetricPolarity } from "@/lib/financial-metrics";
import { resolveFinancialProfile } from "@/lib/financial-profile";
import type { RatioResult } from "@/lib/financial-ratios";

export const dynamic = "force-dynamic";

const GENERAL_SNAPSHOT: string[] = ["REVENUE", "PROFIT_AFTER_TAX", "EPS", "TOTAL_ASSETS", "TOTAL_EQUITY", "DIVIDEND_PER_SHARE"];
const BANK_SNAPSHOT: string[] = ["OPERATING_INCOME", "NET_INTEREST_INCOME", "PROFIT_AFTER_TAX", "TOTAL_ASSETS", "CUSTOMER_DEPOSITS", "LOANS_AND_ADVANCES", "EPS"];
const GENERAL_TRENDS: { code: string; color: string }[] = [
  { code: "REVENUE", color: "#3b82f6" },
  { code: "PROFIT_AFTER_TAX", color: "#10b981" },
  { code: "EPS", color: "#8b5cf6" },
  { code: "DIVIDEND_PER_SHARE", color: "#ec4899" },
];
const BANK_TRENDS: { code: string; color: string }[] = [
  { code: "OPERATING_INCOME", color: "#3b82f6" },
  { code: "NET_INTEREST_INCOME", color: "#f59e0b" },
  { code: "PROFIT_AFTER_TAX", color: "#10b981" },
  { code: "EPS", color: "#8b5cf6" },
];

function formatGhs(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return value.toLocaleString("en-GH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatLargeGhs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `GHS ${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `GHS ${(value / 1_000_000).toFixed(1)}M`;
  return `GHS ${value.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">{children}</div>;
}

function StatBlock({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const styles: Record<string, string> = {
    CURRENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    STALE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    MISSING: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${styles[freshness]}`}>{freshness}</span>;
}

function RatioBlock({ label, ratio, formatter }: { label: string; ratio: RatioResult | null; formatter: (v: number) => string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{ratio ? formatter(ratio.value) : "—"}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{ratio ? ratio.methodology : "Unavailable — insufficient data"}</div>
    </div>
  );
}

function growthDirection(current: number, prior: number, polarity: MetricPolarity) {
  return describeDirection(current, prior, polarity);
}

export default async function CompanyExplorerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const company = await getCompanyByTicker(ticker);
  if (!company) notFound();

  const isBank = resolveFinancialProfile(company.sector) === "BANK";
  const snapshotMetrics = isBank ? BANK_SNAPSHOT : GENERAL_SNAPSHOT;
  const trendConfig = isBank ? BANK_TRENDS : GENERAL_TRENDS;
  // SHARES_OUTSTANDING isn't shown as its own snapshot/trend card, but is
  // fetched alongside them for the derived Market Capitalization figure
  // below (price x latest reported shares outstanding).
  const allMetrics = Array.from(new Set([...snapshotMetrics, ...trendConfig.map((t) => t.code), "SHARES_OUTSTANDING"]));

  const [securities, annual, interim, provenance] = await Promise.all([
    getSecuritiesWithReturns(),
    getAnnualFinancials(company.id, allMetrics),
    getLatestInterim(company.id, allMetrics),
    getLatestAnnualStatementProvenance(company.id),
  ]);

  const security = securities.find((s) => s.ticker === ticker) ?? null;
  const latestPrice = security?.latestPrice ?? null;
  const latestPriceDate = security?.latestDate ?? null;
  const ratios = await getCompanyRatios(company.id, latestPrice, latestPriceDate);

  const latestAnnualYear = annual.periods.length > 0 ? annual.periods[annual.periods.length - 1].fiscalYear : null;

  // Insight strip (M8 §37) — concise computed YoY context, not commentary.
  // Only ever built from two genuinely consecutive fiscal years for the
  // same metric; a gap year (one side missing) yields no claim at all.
  const primaryTopLineMetric = isBank ? "OPERATING_INCOME" : "REVENUE";
  const yoyPct = (metricCode: string): { pct: number; year: number } | null => {
    const series = annual.seriesByMetric[metricCode] ?? [];
    if (series.length < 2) return null;
    const latest = series[series.length - 1];
    const prior = series[series.length - 2];
    if (prior.fiscalYear !== latest.fiscalYear - 1 || prior.value <= 0) return null;
    return { pct: ((latest.value - prior.value) / prior.value) * 100, year: latest.fiscalYear };
  };
  const insightStrip = [
    { label: isBank ? "Op. Income" : "Revenue", change: yoyPct(primaryTopLineMetric) },
    { label: "PAT", change: yoyPct("PROFIT_AFTER_TAX") },
    { label: "EPS", change: yoyPct("EPS") },
  ];
  const hasInsightStrip = insightStrip.some((i) => i.change !== null) || ratios.roe !== null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/companies" className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300">
          ← Companies
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-3">
            <CompanyLogo ticker={company.ticker} size={40} />
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{company.name}</h1>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {company.ticker} · {company.sector ?? "Sector not classified"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {hasInsightStrip && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {latestAnnualYear ? `FY${latestAnnualYear}` : "—"}
          </span>
          {insightStrip.map(
            ({ label, change }) =>
              change && (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
                  <DirectionText
                    arrow={describeDirection(change.pct, 0, "higherIsPositive", 1e-9).arrow}
                    text={`${Math.abs(change.pct).toFixed(1)}%`}
                    sentiment={describeDirection(change.pct, 0, "higherIsPositive", 1e-9).sentiment}
                  />
                </span>
              ),
          )}
          {ratios.roe && (
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-500 dark:text-zinc-400">ROE</span>
              <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{ratios.roe.value.toFixed(1)}%</span>
            </span>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Market Performance</h2>
        {security && security.latestPrice !== null ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latest Price</div>
                <FreshnessBadge freshness={dailyFreshness(new Date(`${security.latestDate}T00:00:00.000Z`))} />
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">GHS {formatGhs(security.latestPrice, 4)}</div>
              <div className="mt-1 text-xs">
                {security.returns["1D"] ? (
                  <DirectionText
                    arrow={describeDirection(security.returns["1D"].pct, 0, "higherIsPositive", 1e-9).arrow}
                    text={`${Math.abs(security.returns["1D"].pct).toFixed(2)}%`}
                    suffix="1D"
                    sentiment={describeDirection(security.returns["1D"].pct, 0, "higherIsPositive", 1e-9).sentiment}
                  />
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-500">— 1D unavailable</span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{formatDate(security.latestDate)} · Ghana Stock Exchange</div>
            </SectionCard>
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock
                  label="YTD"
                  value={
                    security.returns.YTD ? (
                      <DirectionText
                        arrow={describeDirection(security.returns.YTD.pct, 0, "higherIsPositive", 1e-9).arrow}
                        text={`${Math.abs(security.returns.YTD.pct).toFixed(2)}%`}
                        sentiment={describeDirection(security.returns.YTD.pct, 0, "higherIsPositive", 1e-9).sentiment}
                      />
                    ) : (
                      "—"
                    )
                  }
                />
                <StatBlock
                  label="1Y"
                  value={
                    security.returns["1Y"] ? (
                      <DirectionText
                        arrow={describeDirection(security.returns["1Y"].pct, 0, "higherIsPositive", 1e-9).arrow}
                        text={`${Math.abs(security.returns["1Y"].pct).toFixed(2)}%`}
                        sentiment={describeDirection(security.returns["1Y"].pct, 0, "higherIsPositive", 1e-9).sentiment}
                      />
                    ) : (
                      "—"
                    )
                  }
                />
                <StatBlock label="52-Week High" value={security.yearHigh !== null ? `GHS ${formatGhs(security.yearHigh, 2)}` : "—"} />
                <StatBlock label="52-Week Low" value={security.yearLow !== null ? `GHS ${formatGhs(security.yearLow, 2)}` : "—"} />
              </div>
            </SectionCard>
            <SectionCard>
              <StatBlock label="Volume (Latest Trading Date)" value={security.latestVolume !== null ? security.latestVolume.toLocaleString("en-GH") : "—"} />
              <div className="mt-3">
                <StatBlock
                  label="Market Capitalization"
                  value={
                    ratios && annual.seriesByMetric.SHARES_OUTSTANDING?.length > 0 && latestPrice !== null
                      ? formatLargeGhs(latestPrice * annual.seriesByMetric.SHARES_OUTSTANDING[annual.seriesByMetric.SHARES_OUTSTANDING.length - 1].value)
                      : "—"
                  }
                  sub="Derived: latest price × latest reported shares outstanding (not an official GSE figure)"
                />
              </div>
            </SectionCard>
            <div className="lg:col-span-3">
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Price History</p>
                <RatesChart series={[{ key: "price", label: ticker, color: "#3b82f6", data: security.priceHistory }]} unit="GHS" />
              </SectionCard>
            </div>
          </div>
        ) : (
          <div className="rounded border border-zinc-200 bg-white px-6 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No GSE market data imported yet for {ticker} — showing financials only.
            </p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Financial Snapshot</h2>
        {annual.periods.length > 0 ? (
          <SectionCard>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {snapshotMetrics.map((code) => {
                const def = FINANCIAL_METRICS[code];
                const series = annual.seriesByMetric[code] ?? [];
                const latest = series[series.length - 1];
                if (!latest) return <StatBlock key={code} label={def.name} value="—" sub="Not reported" />;
                const value = def.canonicalUnit === "PER_SHARE_GHS" ? `GHS ${latest.value.toFixed(2)}` : def.canonicalUnit === "COUNT" ? latest.value.toLocaleString("en-GH") : formatLargeGhs(latest.value);
                return <StatBlock key={code} label={def.name} value={value} sub={`FY${latest.fiscalYear}${latest.statementScope === "SEPARATE" ? " · Separate" : ""}`} />;
              })}
            </div>
          </SectionCard>
        ) : (
          <div className="rounded border border-zinc-200 bg-white px-6 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">No financial statements imported yet for {ticker}.</p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {annual.periods.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Annual Trends {annual.periods.length > 0 && `(FY${annual.periods[0].fiscalYear}–FY${latestAnnualYear})`}
          </h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {trendConfig.map(({ code, color }) => {
              const def = FINANCIAL_METRICS[code];
              const series = annual.seriesByMetric[code] ?? [];
              return (
                <SectionCard key={code}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{def.name}</p>
                  <FinancialBarChart data={series.map((p) => ({ fiscalYear: p.fiscalYear, value: p.value }))} unit={def.canonicalUnit === "PER_SHARE_GHS" ? "GHS/share" : "GHS"} color={color} />
                </SectionCard>
              );
            })}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      {interim && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Latest Results — {formatPeriodLabel(interim.latest)}
            {interim.latest.audited === false && <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">UNAUDITED</span>}
          </h2>
          <SectionCard>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {snapshotMetrics
                .filter((code) => interim.latestValues[code] !== undefined)
                .map((code) => {
                  const def = FINANCIAL_METRICS[code];
                  const latest = interim.latestValues[code]!;
                  const prior = interim.priorValues[code];
                  const value = def.canonicalUnit === "PER_SHARE_GHS" ? `GHS ${latest.toFixed(2)}` : formatLargeGhs(latest);
                  let changeLine: React.ReactNode = <span className="text-zinc-400 dark:text-zinc-500">no prior comparable period</span>;
                  if (prior !== undefined) {
                    const { arrow, sentiment } = growthDirection(latest, prior, def.polarity);
                    const pctChange = prior !== 0 ? ((latest - prior) / Math.abs(prior)) * 100 : null;
                    changeLine = pctChange !== null ? (
                      <DirectionText arrow={arrow} text={`${Math.abs(pctChange).toFixed(1)}%`} suffix={`vs ${formatPeriodLabel(interim.priorComparable!)}`} sentiment={sentiment} />
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-500">vs {formatPeriodLabel(interim.priorComparable!)}</span>
                    );
                  }
                  return (
                    <div key={code}>
                      <StatBlock label={def.name} value={value} />
                      <div className="mt-0.5 text-xs">{changeLine}</div>
                    </div>
                  );
                })}
            </div>
            {!interim.priorComparable && (
              <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                No {formatPeriodLabel({ ...interim.latest, fiscalYear: interim.latest.fiscalYear - 1 })} comparable period on record — YoY change unavailable.
              </p>
            )}
          </SectionCard>
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Ratios</h2>
        <SectionCard>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <RatioBlock label="ROE" ratio={ratios.roe} formatter={(v) => `${v.toFixed(1)}%`} />
            <RatioBlock label="ROA" ratio={ratios.roa} formatter={(v) => `${v.toFixed(1)}%`} />
            <RatioBlock label="P/E" ratio={ratios.pe} formatter={(v) => `${v.toFixed(1)}x`} />
            <RatioBlock label="P/B" ratio={ratios.pb} formatter={(v) => `${v.toFixed(2)}x`} />
            <RatioBlock label="Dividend Yield" ratio={ratios.dividendYield} formatter={(v) => `${v.toFixed(2)}%`} />
          </div>
          {ratios.priceDate && <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">Market-dependent ratios use the price as of {formatDate(ratios.priceDate)}.</p>}
        </SectionCard>
      </section>

      {/* ------------------------------------------------------------ */}
      {provenance && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Statement Details</h2>
          <SectionCard>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatBlock label="Source" value={provenance.sourceName} />
              <StatBlock label="Period" value={provenance.periodLabel} />
              <StatBlock
                label="Audited"
                value={provenance.audited === true ? "Yes" : provenance.audited === false ? "No" : "—"}
              />
              <StatBlock label="Statement Scope" value={provenance.statementScope === "CONSOLIDATED" ? "Consolidated (Group)" : "Separate"} />
            </div>
            <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
              Imported {formatDate(provenance.retrievedAt.toISOString().slice(0, 10))}
              {provenance.artifactName && ` from "${provenance.artifactName}"`}.
            </p>
          </SectionCard>
        </section>
      )}
    </div>
  );
}
