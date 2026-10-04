import Link from "next/link";
import { notFound } from "next/navigation";
import { getFixedIncomeWorkspace, getFixedIncomeObservationHistory, getFixedIncomeObservationRecords, type WorkspaceSecurity } from "@/lib/queries/fixed-income";
import {
  BENCHMARK_DATE_WINDOW_DAYS,
  buildDecisionSupport,
  buildSecurityInsights,
  comparePeerYield,
  computeBreakEvenCleanPrice,
  computePriceSensitivity,
  COUPON_FREQUENCY_LABEL,
  DEFAULT_PURCHASE_CHARGES,
  DEFAULT_SCENARIO_PRICES,
  formatBps,
  formatIsoDate,
  formatPct,
  formatTimeRemaining,
  generateCashFlows,
  issuerShortName,
  returnSensitivityBpsPerPoint,
  securityShortLabel,
  toValuationDate,
  type BenchmarkSelection,
  type ComparableRow,
} from "@/lib/fixed-income";
import { RatesChart } from "@/components/RatesChart";
import { InvestmentCalculator } from "@/components/fixed-income/InvestmentCalculator";
import { FindAlternatives } from "@/components/fixed-income/FindAlternatives";
import { PriceSensitivity } from "@/components/fixed-income/PriceSensitivity";
import { FixedIncomeNav } from "@/components/fixed-income/FixedIncomeNav";
import { DecisionPanel } from "@/components/fixed-income/DecisionPanel";
import { HashDisclosure } from "@/components/fixed-income/HashDisclosure";
import { Card, FreshnessBadge, HypotheticalBadge, LifecycleBadge, Methodology, ObservationKindBadge, QualityBadge, SectionHeading, SPREAD_METHOD_LONG, SPREAD_METHOD_SHORT, Stat } from "@/components/fixed-income/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Security analysis workspace (M7.3 §8, M7.3.1 §20, restructured again in
// M7.3.2 §9 as an investment story): identity → what the market last did →
// what return it offers (observed vs hypothetical) → relative value (government
// benchmark, comparables) → risk analytics → data quality & provenance
// (disclosed on demand, never leading, always one click away).
// ---------------------------------------------------------------------------

const ANCHORS = [
  ["analyst", "Analyst view"],
  ["market", "What the market did"],
  ["returns", "Return scenarios"],
  ["relative", "Relative value"],
  ["risk", "Risk"],
  ["evidence", "Data quality & provenance"],
] as const;

function benchmarkLabel(b: BenchmarkSelection, all: WorkspaceSecurity[]): string {
  const sec = b.benchmark.instrumentCode ? all.find((s) => s.instrumentCode === b.benchmark.instrumentCode) : undefined;
  return sec ? securityShortLabel(sec.issuerName, sec.couponRatePct, sec.maturityDate) : b.benchmark.instrumentLabel;
}

