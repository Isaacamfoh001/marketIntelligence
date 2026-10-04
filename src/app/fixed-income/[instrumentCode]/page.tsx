import Link from "next/link";
import { notFound } from "next/navigation";
import { getFixedIncomeWorkspace, getFixedIncomeObservationHistory } from "@/lib/queries/fixed-income";
import {
  buildSecurityInsights,
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
  type ComparableRow,
} from "@/lib/fixed-income";
import { RatesChart } from "@/components/RatesChart";
import { InvestmentCalculator } from "@/components/fixed-income/InvestmentCalculator";
import { FindAlternatives } from "@/components/fixed-income/FindAlternatives";
import { PriceSensitivity } from "@/components/fixed-income/PriceSensitivity";
import { Card, FreshnessBadge, HypotheticalBadge, LifecycleBadge, ObservationKindBadge, SectionHeading, Stat } from "@/components/fixed-income/ui";

export const dynamic = "force-dynamic";

function formatVolumeGhs(value: number): string {
  return `GHS ${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function GroupLabel({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "emerald" | "blue" }) {
  const color = tone === "emerald" ? "text-emerald-700 dark:text-emerald-400" : tone === "blue" ? "text-blue-700 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400";
  return <p className={`mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${color}`}>{children}</p>;
}

export default async function FixedIncomeSecurityPage({ params }: { params: Promise<{ instrumentCode: string }> }) {
  const { instrumentCode: raw } = await params;
  const instrumentCode = decodeURIComponent(raw).toUpperCase();

  const valuationDate = toValuationDate(new Date());
  const valuationIso = valuationDate.toISOString().slice(0, 10);
  const workspace = await getFixedIncomeWorkspace(valuationDate);
  const security = workspace.securities.find((s) => s.instrumentCode === instrumentCode);
  if (!security) notFound();

  const history = await getFixedIncomeObservationHistory(security.id);
  const { terms, analytics, benchmark, spreadBps } = security;
  const isMatured = security.lifecycle === "MATURED";
  const isCorporate = security.classification === "CORPORATE";
  const label = securityShortLabel(security.issuerName, security.couponRatePct, security.maturityDate);

  // Benchmarks that are themselves GoG bonds get the same short label as everywhere else ("GoG 19.00% Nov-26"); T-bills keep their name.
  const benchmarkSecurity = benchmark?.benchmark.instrumentCode ? workspace.securities.find((s) => s.instrumentCode === benchmark.benchmark.instrumentCode) : undefined;
  const benchmarkLabel = benchmark
    ? benchmarkSecurity
      ? securityShortLabel(benchmarkSecurity.issuerName, benchmarkSecurity.couponRatePct, benchmarkSecurity.maturityDate)
      : benchmark.benchmark.instrumentLabel
    : null;

  // --- Scenario analytics (all from the shared engine) -------------------
  const defaultScenarios = computePriceSensitivity(terms, valuationDate, DEFAULT_SCENARIO_PRICES, DEFAULT_PURCHASE_CHARGES);
  const breakEven = computeBreakEvenCleanPrice(terms, valuationDate, DEFAULT_PURCHASE_CHARGES);
  const sensitivityBps = returnSensitivityBpsPerPoint(terms, valuationDate, DEFAULT_PURCHASE_CHARGES);
  const parScenario = defaultScenarios.ok ? defaultScenarios.scenarios.find((s) => s.cleanPrice === 100) : undefined;

  const insights = buildSecurityInsights({
    maturityDateIso: security.maturityDate,
    tenorDays: analytics.tenorDays,
    lifecycle: security.lifecycle,
    observation:
      security.latestObservationDate && analytics.observationKind
        ? {
            dateIso: security.latestObservationDate,
            ageDays: security.observationAgeDays ?? 0,
            kind: analytics.observationKind,
            freshness: security.observationFreshness,
            cleanPrice: analytics.cleanPrice,
          }
        : null,
    ytmPct: analytics.ytmPct,
    ytmSource: analytics.ytmSource,
    sourceQuotedYieldPct: analytics.sourceQuotedYieldPct,
    isCorporate,
    benchmark: benchmark ? { label: benchmarkLabel!, yieldPct: benchmark.benchmark.yieldPct, tenorGapDays: benchmark.tenorGapDays, isWideGap: benchmark.isWideGap } : null,
    spreadBps,
    scenarios: defaultScenarios.ok ? defaultScenarios.scenarios : [],
    breakEvenCleanPrice: breakEven.ok ? breakEven.breakEvenCleanPrice : null,
    sensitivityBpsPerPoint: sensitivityBps,
  });

  // --- Find Alternatives reference: observed YTM, else hypothetical par return
  const referenceIsHypothetical = analytics.ytmPct === null;
  const referenceYtm = analytics.ytmPct ?? parScenario?.returnPct ?? null;
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
  };
  const comparableUniverseExcludingSelf = workspace.comparables.filter((c) => c.instrumentCode !== security.instrumentCode);

  const cashFlows = generateCashFlows(terms, valuationDate);
  const priceHistory = history.filter((h) => h.cleanPrice !== null).map((h) => ({ date: h.date, value: h.cleanPrice! }));
  const yieldHistory = history.filter((h) => h.yieldPct !== null).map((h) => ({ date: h.date, value: h.yieldPct! }));
  const observationLabel = security.latestObservationDate
    ? `${analytics.observationKind === "SECONDARY_MARKET" ? "GFIM secondary trade" : "primary auction"}, ${formatIsoDate(security.latestObservationDate)}`
    : null;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ Header */}
      <div>
        <Link href="/fixed-income" className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300">
          ← Fixed Income
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{label}</h1>
              <LifecycleBadge lifecycle={security.lifecycle} />
            </div>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {security.issuerName} · {isCorporate ? "Corporate Bond" : "Government Bond"} · {security.currency}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
              {security.instrumentCode}
              {security.isin && security.isin !== security.instrumentCode && <> · ISIN {security.isin}</>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Calculations as of {formatIsoDate(valuationIso)}</span>
            {!isMatured && (
              <Link
                href={`/fixed-income/compare?issuer=${encodeURIComponent(security.issuerName)}`}
                className="rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Compare all {issuerShortName(security.issuerName)} bonds →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ Summary strip */}
      <Card className="p-0">
        <div className="grid grid-cols-1 divide-y divide-zinc-100 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-zinc-800">
          <div className="p-4 lg:col-span-4">
            <GroupLabel>Contractual terms</GroupLabel>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Coupon"
                value={security.couponType === "ZERO_COUPON" ? "Zero" : `${security.couponRatePct?.toFixed(2) ?? "—"}%${security.couponType === "FLOATING" ? " (ref.)" : ""}`}
                sub={security.couponFrequency ? COUPON_FREQUENCY_LABEL[security.couponFrequency] : undefined}
              />
              <Stat label="Remaining" value={formatTimeRemaining(analytics.tenorDays)} sub={isMatured || analytics.tenorDays <= 92 ? undefined : `${analytics.tenorDays} days`} />
              <Stat label="Maturity" value={formatIsoDate(security.maturityDate)} sub="principal repaid" />
            </div>
          </div>

          <div className="p-4 lg:col-span-4">
            <GroupLabel tone="emerald">
              Latest observed market data
              {!isMatured && analytics.observationKind && <ObservationKindBadge kind={analytics.observationKind} />}
              {!isMatured && <FreshnessBadge freshness={security.observationFreshness} />}
            </GroupLabel>
            {isMatured ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                Matured — no current market data.
                {security.latestObservationDate && ` Final known observation: ${formatIsoDate(security.latestObservationDate)}${security.latestObservationCleanPrice !== null ? ` at ${security.latestObservationCleanPrice.toFixed(2)}` : ""}.`}
                {security.observationAfterMaturity && (
                  <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                    This observation is dated after the contractual maturity, which a real trade cannot be — verify the source mapping in the Data Centre.
                  </span>
                )}
              </p>
            ) : !security.latestObservationDate ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                <p className="font-medium text-zinc-700 dark:text-zinc-300">Terms known, but no market quote.</p>
                <p className="mt-1 text-xs">No price or yield has been observed for this security. Returns below are hypothetical purchase-price scenarios.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Observed YTM" emphasis value={analytics.ytmPct !== null ? formatPct(analytics.ytmPct) : "—"} sub={analytics.ytmSource === "SOURCE_QUOTED" ? "source-quoted" : "Korbly, solved from price"} />
                <Stat label="Clean price" value={analytics.cleanPrice !== null ? analytics.cleanPrice.toFixed(4) : "Not reported"} sub={analytics.dirtyPrice !== null ? `dirty ${analytics.dirtyPrice.toFixed(4)}` : undefined} />
                <Stat label="Source yield" value={analytics.sourceQuotedYieldPct !== null ? formatPct(analytics.sourceQuotedYieldPct) : "Not reported"} sub="as published by GFIM" />
                <Stat label="Observed" value={formatIsoDate(security.latestObservationDate)} sub={security.observationAgeDays !== null ? `${security.observationAgeDays} day${security.observationAgeDays === 1 ? "" : "s"} old` : undefined} />
              </div>
            )}
          </div>

          <div className="p-4 lg:col-span-4">
            <GroupLabel tone="blue">Sovereign comparison</GroupLabel>
            {!isCorporate ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Government of Ghana security — part of the sovereign curve that corporate spreads are measured against.</p>
            ) : isMatured ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">Not applicable after maturity.</p>
            ) : !benchmark ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">Spread unavailable because no suitable sovereign benchmark exists.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Additional yield" emphasis value={spreadBps !== null ? formatBps(spreadBps) : "—"} sub={spreadBps !== null ? "observed YTM − benchmark" : "needs an observed yield"} />
                <Stat
                  label="GoG benchmark"
                  value={formatPct(benchmark.benchmark.yieldPct)}
                  sub={
                    <span className={benchmark.isWideGap ? "text-amber-600 dark:text-amber-400" : undefined}>
                      {benchmarkLabel} · gap {benchmark.tenorGapDays}d
                    </span>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------ Key facts */}
      <section>
        <SectionHeading title="Key Facts" question="Factual observations derived from the data on this page — not recommendations." />
        <Card>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
            {insights.map((i) => (
              <li key={i.id} className="flex gap-2 text-sm">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i.tone === "caution" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                <span className={i.tone === "caution" ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}>{i.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {isMatured ? (
        <Card>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This security matured on {formatIsoDate(security.maturityDate)}. Purchase-price scenarios, the dealer-quote calculator and alternatives apply only to outstanding securities.
          </p>
        </Card>
      ) : (
        <>
          {/* ------------------------------------------------------------ Price sensitivity */}
          <section>
            <SectionHeading
              title="Purchase Price Sensitivity"
              question="What annualized return would we earn holding to maturity, depending on the price we pay?"
              right={<HypotheticalBadge />}
            />
            <Card>
              <PriceSensitivity
                terms={terms}
                settlementDateIso={valuationIso}
                observedCleanPrice={analytics.cleanPrice}
                observationDateIso={security.latestObservationDate}
                observationKind={analytics.observationKind}
              />
            </Card>
          </section>

          {/* ------------------------------------------------------------ Dealer quote */}
          <section>
            <SectionHeading title="Dealer Quote Calculator" question="What would an actual dealer quote cost after accrued interest and charges, and what would it return?" />
            <Card>
              <InvestmentCalculator terms={terms} settlementDateIso={valuationIso} defaultPrice={analytics.cleanPrice} defaultPriceLabel={observationLabel} />
            </Card>
          </section>

          {/* ------------------------------------------------------------ Sovereign detail */}
          {isCorporate && benchmark && (
            <section>
              <SectionHeading title="Government Benchmark Detail" question="What additional yield does this corporate exposure pay over a comparable Government of Ghana security?" />
              <Card>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Corporate YTM" value={analytics.ytmPct !== null ? formatPct(analytics.ytmPct) : "No market yield"} sub={analytics.observationKind === "SECONDARY_MARKET" ? "secondary-market trade" : analytics.observationKind ? "primary auction" : undefined} />
                  <Stat label="Comparable GoG" value={formatPct(benchmark.benchmark.yieldPct)} sub={benchmarkLabel} />
                  <Stat label="Additional yield" value={spreadBps !== null ? formatBps(spreadBps) : "—"} />
                  <Stat label="Benchmark tenor" value={formatTimeRemaining(benchmark.benchmark.tenorDays)} sub={`vs ${formatTimeRemaining(analytics.tenorDays)} for this bond`} />
                  <Stat label="Tenor gap" value={`${benchmark.tenorGapDays} days`} sub={benchmark.isWideGap ? "wide — approximate" : "closely matched"} />
                  <Stat
                    label="Benchmark observed"
                    value={formatIsoDate(benchmark.benchmark.observationDate)}
                    sub={benchmark.benchmark.observationKind === "SECONDARY_MARKET" ? "secondary market" : "primary auction"}
                  />
                </div>
                {spreadBps === null && parScenario?.returnPct != null && (
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    No market yield exists, so no observed spread. For reference only: the hypothetical return at price 100 ({formatPct(parScenario.returnPct)}) would be{" "}
                    {formatBps(Math.round((parScenario.returnPct - benchmark.benchmark.yieldPct) * 100))} versus this benchmark.
                  </p>
                )}
                {benchmark.isWideGap && (
                  <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                    No sovereign instrument with a closely matched remaining tenor is available — the spread compares across a wide maturity gap and is approximate.
                  </p>
                )}
                {!benchmark.isSecondaryBenchmark && analytics.observationKind === "SECONDARY_MARKET" && (
                  <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                    No sovereign secondary-market yield is available — this compares a secondary-market yield with a primary auction rate.
                  </p>
                )}
              </Card>
            </section>
          )}

          {/* ------------------------------------------------------------ Alternatives */}
          <section>
            <SectionHeading title="Find Alternatives" question="Which other outstanding fixed-income securities offer similar returns or maturities?" />
            <Card>
              <FindAlternatives
                target={targetComparableRow}
                universe={comparableUniverseExcludingSelf}
                referenceLabel={referenceIsHypothetical ? "scenario return at price 100" : "observed YTM"}
                referenceIsHypothetical={referenceIsHypothetical}
              />
            </Card>
          </section>
        </>
      )}

      {/* ------------------------------------------------------------ Reference */}
      <section>
        <SectionHeading title="Reference Data" question="Contractual details, interest-rate sensitivity, and the per-100 cash-flow schedule." />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card>
            <GroupLabel>Contractual characteristics</GroupLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Issue date" value={formatIsoDate(security.issueDate)} />
              <Stat label="Coupon type" value={security.couponType.replace("_", " ")} />
              <Stat label="Face value" value={security.faceValue.toFixed(2)} sub="per-100 quoting" />
              <Stat label="ISIN" value={<span className="font-mono text-sm">{security.isin ?? "—"}</span>} />
              <Stat label="Currency" value={security.currency} />
              <Stat label="Master status" value={security.status} sub="as imported; lifecycle derived from maturity" />
            </div>
          </Card>
          <Card>
            <GroupLabel>Interest-rate sensitivity (at observed yield)</GroupLabel>
            {analytics.macaulayDurationYears === null ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">Not available — requires an observed price or yield.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Macaulay duration" value={`${analytics.macaulayDurationYears.toFixed(2)}y`} />
                <Stat label="Modified duration" value={`${analytics.modifiedDurationYears!.toFixed(2)}y`} />
                <Stat label="DV01 (per 100)" value={analytics.dv01!.toFixed(4)} sub="price change per 1bp" />
                <Stat label="Convexity" value={analytics.convexityYears2 !== null ? analytics.convexityYears2.toFixed(3) : "—"} />
                <Stat label="Current yield" value={analytics.currentYieldPct !== null ? formatPct(analytics.currentYieldPct) : "—"} sub="coupon ÷ clean price" />
                <Stat
                  label="Volume traded"
                  value={security.latestObservationVolumeGhs !== null ? formatVolumeGhs(security.latestObservationVolumeGhs) : "Not reported"}
                  sub={security.latestObservationVolumeGhs !== null ? "GFIM reported trade value" : undefined}
                />
              </div>
            )}
          </Card>
        </div>

        {cashFlows.ok && (
          <details className="mt-3 rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">Remaining cash-flow schedule per 100 face ({cashFlows.flows.length})</summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-y border-zinc-200 dark:border-zinc-800">
                    <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Coupon</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Principal</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlows.flows.map((f, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                      <td className="whitespace-nowrap px-4 py-1.5 text-zinc-600 dark:text-zinc-400">{formatIsoDate(f.date.toISOString().slice(0, 10))}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{f.coupon.toFixed(4)}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{f.principal.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{f.total.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {(priceHistory.length > 0 || yieldHistory.length > 0) && (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {priceHistory.length > 0 && (
              <Card>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Observed clean price history</p>
                <RatesChart series={[{ key: "price", label: "Clean Price", color: "#3b82f6", data: priceHistory }]} unit="per 100 face" defaultWindow="MAX" />
              </Card>
            )}
            {yieldHistory.length > 0 && (
              <Card>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source-quoted yield history</p>
                <RatesChart series={[{ key: "yield", label: "Yield", color: "#f59e0b", data: yieldHistory }]} unit="%" defaultWindow="MAX" />
              </Card>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
