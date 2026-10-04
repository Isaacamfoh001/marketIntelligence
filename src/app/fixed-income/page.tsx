import Link from "next/link";
import { getFixedIncomeWorkspace } from "@/lib/queries/fixed-income";
import { getTreasurySnapshot, TREASURY_INSTRUMENTS } from "@/lib/queries/market-data";
import {
  BENCHMARK_DATE_WINDOW_DAYS,
  buildAnalystQueue,
  buildWhatChanged,
  buildYieldLandscape,
  formatIsoDate,
  issuerShortName,
  JUST_STALE_WINDOW_DAYS,
  MATERIAL_BILL_MOVE_BPS,
  MATERIAL_YIELD_MOVE_BPS,
  MATURING_SOON_DAYS,
  PEER_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  summarizeSegment,
  toValuationDate,
  UNUSUAL_PEER_GAP_BPS,
  type QueueEntry,
  type SegmentSummary,
} from "@/lib/fixed-income";
import { observationFreshness } from "@/lib/freshness";
import { YieldLandscape } from "@/components/fixed-income/YieldLandscape";
import { FixedIncomeNav } from "@/components/fixed-income/FixedIncomeNav";
import { FreshnessBadge, MarketStateChip, Methodology, SectionHeading } from "@/components/fixed-income/ui";

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