export default async function FixedIncomeSecurityPage({ params }: { params: Promise<{ instrumentCode: string }> }) {
  const { instrumentCode: raw } = await params;
  const instrumentCode = decodeURIComponent(raw).toUpperCase();

  const valuationDate = toValuationDate(new Date());
  const valuationIso = valuationDate.toISOString().slice(0, 10);
  const workspace = await getFixedIncomeWorkspace(valuationDate);
  const security = workspace.securities.find((s) => s.instrumentCode === instrumentCode);
  if (!security) notFound();

  const [history, records] = await Promise.all([getFixedIncomeObservationHistory(security.id), getFixedIncomeObservationRecords(security.id, 15)]);
  const { terms, analytics, benchmark, spreadBps, currentBenchmark } = security;
  const isMatured = security.lifecycle === "MATURED";
  const isCorporate = security.classification === "CORPORATE";
  const label = securityShortLabel(security.issuerName, security.couponRatePct, security.maturityDate);
  const hasMarket = security.latestObservationDate !== null;
  const reliable = security.analyticsEligible;
  const materialTerms = security.termsIssues.filter((i) => i.severity !== "INFO");

  // --- Scenario analytics (all from the shared engine) -------------------
  const defaultScenarios = computePriceSensitivity(terms, valuationDate, DEFAULT_SCENARIO_PRICES, DEFAULT_PURCHASE_CHARGES);
  const breakEven = computeBreakEvenCleanPrice(terms, valuationDate, DEFAULT_PURCHASE_CHARGES);
  const sensitivityBps = returnSensitivityBpsPerPoint(terms, valuationDate, DEFAULT_PURCHASE_CHARGES);
  const parScenario = defaultScenarios.ok ? defaultScenarios.scenarios.find((s) => s.cleanPrice === 100) : undefined;
  const insightBenchmark = benchmark ?? currentBenchmark;

  const insights = buildSecurityInsights({
    maturityDateIso: security.maturityDate,
    tenorDays: analytics.tenorDays,
    lifecycle: security.lifecycle,
    observation:
      hasMarket && analytics.observationKind
        ? { dateIso: security.latestObservationDate!, ageDays: security.observationAgeDays ?? 0, kind: analytics.observationKind, freshness: security.observationFreshness, cleanPrice: analytics.cleanPrice }
        : null,
    observationIssues: analytics.quality?.issues ?? [],
    carried: security.carriedPrice,
    noTradeRecordedSince: security.noTradeRecordedSince,
    termsIssues: security.termsIssues,
    ytmPct: reliable ? analytics.ytmPct : null,
    ytmSource: analytics.ytmSource,
    sourceQuotedYieldPct: analytics.sourceQuotedYieldPct,
    isCorporate,
    benchmark: insightBenchmark
      ? { label: benchmarkLabel(insightBenchmark, workspace.securities), yieldPct: insightBenchmark.benchmark.yieldPct, tenorGapDays: insightBenchmark.tenorGapDays, isWideGap: insightBenchmark.isWideGap }
      : null,
    spreadBps,
    scenarios: defaultScenarios.ok ? defaultScenarios.scenarios : [],
    breakEvenCleanPrice: breakEven.ok ? breakEven.breakEvenCleanPrice : null,
    sensitivityBpsPerPoint: sensitivityBps,
  });

  // Facts the analyst panel already states — dropped from the key-facts list so nothing is said twice.
  const COVERED_BY_ANALYST_PANEL = new Set(["maturity", "observation-age", "withheld", "spread", "benchmark-gap", "no-spread", "no-benchmark", "no-observation", "no-trade"]);
  const keyFacts = insights.filter((i) => !COVERED_BY_ANALYST_PANEL.has(i.id) && !i.id.startsWith("terms-"));

  const peer = reliable && security.classification === "SOVEREIGN" && analytics.observationKind === "SECONDARY_MARKET" && analytics.ytmPct !== null ? comparePeerYield(security.instrumentCode, security.latestObservationDate!, analytics.ytmPct, workspace.sovereignPool) : null;
  const support = buildDecisionSupport({
    security,
    peer,
    issuerSiblingCount: workspace.securities.filter((s) => s.issuerName === security.issuerName && s.instrumentCode !== security.instrumentCode && s.lifecycle !== "MATURED").length,
  });

  // --- Alternatives reference: reliable observed YTM, else hypothetical par return
  const referenceIsHypothetical = !reliable;
  const referenceYtm = reliable ? analytics.ytmPct : (parScenario?.returnPct ?? null);
  const targetComparableRow: ComparableRow = {
    instrumentCode: security.instrumentCode,
    instrumentName: security.instrumentName,
    issuerName: security.issuerName,
    classification: security.classification,
    instrumentType: security.instrumentType,
    maturityDate: security.maturityDate,
    couponRatePct: security.couponRatePct,
    tenorDays: analytics.tenorDays,
    ytmPct: referenceYtm,
    currentYieldPct: analytics.currentYieldPct,
    modifiedDurationYears: analytics.modifiedDurationYears,
    dv01: analytics.dv01,
    spreadBps,
    observationDate: security.latestObservationDate,
    observationKind: analytics.observationKind,
    freshness: security.observationFreshness,
    analyticsEligible: reliable,
  };
  const comparableUniverseExcludingSelf = workspace.comparables.filter((c) => c.instrumentCode !== security.instrumentCode);

  const lastRealTrade = records.find((r) => r.tradeStatus !== "NOT_TRADED") ?? null;
  const cashFlows = generateCashFlows(terms, valuationDate);
  const priceHistory = history.filter((h) => h.cleanPrice !== null).map((h) => ({ date: h.date, value: h.cleanPrice! }));
  const yieldHistory = history.filter((h) => h.yieldPct !== null).map((h) => ({ date: h.date, value: h.yieldPct! }));
  const observedPriceLabel =
    reliable && security.latestObservationDate ? `${analytics.observationKind === "SECONDARY_MARKET" ? "GFIM secondary trade" : "primary auction"}, ${formatIsoDate(security.latestObservationDate)}` : null;

  return (
    <div className="space-y-8">
      <FixedIncomeNav securityLabel={label} asOf={formatIsoDate(valuationIso)} />

      {/* ------------------------------------------------------------ 1. What is this? */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{label}</h1>
              <LifecycleBadge lifecycle={security.lifecycle} />
            </div>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {security.issuerName} · {isCorporate ? "Corporate bond" : "Government bond"} ·{" "}
              {security.couponType === "ZERO_COUPON"
                ? "zero coupon"
                : `${security.couponRatePct?.toFixed(2)}% ${security.couponFrequency ? COUPON_FREQUENCY_LABEL[security.couponFrequency].toLowerCase() : ""} coupon`}{" "}
              · matures {formatIsoDate(security.maturityDate)} ({formatTimeRemaining(analytics.tenorDays)})
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{security.isin ?? security.instrumentCode}</p>
          </div>
          {!isMatured && (
            <Link
              href={`/fixed-income/compare?issuer=${encodeURIComponent(security.issuerName)}`}
              className="rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Compare all {issuerShortName(security.issuerName)} bonds →
            </Link>
          )}
        </div>
        {materialTerms.length > 0 && (
          <div role="note" className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
            <span className="font-semibold">Terms need review.</span> {materialTerms.map((i) => i.detail).join(" ")} Every figure on this page uses the Securities Master terms.
          </div>
        )}
        {!isMatured && (
          <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 border-y border-zinc-100 py-1.5 text-xs dark:border-zinc-800">
            {ANCHORS.map(([id, text]) => (
              <a key={id} href={`#${id}`} className="text-zinc-500 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-zinc-100">
                {text}
              </a>
            ))}
          </nav>
        )}
      </div>

      {/* ------------------------------------------------------------ 2. Analyst view */}
      {!isMatured && (
        <section id="analyst" className="scroll-mt-4">
          <SectionHeading title="Analyst view" question="What is known, what stands out, what is not known, and what to investigate — built from stored facts only." />
          <DecisionPanel support={support} isCorporate={isCorporate} freshness={security.observationFreshness} observationKind={analytics.observationKind} />
        </section>
      )}

      {/* ------------------------------------------------------------ 3. What is the market saying? */}
      <section id="market" className="scroll-mt-4">
        <SectionHeading title="What the market last did" question="The latest real market observation — price, yield, date, and whether it can be relied on." />
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            {isMatured ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Matured on {formatIsoDate(security.maturityDate)} — no current market data.
                {lastRealTrade
                  ? ` Last recorded trade: ${lastRealTrade.cleanPrice?.toFixed(2) ?? "—"} on ${formatIsoDate(lastRealTrade.date)}.`
                  : " No trade is recorded in the observation history."}
                {security.observationAfterMaturity && " A record is dated on/after the master maturity date — kept for provenance (see Data quality & provenance) and excluded from analytics."}
              </p>
            ) : !hasMarket ? (
              <div>
                <p className="text-base font-medium text-zinc-800 dark:text-zinc-200">No market trade to rely on.</p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {security.noTradeRecordedSince
                    ? `GFIM reports no trade in any daily report since at least ${formatIsoDate(security.noTradeRecordedSince)}.${security.carriedPrice?.cleanPrice != null ? ` The ${security.carriedPrice.cleanPrice.toFixed(2)} it still publishes is carried from an earlier, unknown date — it is not a market price and is not used.` : ""}`
                    : "No price or yield has ever been observed for this security."}{" "}
                  Returns below are hypothetical purchase-price scenarios.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{analytics.observationKind === "AUCTION_PRIMARY" ? "Primary auction" : "Last traded"}</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatIsoDate(security.latestObservationDate!)}</span>
                  <span>({security.observationAgeDays} days ago)</span>
                  <ObservationKindBadge kind={analytics.observationKind} />
                  <FreshnessBadge freshness={security.observationFreshness} />
                  <QualityBadge status={analytics.quality?.status} issues={analytics.quality?.issues} />
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat
                    label="Observed YTM"
                    emphasis
                    value={analytics.ytmPct !== null ? <span className={reliable ? "" : "text-zinc-400 line-through"}>{formatPct(analytics.ytmPct)}</span> : "—"}
                    sub={analytics.ytmSource === "SOURCE_QUOTED" ? "as quoted by source" : "solved from the traded price"}
                  />
                  <Stat label="Traded price" emphasis value={analytics.cleanPrice !== null ? analytics.cleanPrice.toFixed(2) : "Not reported"} sub={analytics.dirtyPrice !== null ? `dirty ${analytics.dirtyPrice.toFixed(2)} at trade date` : undefined} />
                  <Stat label="Source yield" value={analytics.sourceQuotedYieldPct !== null ? formatPct(analytics.sourceQuotedYieldPct) : "Not published"} sub="GFIM's own figure" />
                  <Stat
                    label="Trade size (GHS)"
                    value={security.latestObservationVolumeGhs !== null ? security.latestObservationVolumeGhs.toLocaleString("en-GB", { maximumFractionDigits: 0 }) : "—"}
                    sub={security.latestObservationNumberOfTrades !== null ? `${security.latestObservationNumberOfTrades} trade${security.latestObservationNumberOfTrades === 1 ? "" : "s"}` : undefined}
                  />
                </div>
                {!reliable && analytics.quality && (
                  <div role="note" className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
                    <span className="font-semibold">{analytics.quality.status === "REVIEW" ? "Review required — " : "Excluded — "}withheld from the curve, spreads and alternatives.</span>{" "}
                    {analytics.quality.issues
                      .filter((i) => i.severity !== "INFO")
                      .map((i) => i.detail)
                      .join(" ")}
                  </div>
                )}
                {security.carriedPrice && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    GFIM has re-published a carried price ({security.carriedPrice.cleanPrice?.toFixed(2)}) through {formatIsoDate(security.carriedPrice.asOf)} without a new trade.
                  </p>
                )}
              </div>
            )}
          </Card>
          <Card className="lg:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Price &amp; return facts</p>
            {keyFacts.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No price or return facts apply — see the analyst view above.</p>}
            <ul className="space-y-1.5">
              {keyFacts.map((i) => (
                <li key={i.id} className="flex gap-2 text-sm">
                  <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i.tone === "caution" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                  <span className={i.tone === "caution" ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}>{i.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {!isMatured && (
        <>
          {/* ------------------------------------------------------------ 4. What return could we earn? */}
          <section id="returns" className="scroll-mt-4 space-y-3">
            <SectionHeading title="Return scenarios" question="What annualized return would we earn holding to maturity, depending on the price we pay? Hypothetical prices — the observed trade is marked separately." right={<HypotheticalBadge />} />
            <Card>
              <PriceSensitivity
                terms={terms}
                settlementDateIso={valuationIso}
                observedCleanPrice={reliable ? analytics.cleanPrice : null}
                observationDateIso={reliable ? security.latestObservationDate : null}
                observationKind={reliable ? analytics.observationKind : null}
              />
            </Card>

            <details className="rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-300">
                Dealer quote calculator — total cost after accrued interest and charges
              </summary>
              <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
                <InvestmentCalculator terms={terms} settlementDateIso={valuationIso} defaultPrice={reliable ? analytics.cleanPrice : null} defaultPriceLabel={observedPriceLabel} />
              </div>
            </details>
            <details className="rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-300">
                Remaining contractual cash flows per 100 face
              </summary>
              <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
                {cashFlows.ok ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800">
                          {["Payment date", "Coupon", "Principal", "Total"].map((h, i) => (
                            <th key={h} className={`px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${i > 0 ? "text-right" : ""}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cashFlows.flows.map((f, i) => (
                          <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                            <td className="whitespace-nowrap px-4 py-1.5 text-zinc-700 dark:text-zinc-300">{formatIsoDate(f.date.toISOString().slice(0, 10))}</td>
                            <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{f.coupon.toFixed(4)}</td>
                            <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{f.principal > 0 ? f.principal.toFixed(2) : "—"}</td>
                            <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{f.total.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{cashFlows.message}</p>
                )}
              </div>
            </details>
          </section>
          {/* ------------------------------------------------------------ 4. Relative value */}
          <section id="relative" className="scroll-mt-4">
            <SectionHeading title="Relative value" question="How does it compare with government securities, and what else offers a similar yield?" />
          {/* ------------------------------------------------------------ 3. How does it compare? */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Versus Government of Ghana</p>
            <Card>
              {!isCorporate ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Government of Ghana security — part of the sovereign curve that corporate spreads are measured against.</p>
              ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Observed spread · date-matched</p>
                    <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">{SPREAD_METHOD_SHORT}</p>
                    {benchmark && spreadBps !== null ? (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <Stat
                          label="Spread vs GoG"
                          emphasis
                          value={formatBps(spreadBps)}
                          sub={`${formatPct(analytics.ytmPct!)} (${formatIsoDate(security.latestObservationDate!)}) − ${formatPct(benchmark.benchmark.yieldPct)} (${formatIsoDate(benchmark.benchmark.observationDate)})`}
                        />
                        <Stat
                          label="Benchmark"
                          value={benchmarkLabel(benchmark, workspace.securities)}
                          sub={`${benchmark.benchmark.observationKind === "SECONDARY_MARKET" ? "Secondary trade" : "Primary auction"} · ${formatIsoDate(benchmark.benchmark.observationDate)}`}
                        />
                        <Stat
                          label="Match quality"
                          value={`${benchmark.tenorGapDays}d tenor gap`}
                          sub={
                            <span className={benchmark.isWideGap ? "text-amber-600 dark:text-amber-400" : undefined}>
                              {benchmark.observationGapDays} days between observations{benchmark.isWideGap ? " · wide gap, approximate" : ""}
                            </span>
                          }
                        />
                        <Methodology summary="How is this calculated?" className="col-span-full">
                          <p>{SPREAD_METHOD_LONG}</p>
                        </Methodology>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {reliable
                          ? `Suitable benchmark unavailable — no reliable Government of Ghana observation within ${BENCHMARK_DATE_WINDOW_DAYS} days of this trade, so no spread is shown.`
                          : "No spread: this security has no reliable market yield to compare."}
                      </p>
                    )}
                  </div>
                  <div className="lg:border-l lg:border-zinc-100 lg:pl-6 dark:lg:border-zinc-800">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Reference GoG yield · context only, not a spread</p>
                    {currentBenchmark ? (
                      <div className="grid grid-cols-2 gap-4">
                        <Stat
                          label="Nearest-tenor GoG today"
                          value={formatPct(currentBenchmark.benchmark.yieldPct)}
                          sub={`${benchmarkLabel(currentBenchmark, workspace.securities)} · ${formatIsoDate(currentBenchmark.benchmark.observationDate)}`}
                        />
                        {parScenario?.returnPct != null && (
                          <Stat
                            label={
                              <span className="inline-flex items-center gap-1">
                                Hypothetical return @100 − reference <HypotheticalBadge />
                              </span>
                            }
                            value={formatBps(Math.round((parScenario.returnPct - currentBenchmark.benchmark.yieldPct) * 100))}
                            sub={`${formatPct(parScenario.returnPct)} at a hypothetical price of 100`}
                          />
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Suitable benchmark unavailable.</p>
                    )}
                    {currentBenchmark && (
                      <Methodology summary="Why is this not a spread?" className="mt-2">
                        <p>
                          A reference yield is today&apos;s nearest-tenor government figure ({currentBenchmark.tenorGapDays} days of tenor gap) shown to set hypothetical returns against. It is only a spread when this security itself has a reliable, date-matched observation (left).
                        </p>
                      </Methodology>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>          {/* ------------------------------------------------------------ 7. Alternatives */}
          <div className="mt-5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Potential comparables — similar yield is not similar risk</p>
            <Card>
              <FindAlternatives
                target={targetComparableRow}
                universe={comparableUniverseExcludingSelf}
                referenceLabel={referenceIsHypothetical ? "hypothetical return at price 100" : "observed YTM"}
                referenceIsHypothetical={referenceIsHypothetical}
              />
            </Card>
          </div>          </section>

          {/* ------------------------------------------------------------ 5. Risk */}
          <section id="risk" className="scroll-mt-4">
            <SectionHeading title="Risk analytics" question="How sensitive is the price to interest rates? Measured at the observed yield, so only available when that yield is reliable." />
            <Card>
              {reliable && analytics.macaulayDurationYears !== null ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Modified duration" emphasis value={`${analytics.modifiedDurationYears!.toFixed(2)}y`} sub="% price change per 1% yield" />
                  <Stat label="DV01 / 100" emphasis value={analytics.dv01!.toFixed(4)} sub="price change per 1 bp" />
                  <Stat label="Macaulay duration" value={`${analytics.macaulayDurationYears.toFixed(2)}y`} />
                  <Stat label="Convexity" value={analytics.convexityYears2 !== null ? analytics.convexityYears2.toFixed(3) : "—"} />
                </div>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Not shown — duration and DV01 require a reliable observed yield, and this security has none.</p>
              )}
            </Card>
          </section>
        </>
      )}

      {/* ------------------------------------------------------------ 8. Technical & provenance */}
      <section id="evidence" className="scroll-mt-4">
        <SectionHeading title="Data quality & provenance" question="Identifiers, terms checks, and exactly where each observation came from." />
        <HashDisclosure id="evidence" className="rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-300">
            Show identifiers, quality checks and observation records ({records.length})
          </summary>
          <div className="space-y-4 border-t border-zinc-100 p-4 dark:border-zinc-800">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Identifiers & master terms</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="ISIN" value={<span className="font-mono text-sm">{security.isin ?? "—"}</span>} />
                  <Stat label="Issue date" value={formatIsoDate(security.issueDate)} />
                  <Stat label="Master status" value={security.status} sub="lifecycle derived from maturity" />
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Observation records (newest first)</p>
              {records.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No observations recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        <th className="py-1.5 pr-3 font-medium">Date</th>
                        <th className="py-1.5 pr-3 font-medium">Status</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Price</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Source yield</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Volume (GHS)</th>
                        <th className="py-1.5 pr-3 font-medium">Source description</th>
                        <th className="py-1.5 font-medium">Source · run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.date} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                          <td className="whitespace-nowrap py-1.5 pr-3 text-zinc-700 dark:text-zinc-300">{formatIsoDate(r.date)}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">
                            {r.tradeStatus === "TRADED"
                              ? `Traded${r.numberOfTrades ? ` (${r.numberOfTrades})` : ""}`
                              : r.tradeStatus === "NOT_TRADED"
                                ? "Carried price · no trade"
                                : r.observationKind === "AUCTION_PRIMARY"
                                  ? "Primary auction"
                                  : "Reported"}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{r.cleanPrice?.toFixed(4) ?? "—"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{r.sourceYieldPct !== null ? formatPct(r.sourceYieldPct) : "—"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{r.volumeTradedGhs !== null ? r.volumeTradedGhs.toLocaleString("en-GB") : "—"}</td>
                          <td className="py-1.5 pr-3 font-mono text-zinc-500 dark:text-zinc-400">{r.sourceSecurityDescription ?? "—"}</td>
                          <td className="py-1.5 text-zinc-500 dark:text-zinc-400">
                            {r.sourceName} · <span className="font-mono">{r.ingestionRunId.slice(-8)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {(priceHistory.length > 1 || yieldHistory.length > 1) && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {priceHistory.length > 1 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Traded price history</p>
                    <RatesChart series={[{ key: "price", label: "Clean price", color: "#3b82f6", data: priceHistory }]} unit="per 100 face" defaultWindow="MAX" />
                  </div>
                )}
                {yieldHistory.length > 1 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source-quoted yield history</p>
                    <RatesChart series={[{ key: "yield", label: "Yield", color: "#f59e0b", data: yieldHistory }]} unit="%" defaultWindow="MAX" />
                  </div>
                )}
              </div>
            )}
          </div>
        </HashDisclosure>
      </section>
    </div>
  );
}
