import Link from "next/link";
import { getFixedIncomeWorkspace } from "@/lib/queries/fixed-income";
import { BENCHMARK_DATE_WINDOW_DAYS, CURVE_MAX_AGE_DAYS, formatIsoDate, toValuationDate } from "@/lib/fixed-income";
import { YieldCurveChart } from "@/components/YieldCurveChart";
import { ReliableYieldsTable } from "@/components/fixed-income/ReliableYieldsTable";
import { SecurityUniverse } from "@/components/fixed-income/SecurityUniverse";
import { FixedIncomeNav } from "@/components/fixed-income/FixedIncomeNav";
import { Card, SectionHeading } from "@/components/fixed-income/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Fixed Income › Market — the EVIDENCE layer (M7.3.2 §13). Everything that
// was on the old landing page stays here, in full: the reliable observed
// yields, the complete securities universe (active / maturing soon /
// historical, issuer filter, search, data-quality and carried-price states)
// and the detailed sovereign curve with its exclusions. The Intelligence
// page summarises; this page is where an analyst checks the numbers.
// ---------------------------------------------------------------------------

export default async function FixedIncomeMarketPage() {
  const workspace = await getFixedIncomeWorkspace(toValuationDate(new Date()));
  const { securities, curve, excludedCurvePoints } = workspace;
  const reliable = securities.filter((s) => s.lifecycle !== "MATURED" && s.analyticsEligible);

  return (
    <div className="space-y-8">
      <FixedIncomeNav asOf={formatIsoDate(workspace.valuationDateIso)} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Market &amp; Evidence</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          The detailed record behind the Intelligence view: every security, what it last did in the market, and how far each number can be trusted.
        </p>
      </div>

      <section id="universe">
        <SectionHeading title="Securities Universe" question="What exists, what has traded, and what needs review? Active by default; matured securities remain for research." />
        <SecurityUniverse securities={securities} />
      </section>

      <section id="observed-yields">
        <SectionHeading title="Reliable Observed Yields" question="Outstanding securities whose latest market yield is a real, quality-checked observation. A higher yield is not a better opportunity — it can reflect credit risk, illiquidity or an old quote." />
        <ReliableYieldsTable securities={reliable} />
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
          Observed YTM is solved from the traded price at its trade date, gross of tax and charges. An observed spread compares a corporate trade with a Government of Ghana observation within{" "}
          {BENCHMARK_DATE_WINDOW_DAYS} days of the same trade. Securities without a reliable quote are in the universe above — open one for hypothetical purchase-price scenarios.
        </p>
      </section>

      <section id="sovereign-curve">
        <SectionHeading title="Sovereign Yield Curve — evidence view" question="The connected line used for detailed reading. For an honest picture of where securities sit, use the Yield Landscape on the Intelligence page." />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <YieldCurveChart points={curve} height={220} />
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">What the curve uses</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Latest T-bill auctions, plus each outstanding government bond&apos;s latest trade if it passed every data-quality check and is no older than {CURVE_MAX_AGE_DAYS} days. Unusual but consistent yields are kept.
            </p>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Coverage caveat: the government securities master appears to omit some current post-DDEP bonds, so this is not a complete Ghana sovereign curve.
            </p>
            {excludedCurvePoints.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300">{excludedCurvePoints.length} government bonds not drawn — why</summary>
                <ul className="mt-2 space-y-1.5">
                  {excludedCurvePoints.map((e) => (
                    <li key={e.instrumentCode} className="text-xs">
                      <Link href={`/fixed-income/${encodeURIComponent(e.instrumentCode)}`} className="font-medium text-zinc-800 hover:underline dark:text-zinc-200">
                        {e.instrumentLabel.replace("Government of Ghana", "GoG")}
                      </Link>
                      <span className="block text-zinc-500 dark:text-zinc-400">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              <Link href="/macro-rates" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
                Full Treasury bill history on Macro &amp; Rates
              </Link>
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}