function QueueGroup({ title, hint, group, empty, moreHref }: { title: string; hint: string; group: { entries: QueueEntry[]; more: number }; empty: string; moreHref?: string }) {
  return (
    <Panel title={title}>
      <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</p>
      {group.entries.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {group.entries.map((e) => (
            <li key={e.instrumentCode} className="text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link href={e.href} className="font-medium text-zinc-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-100">
                  {e.label}
                </Link>
                <MarketStateChip state={e.state} />
              </div>
              {e.facts.map((f, i) => (
                <span key={i} className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {f}
                </span>
              ))}
            </li>
          ))}
          {group.more > 0 && (
            <li className="text-xs text-zinc-400 dark:text-zinc-500">
              + {group.more} more{moreHref ? <>{" "}— <Link href={moreHref} className="underline hover:text-zinc-700 dark:hover:text-zinc-300">Market view</Link></> : ""}
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

export default async function FixedIncomeIntelligencePage() {
  const valuationDate = toValuationDate(new Date());
  const [workspace, treasury] = await Promise.all([getFixedIncomeWorkspace(valuationDate), getTreasurySnapshot()]);
  const { securities, comparables } = workspace;

  const gov = summarizeSegment(securities.filter((s) => s.classification === "SOVEREIGN"));
  const corp = summarizeSegment(securities.filter((s) => s.classification === "CORPORATE"));
  const landscape = buildYieldLandscape(securities, comparables, valuationDate);

  const allActive = gov.active + corp.active;
  const allRecent = gov.recent + corp.recent;
  const changes = buildWhatChanged(securities, workspace.billAuctions, valuationDate);
  const queue = buildAnalystQueue(securities, workspace.sovereignPool, valuationDate);

  return (
    <div className="space-y-9">
      <FixedIncomeNav asOf={formatIsoDate(workspace.valuationDateIso)} />

      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Ghana Fixed Income</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          What changed, what can be evaluated with reliable data, and what deserves attention next. Observed market data is kept separate from hypothetical scenarios; every figure carries its date.
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

      {/* -------------------------------------------------------- 2. What changed? */}
      <section aria-label="What changed">
        <SectionHeading title="What changed" question={`Dated changes in the last ${RECENT_WINDOW_DAYS} days, derived from stored observations. Nothing here is generated or scored.`} />
        {changes.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No material change in the last {RECENT_WINDOW_DAYS} days that the stored observations can support.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 border-y border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {changes.map((c) => (
              <li key={c.id} className="grid grid-cols-[5.5rem_1fr] gap-x-3 py-2 text-sm sm:grid-cols-[6.5rem_1fr]">
                <span className="pt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatIsoDate(c.eventDate)}</span>
                <div className="min-w-0">
                  <p className={c.tone === "caution" ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-800 dark:text-zinc-200"}>
                    {c.tone === "caution" && <span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
                    {c.headline}{" "}
                    {c.href && (
                      <Link href={c.href} className="whitespace-nowrap text-xs text-zinc-500 underline hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-zinc-100">
                        {c.href.startsWith("/fixed-income/") ? "Evidence →" : "Rates →"}
                      </Link>
                    )}
                  </p>
                  {c.detail && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{c.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Methodology summary="How is this determined?" className="mt-2">
          <p>
            Recent means within {RECENT_WINDOW_DAYS} days. A yield change is reported only between reliable trades no more than {BENCHMARK_DATE_WINDOW_DAYS} days apart, and only above {MATERIAL_YIELD_MOVE_BPS.CORPORATE} bps (corporate) or {MATERIAL_YIELD_MOVE_BPS.SOVEREIGN} bps (government) — the top quartile of consecutive-trade changes in our own history, because thin trading moves yields. Treasury-bill auctions are reported above {MATERIAL_BILL_MOVE_BPS} bps week on week. A bond becomes stale when its last reliable trade is more than {RECENT_WINDOW_DAYS} days old; it is reported for {JUST_STALE_WINDOW_DAYS} days after that.
          </p>
          <p>When a security has no earlier reliable trade to compare with, no change is stated.</p>
        </Methodology>
      </section>

      {/* -------------------------------------------------------- 3. Where do securities sit? */}
      <section aria-label="Ghana yield landscape">
        <SectionHeading
          title="Ghana Yield Landscape"
          question="Where do bills, government bonds and corporate bonds sit on remaining tenor and observed yield? One point per security, at its own latest observation."
          right={
            <Link href="/fixed-income/market#sovereign-curve" className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
              Detailed sovereign curve →
            </Link>
          }
        />
        <YieldLandscape points={landscape.points} withheld={landscape.withheld} notPlotted={landscape.notPlotted} comparables={comparables} />
        <p className="mt-3 max-w-4xl text-[11px] text-amber-700 dark:text-amber-400">
          Incomplete government universe: the securities master appears to omit some current post-DDEP bonds, so government points are not a full Ghana sovereign picture.
        </p>
      </section>

      {/* -------------------------------------------------------- 4. What deserves attention next? */}
      <section aria-label="Analyst queue">
        <SectionHeading title="Where to look next" question="What deserves attention — factual starting points, not recommendations." />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
          <QueueGroup title="New market activity" hint={`Reliable trades in the last ${RECENT_WINDOW_DAYS} days.`} group={queue.newActivity} empty="No reliable trade in the last 10 days." moreHref="/fixed-income/market#observed-yields" />
          <QueueGroup title="Needs investigation" hint="Data conflicts, yields far from their peers, corporate yields below the government observation, stale corporate quotes." group={queue.needsInvestigation} empty="Nothing is currently flagged." moreHref="/fixed-income/market#universe" />
          <QueueGroup title="Upcoming" hint={`Securities within ${MATURING_SOON_DAYS} days of maturity.`} group={queue.upcoming} empty={`No security matures within ${MATURING_SOON_DAYS} days.`} />
          <Panel title="Evaluate an issuer">
            <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">Compare all of an issuer&apos;s active bonds — observed market versus hypothetical purchase prices.</p>
            <div className="flex flex-wrap gap-1.5">
              {queue.issuers.map((name) => (
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
        <Methodology summary="How are these chosen?" className="mt-3">
          <p>
            Needs investigation lists a security when its source terms conflict with the securities master, its latest observation is withheld by a data check, a government yield sits {UNUSUAL_PEER_GAP_BPS.toLocaleString("en-GB")} bps or more from the median of other government trades within {PEER_WINDOW_DAYS} days (the 90th percentile of consecutive-trade changes), a corporate yield is below the date-matched government observation, or a corporate quote is stale. Being listed means the evidence is worth checking — it does not say a security is better or worse.
          </p>
        </Methodology>
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
