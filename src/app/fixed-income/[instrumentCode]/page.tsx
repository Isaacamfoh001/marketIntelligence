import Link from "next/link";
import { notFound } from "next/navigation";
import { getFixedIncomeSecurityByCode, getFixedIncomeObservationHistory, getSovereignYieldCurve, getComparableUniverse } from "@/lib/queries/fixed-income";
import { generateCashFlows, selectBenchmark, computeSpreadBps, COUPON_FREQUENCY_LABEL, type BondTerms, type ComparableRow } from "@/lib/fixed-income";
import { dailyFreshness, type Freshness } from "@/lib/freshness";
import { RatesChart } from "@/components/RatesChart";
import { InvestmentCalculator } from "@/components/fixed-income/InvestmentCalculator";
import { FindAlternatives } from "@/components/fixed-income/FindAlternatives";

export const dynamic = "force-dynamic";

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

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatTenor(tenorDays: number): string {
  if (tenorDays <= 0) return "Matured";
  if (tenorDays < 365) return `${tenorDays} days`;
  return `${(tenorDays / 365).toFixed(1)} years`;
}

function formatVolumeGhs(value: number): string {
  return `GHS ${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/**
 * Observation-freshness label for a single security's latest trade/auction
 * date (M7.2 §7). Deliberately reuses dailyFreshness rather than inventing
 * a liquidity score — "STALE" here means exactly what it means on the rest
 * of the platform: no observation within the last business day. An
 * illiquid bond that simply hasn't traded in weeks is expected to show
 * STALE honestly, not be forward-filled as current.
 */
function observationFreshnessLabel(latestObservationDate: string | null, now: Date): { text: string; className: string } {
  const freshness: Freshness = dailyFreshness(latestObservationDate ? new Date(`${latestObservationDate}T00:00:00.000Z`) : null, now);
  if (freshness === "MISSING") {
    return { text: "No market observation", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
  }
  if (freshness === "STALE") {
    return { text: "Stale observation", className: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
  }
  return { text: "Recent observation", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
}

export default async function FixedIncomeSecurityPage({ params }: { params: Promise<{ instrumentCode: string }> }) {
  const { instrumentCode: raw } = await params;
  const instrumentCode = decodeURIComponent(raw).toUpperCase();

  const settlementDate = new Date();
  const security = await getFixedIncomeSecurityByCode(instrumentCode, settlementDate);
  if (!security) notFound();

  const terms: BondTerms = {
    issueDate: new Date(`${security.issueDate}T00:00:00.000Z`),
    maturityDate: new Date(`${security.maturityDate}T00:00:00.000Z`),
    couponType: security.couponType,
    couponRatePct: security.couponRatePct,
    couponFrequency: security.couponFrequency,
    faceValue: security.faceValue,
  };

  const [history, curve, comparables] = await Promise.all([
    getFixedIncomeObservationHistory(security.id),
    getSovereignYieldCurve(settlementDate),
    getComparableUniverse(settlementDate),
  ]);

  const cashFlows = generateCashFlows(terms, settlementDate);

  const benchmark =
    security.classification === "CORPORATE" && security.analytics.ytmPct !== null
      ? selectBenchmark(security.analytics.tenorDays, curve)
      : null;
  const spreadBps = benchmark && security.analytics.ytmPct !== null ? computeSpreadBps(security.analytics.ytmPct, benchmark.benchmark.yieldPct) : null;

  const priceHistory = history.filter((h) => h.cleanPrice !== null).map((h) => ({ date: h.date, value: h.cleanPrice! }));
  const yieldHistory = history.filter((h) => h.yieldPct !== null).map((h) => ({ date: h.date, value: h.yieldPct! }));

  const targetComparableRow: ComparableRow = {
    instrumentCode: security.instrumentCode,
    instrumentName: security.instrumentName,
    issuerName: security.issuerName,
    classification: security.classification,
    instrumentType: security.instrumentType,
    maturityDate: security.maturityDate,
    tenorDays: security.analytics.tenorDays,
    ytmPct: security.analytics.ytmPct,
    currentYieldPct: security.analytics.currentYieldPct,
    modifiedDurationYears: security.analytics.modifiedDurationYears,
    dv01: security.analytics.dv01,
    spreadBps,
    observationDate: security.latestObservationDate,
    observationKind: security.analytics.observationKind,
  };
  const comparableUniverseExcludingSelf = comparables.filter((c) => c.instrumentCode !== security.instrumentCode);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/fixed-income" className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300">
          ← Fixed Income
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{security.instrumentName}</h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {security.instrumentCode} · {security.issuerName} · {security.classification === "SOVEREIGN" ? "Government Bond" : "Corporate Bond"}
              {security.isin && security.isin !== security.instrumentCode && <> · ISIN {security.isin}</>}
              {security.status !== "ACTIVE" && <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{security.status}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Contractual Characteristics</h2>
        <SectionCard>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatBlock label="Issue Date" value={formatDate(security.issueDate)} />
            <StatBlock label="Maturity Date" value={formatDate(security.maturityDate)} />
            <StatBlock label="Remaining Tenor" value={formatTenor(security.analytics.tenorDays)} />
            <StatBlock
              label="Coupon"
              value={
                security.couponType === "ZERO_COUPON"
                  ? "Zero coupon"
                  : `${security.couponRatePct?.toFixed(2) ?? "—"}%${security.couponType === "FLOATING" ? " (ref.)" : ""}`
              }
              sub={security.couponFrequency ? COUPON_FREQUENCY_LABEL[security.couponFrequency] : security.couponType === "ZERO_COUPON" ? "No periodic coupon" : undefined}
            />
            <StatBlock label="Face Value" value={`GHS ${security.faceValue.toFixed(2)}`} sub="per 100 par-quoting convention" />
            <StatBlock label="ISIN" value={security.isin ?? "—"} />
            <StatBlock label="Currency" value={security.currency} />
            <StatBlock label="Coupon Type" value={security.couponType.replace("_", " ")} />
            <StatBlock label="Status" value={security.status} />
          </div>
        </SectionCard>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Latest Market Data &amp; Yield Analytics
          {security.analytics.observationKind && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${
                security.analytics.observationKind === "AUCTION_PRIMARY"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {security.analytics.observationKind === "AUCTION_PRIMARY" ? "Primary Auction" : "Secondary Market"}
            </span>
          )}
          {(() => {
            const freshness = observationFreshnessLabel(security.latestObservationDate, settlementDate);
            return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${freshness.className}`}>{freshness.text}</span>;
          })()}
          {security.latestObservationDate && <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-500">as of {formatDate(security.latestObservationDate)}</span>}
        </h2>
        {security.analytics.unavailableReason ? (
          <SectionCard>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{security.analytics.unavailableMessage}</p>
          </SectionCard>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock
                  label="Clean Price"
                  value={security.analytics.cleanPrice !== null ? security.analytics.cleanPrice.toFixed(2) : "—"}
                  sub={security.latestObservationDate ? formatDate(security.latestObservationDate) : undefined}
                />
                <StatBlock label="Dirty Price" value={security.analytics.dirtyPrice !== null ? security.analytics.dirtyPrice.toFixed(2) : "—"} sub="clean + accrued interest" />
              </div>
            </SectionCard>
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock label="Current Yield" value={security.analytics.currentYieldPct !== null ? `${security.analytics.currentYieldPct.toFixed(2)}%` : "—"} />
                <StatBlock
                  label="Yield to Maturity"
                  value={security.analytics.ytmPct !== null ? `${security.analytics.ytmPct.toFixed(2)}%` : "—"}
                  sub={security.analytics.ytmSource === "SOURCE_QUOTED" ? "source-quoted, not solved from price" : security.analytics.ytmSource === "SOLVED_FROM_PRICE" ? "solved from market price" : undefined}
                />
              </div>
              {security.analytics.ytmSource === "SOLVED_FROM_PRICE" && security.analytics.sourceQuotedYieldPct !== null && (
                <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  GFIM&apos;s own quoted closing yield for this trade: <span className="font-medium text-zinc-700 dark:text-zinc-300">{security.analytics.sourceQuotedYieldPct.toFixed(2)}%</span> — shown alongside
                  the {security.analytics.ytmPct!.toFixed(2)}% above, which Korbly solves from the traded clean price using the bond&apos;s actual cash-flow schedule.
                </p>
              )}
            </SectionCard>
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock label="Accrued Interest" value={security.analytics.accruedInterest !== null ? security.analytics.accruedInterest.toFixed(4) : "—"} />
                <StatBlock
                  label="Volume Traded"
                  value={security.latestObservationVolumeGhs !== null ? formatVolumeGhs(security.latestObservationVolumeGhs) : "—"}
                  sub={
                    security.latestObservationVolumeGhs !== null
                      ? "GFIM reported trade value"
                      : security.analytics.observationKind === "SECONDARY_MARKET"
                        ? "not reported by source for this trade"
                        : undefined
                  }
                />
              </div>
            </SectionCard>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Duration &amp; Interest-Rate Sensitivity</h2>
        {security.analytics.macaulayDurationYears === null ? (
          <SectionCard>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Not applicable — requires a usable price or yield observation.</p>
          </SectionCard>
        ) : (
          <SectionCard>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatBlock label="Macaulay Duration" value={`${security.analytics.macaulayDurationYears.toFixed(2)}y`} />
              <StatBlock label="Modified Duration" value={`${security.analytics.modifiedDurationYears!.toFixed(2)}y`} />
              <StatBlock label="DV01 (per 100 face)" value={security.analytics.dv01!.toFixed(4)} sub="price change per 1bp yield move" />
              <StatBlock label="Convexity" value={security.analytics.convexityYears2 !== null ? security.analytics.convexityYears2.toFixed(3) : "—"} />
            </div>
          </SectionCard>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {security.classification === "CORPORATE" && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Sovereign Spread</h2>
          {!benchmark || spreadBps === null ? (
            <SectionCard>
              <p className="text-sm text-zinc-400 dark:text-zinc-500">Not available — requires a computed YTM and at least one sovereign yield-curve point.</p>
            </SectionCard>
          ) : (
            <SectionCard>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatBlock
                  label="This Security's YTM"
                  value={`${security.analytics.ytmPct!.toFixed(2)}%`}
                  sub={security.analytics.observationKind === "SECONDARY_MARKET" ? "from secondary-market trade" : "from primary auction"}
                />
                <StatBlock
                  label="Benchmark"
                  value={benchmark.benchmark.instrumentLabel}
                  sub={`${benchmark.benchmark.yieldPct.toFixed(2)}% · ${benchmark.benchmark.tenorLabel} tenor · ${benchmark.benchmark.observationKind === "SECONDARY_MARKET" ? "secondary-market" : "primary auction"} rate (${formatDate(benchmark.benchmark.observationDate)})`}
                />
                <StatBlock label="Spread" value={`${spreadBps >= 0 ? "+" : ""}${spreadBps} bps`} />
                <StatBlock label="Tenor Gap" value={`${benchmark.tenorGapDays} days`} sub={benchmark.isWideGap ? "Wide gap — comparison is approximate" : "Closely matched tenor"} />
              </div>
              {benchmark.isWideGap && (
                <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                  No sovereign instrument with a closely matched remaining tenor is currently available — this spread compares across a wide maturity gap and should be treated as approximate.
                </p>
              )}
              {!benchmark.isSecondaryBenchmark && security.analytics.observationKind === "SECONDARY_MARKET" && (
                <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                  No sovereign instrument has a secondary-market trade to compare against — this spread compares this bond&apos;s real secondary-market yield to a primary auction rate, not a like-for-like secondary yield.
                </p>
              )}
            </SectionCard>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Remaining Cash-Flow Schedule</h2>
        {!cashFlows.ok ? (
          <SectionCard>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{cashFlows.message}</p>
          </SectionCard>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Coupon</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Principal</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {cashFlows.flows.map((f, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">{f.date.toISOString().slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{f.coupon.toFixed(4)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{f.principal.toFixed(2)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{f.total.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {(priceHistory.length > 0 || yieldHistory.length > 0) && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Historical Market Observations</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {priceHistory.length > 0 && (
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Clean Price History</p>
                <RatesChart series={[{ key: "price", label: "Clean Price", color: "#3b82f6", data: priceHistory }]} unit="per 100 face" />
              </SectionCard>
            )}
            {yieldHistory.length > 0 && (
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source-Quoted Yield History</p>
                <RatesChart series={[{ key: "yield", label: "Yield", color: "#f59e0b", data: yieldHistory }]} unit="%" />
              </SectionCard>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Investment / Return Calculator</h2>
        <SectionCard>
          <InvestmentCalculator terms={terms} settlementDateIso={settlementDate.toISOString().slice(0, 10)} defaultPrice={security.analytics.cleanPrice} />
        </SectionCard>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Find Alternatives</h2>
        {security.analytics.ytmPct === null ? (
          <SectionCard>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Not available — this security has no computable YTM yet.</p>
          </SectionCard>
        ) : (
          <FindAlternatives target={targetComparableRow} universe={comparableUniverseExcludingSelf} />
        )}
      </section>
    </div>
  );
}
