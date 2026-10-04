import Link from "next/link";
import { getFixedIncomeWorkspace } from "@/lib/queries/fixed-income";
import { getTreasurySnapshot, TREASURY_INSTRUMENTS } from "@/lib/queries/market-data";
import {
  buildYieldLandscape,
  describeMarketState,
  formatIsoDate,
  formatPct,
  issuerShortName,
  MATURING_SOON_DAYS,
  securityShortLabel,
  summarizeSegment,
  toValuationDate,
  type SegmentSummary,
} from "@/lib/fixed-income";
import { observationFreshness } from "@/lib/freshness";
import { YieldLandscape } from "@/components/fixed-income/YieldLandscape";
import { FixedIncomeNav } from "@/components/fixed-income/FixedIncomeNav";
import { FreshnessBadge, MarketStateChip, SectionHeading } from "@/components/fixed-income/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Fixed Income › Intelligence (M7.3.2 §3) — the calm landing view. It answers,
// top to bottom: what is happening → what can I actually evaluate → where do
// securities sit → where should I look next. Every figure is a count or value
// the M7.3.1 analytics already produced; nothing here is scored or ranked, and
// the detailed tables live one click away on the Market page.
// ---------------------------------------------------------------------------

function Figure({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border-l-2 border-zinc-200 pl-4 dark:border-zinc-800 ${className}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
      {children}
    </div>
  );
}

function BondPanel({ title, s }: { title: string; s: SegmentSummary }) {
  return (
    <Panel title={title}>
      <Figure
        label="With a reliable yield"
        value={
          <>
            {s.reliable}
            <span className="text-base font-normal text-zinc-400 dark:text-zinc-500"> / {s.active} active</span>
          </>
        }
        sub={`${s.recent} recent · ${s.stale} stale`}
      />
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        Latest trade {s.latestTrade ? formatIsoDate(s.latestTrade.date) : "none"}
        {s.latestTrade && <FreshnessBadge freshness={s.latestTrade.freshness} />}
      </p>
    </Panel>
  );
}

