import Link from "next/link";
import { getFixedIncomeWorkspace } from "@/lib/queries/fixed-income";
import { getTreasurySnapshot, TREASURY_INSTRUMENTS } from "@/lib/queries/market-data";
import { formatIsoDate, MATURING_SOON_DAYS, toValuationDate } from "@/lib/fixed-income";
import { observationFreshness } from "@/lib/freshness";
import { YieldCurveChart } from "@/components/YieldCurveChart";
import { OpportunitiesTable } from "@/components/fixed-income/OpportunitiesTable";
import { SecurityUniverse } from "@/components/fixed-income/SecurityUniverse";
import { Card, FreshnessBadge, SectionHeading, Stat } from "@/components/fixed-income/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Fixed Income — decision-oriented overview (M7.3 §5/§23): current decision
// information first (snapshot → analyzable opportunities → active
// universe), reference information later (yield curve, matured history).
// ---------------------------------------------------------------------------

export default async function FixedIncomePage() {
  const valuationDate = toValuationDate(new Date());
  const [workspace, treasury] = await Promise.all([getFixedIncomeWorkspace(valuationDate), getTreasurySnapshot()]);
  const { securities, curve } = workspace;

  const outstanding = securities.filter((s) => s.lifecycle !== "MATURED");
  const gov = outstanding.filter((s) => s.classification === "SOVEREIGN");
  const corp = outstanding.filter((s) => s.classification === "CORPORATE");
  const recent = (rows: typeof outstanding) => rows.filter((s) => s.observationFreshness === "CURRENT").length;
  const maturingSoon = outstanding.filter((s) => s.lifecycle === "MATURING_SOON").length;
  const opportunities = outstanding.filter((s) => s.analytics.ytmPct !== null);
  const latestObservation = securities.reduce<string | null>((max, s) => (s.latestObservationDate && (!max || s.latestObservationDate > max) ? s.latestObservationDate : max), null);
  const latestFreshness = latestObservation ? (opportunities.some((s) => s.observationFreshness === "CURRENT") ? "CURRENT" : "STALE") : "MISSING";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Fixed Income</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            What can be invested in today, what return it offers at the observed price, and how that compares with Government of Ghana securities. Analytics as of{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatIsoDate(workspace.valuationDateIso)}</span> (valuation date).
          </p>
        </div>
        <Link
          href="/fixed-income/compare"
          className="shrink-0 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Compare &amp; Return Scenarios
        </Link>
      </div>

      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeading title="Market Snapshot" />
        <Card className="p-0">
          <div className="grid grid-cols-2 divide-zinc-100 sm:grid-cols-3 lg:grid-cols-7 lg:divide-x dark:divide-zinc-800">
            {TREASURY_INSTRUMENTS.map(({ code, label }) => {
              const [latest] = treasury.find((t) => t.code === code)?.latestTwo ?? [];
              const freshness = observationFreshness("WEEKLY", latest?.observationDate ?? null, valuationDate);
              return (
                <div key={code} className="px-4 py-3">
                  <Stat
                    label={`${label} T-Bill`}
                    value={latest ? `${Number(latest.interestRate).toFixed(2)}%` : "No data"}
                    sub={
                      latest ? (
                        <span className="flex items-center gap-1">
                          Auction {formatIsoDate(latest.observationDate.toISOString().slice(0, 10))} <FreshnessBadge freshness={freshness} />
                        </span>
                      ) : (
                        "No auction data yet"
                      )
                    }
                  />
                </div>
              );
            })}
            <div className="px-4 py-3">
              <Stat label="Active Gov. Bonds" value={gov.length} sub={`${recent(gov)} with recent quote`} />
            </div>
            <div className="px-4 py-3">
              <Stat label="Active Corporate" value={corp.length} sub={`${recent(corp)} with recent quote`} />
            </div>
            <div className="px-4 py-3">
              <Stat label="Maturing Soon" value={maturingSoon} sub={`within ${MATURING_SOON_DAYS} days`} />
            </div>
            <div className="px-4 py-3">
              <Stat
                label="Latest GFIM Observation"
                value={latestObservation ? formatIsoDate(latestObservation) : "None"}
                sub={
                  <span className="flex items-center gap-1">
                    Secondary-market trades <FreshnessBadge freshness={latestFreshness} />
                  </span>
                }
              />
            </div>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeading
          title="Current Opportunities"
          question="Outstanding securities with a usable market observation — the yields below were actually observed, not assumed."
        />
        <OpportunitiesTable securities={opportunities} />
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
          Observed YTM is gross of tax and charges. Securities with known terms but no market quote are listed in the universe below — open one to model purchase-price scenarios.
        </p>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeading
          title="Securities Universe"
          question="Every government and corporate bond. Active by default; matured securities remain available for research."
        />
        <SecurityUniverse securities={securities} />
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeading title="Ghana Sovereign Yield Curve" question="Observed T-bill auction rates and government-bond yields — the benchmark corporate spreads are measured against." />
        <Card>
          <YieldCurveChart points={curve} />
        </Card>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Treasury bills use Bank of Ghana auction data —{" "}
          <Link href="/macro-rates" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
            full Treasury bill history on Macro &amp; Rates
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