export default async function FixedIncomeIntelligencePage() {
  const valuationDate = toValuationDate(new Date());
  const [workspace, treasury] = await Promise.all([getFixedIncomeWorkspace(valuationDate), getTreasurySnapshot()]);
  const { securities, comparables } = workspace;

  const outstanding = securities.filter((s) => s.lifecycle !== "MATURED");
  const gov = summarizeSegment(securities.filter((s) => s.classification === "SOVEREIGN"));
  const corp = summarizeSegment(securities.filter((s) => s.classification === "CORPORATE"));
  const landscape = buildYieldLandscape(securities, comparables, valuationDate);

  const allActive = gov.active + corp.active;
  const allRecent = gov.recent + corp.recent;
  const attention = outstanding.filter((s) => describeMarketState(s) === "NEEDS_REVIEW" || s.termsIssues.some((i) => i.severity !== "INFO"));
  const latestCorporateTrades = outstanding
    .filter((s) => s.classification === "CORPORATE" && s.analyticsEligible && s.latestObservationDate)
    .sort((a, b) => b.latestObservationDate!.localeCompare(a.latestObservationDate!) || a.maturityDate.localeCompare(b.maturityDate))
    .slice(0, 5);
  const corporateIssuers = [...new Set(outstanding.filter((s) => s.classification === "CORPORATE").map((s) => s.issuerName))].sort((a, b) => issuerShortName(a).localeCompare(issuerShortName(b)));

  return (
    <div className="space-y-9">
      <FixedIncomeNav asOf={formatIsoDate(workspace.valuationDateIso)} />

      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Ghana Fixed Income</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          What is happening, what can be evaluated with reliable data, and where to look next. Observed market data is kept separate from hypothetical scenarios, and every figure carries its date.
        </p>
      </div>

      {/* -------------------------------------------------------- 1. What is happening? */}
      <section aria-label="Market summary">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
          <Panel title="Treasury bills · BoG auction">
            <div className="grid grid-cols-3 gap-3">
              {TREASURY_INSTRUMENTS.map(({ code, label }) => {
                const [latest] = treasury.find((t) => t.code === code)?.latestTwo ?? [];
                return <Figure key={code} label={label} value={latest ? `${Number(latest.interestRate).toFixed(2)}%` : "—"} />;
              })}
            </div>
            {(() => {
              const dates = TREASURY_INSTRUMENTS.map(({ code }) => treasury.find((t) => t.code === code)?.latestTwo[0]?.observationDate).filter((d): d is Date => !!d);
              const latest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
              return (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {latest ? <>Auction {formatIsoDate(latest.toISOString().slice(0, 10))}</> : "No auction data"}
                  {latest && <FreshnessBadge freshness={observationFreshness("WEEKLY", latest, valuationDate)} />}
                </p>
              );
            })()}
          </Panel>
          <BondPanel title="Government bonds" s={gov} />
          <BondPanel title="Corporate bonds" s={corp} />
          <Panel title="Data coverage">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{allRecent}</span> of {allActive} active bonds have a reliable trade in the last 10 days.
            </p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {gov.stale + corp.stale} stale · {gov.needsReview + corp.needsReview} need review · {gov.carriedOnly + corp.carriedOnly} carried price only · {gov.neverQuoted + corp.neverQuoted} never quoted
              {gov.maturingSoon + corp.maturingSoon > 0 ? ` · ${gov.maturingSoon + corp.maturingSoon} maturing within ${MATURING_SOON_DAYS} days` : ""}
            </p>
          </Panel>
        </div>
      </section>

      {/* -------------------------------------------------------- 2. Where do securities sit? */}
      <section aria-label="Ghana yield landscape">
        <SectionHeading
          title="Ghana Yield Landscape"
          question="Where do Treasury bills, government bonds and corporate bonds sit on maturity and observed yield? Each point is one security at its own latest observation."
          right={
            <Link href="/fixed-income/market#sovereign-curve" className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
              Detailed sovereign curve →
            </Link>
          }
        />
        <YieldLandscape points={landscape.points} withheld={landscape.withheld} notPlotted={landscape.notPlotted} comparables={comparables} />
        <p className="mt-3 max-w-4xl text-[11px] text-zinc-400 dark:text-zinc-500">
          Government coverage is incomplete: the government securities master appears to omit some current post-DDEP bonds, so the government points are not a full Ghana sovereign picture and a selected benchmark is not necessarily the ideal one.
        </p>
      </section>

      {/* -------------------------------------------------------- 3. Where should I look next? */}
      <section aria-label="Where to look next">
        <SectionHeading title="Where to look next" question="Factual starting points — most recent corporate trades, anything the data checks flagged, and issuers to evaluate." />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-3">
          <Panel title="Latest corporate trades">
            {latestCorporateTrades.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No corporate bond has a reliable observed trade.</p>
            ) : (
              <ul className="space-y-1.5">
                {latestCorporateTrades.map((s) => (
                  <li key={s.instrumentCode} className="flex items-baseline justify-between gap-2 text-sm">
                    <Link href={`/fixed-income/${encodeURIComponent(s.instrumentCode)}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                      {securityShortLabel(s.issuerName, s.couponRatePct, s.maturityDate)}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatPct(s.analytics.ytmPct!)} · {formatIsoDate(s.latestObservationDate!)}
                      <MarketStateChip state={describeMarketState(s)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Flagged by data checks">
            {attention.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No outstanding security is currently flagged.</p>
            ) : (
              <ul className="space-y-1.5">
                {attention.slice(0, 5).map((s) => {
                  const reasons = [...(s.analytics.quality?.issues ?? []), ...s.termsIssues].filter((i) => i.severity !== "INFO").map((i) => i.label);
                  return (
                    <li key={s.instrumentCode} className="text-sm">
                      <Link href={`/fixed-income/${encodeURIComponent(s.instrumentCode)}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {securityShortLabel(s.issuerName, s.couponRatePct, s.maturityDate)}
                      </Link>
                      <span className="block text-xs text-orange-700 dark:text-orange-300">⚠ {[...new Set(reasons)].join(", ")}</span>
                    </li>
                  );
                })}
                {attention.length > 5 && <li className="text-xs text-zinc-400 dark:text-zinc-500">+ {attention.length - 5} more in the Market view</li>}
              </ul>
            )}
          </Panel>

          <Panel title="Evaluate an issuer">
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">Select an issuer to compare all its active bonds — observed market versus hypothetical purchase prices.</p>
            <div className="flex flex-wrap gap-1.5">
              {corporateIssuers.map((name) => (
                <Link
                  key={name}
                  href={`/fixed-income/compare?issuer=${encodeURIComponent(name)}`}
                  title={name}
                  className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {issuerShortName(name)}
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </section>

      {/* -------------------------------------------------------- 4. Deeper layers */}
      <section aria-label="Go deeper" className="grid grid-cols-1 gap-3 border-t border-zinc-100 pt-5 text-sm dark:border-zinc-800 sm:grid-cols-2">
        <Link href="/fixed-income/compare" className="group rounded border border-zinc-200 p-3 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-800 dark:hover:bg-zinc-900">
          <span className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">Compare &amp; Scenarios →</span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">Analysis: what return would a bond deliver at a purchase price, and where else is a similar yield?</span>
        </Link>
        <Link href="/fixed-income/market" className="group rounded border border-zinc-200 p-3 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-800 dark:hover:bg-zinc-900">
          <span className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">Market &amp; Evidence →</span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">Evidence: the full securities universe, reliable observed yields, quality flags and the detailed sovereign curve.</span>
        </Link>
      </section>
    </div>
  );
}
