// ---------------------------------------------------------------------------
// Portfolio hero (M9.0): what is it worth, what is it made of, how far can the
// evidence be trusted. The headline is "Reference Value" while every holding is
// Korbly-supported, and "Analytical Starting Value" as soon as any holding rests on
// an analyst assumption (M9.0.1). There is no cost basis or transaction history
// here, so no return, P&L or income figure.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { ReactNode } from "react";
import type { QualityView, HoldingView } from "@/lib/decision-insights";
import { ANALYTICAL_STARTING_VALUE_DEFINITION, EXPOSURE_ASSET_CLASS_LABEL, valueTerms, type AssetAllocation, type PortfolioValuationSummary } from "@/lib/portfolio";
import { ghsCompact } from "@/lib/scenario-studio/format";
import { ValuationBasisBar } from "@/components/portfolio/basis";
import { formatGhs, formatIsoDate } from "@/lib/fixed-income";
import { CLASS_VAR, EYEBROW, FOCUS } from "./shared";

function MixBar({ allocation }: { allocation: AssetAllocation }) {
  if (allocation.rows.length === 0) return null;
  const summary = allocation.rows.map((r) => `${r.label} ${r.pct.toFixed(0)}%`).join(", ");
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Asset mix: ${summary}`}>
        {allocation.rows.map((r) => (
          <div key={r.assetClass} className="korbly-grow h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${r.pct}%`, background: CLASS_VAR[r.assetClass] }} title={`${r.label} ${r.pct.toFixed(1)}%`} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
        {allocation.rows.map((r) => (
          <li key={r.assetClass} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: CLASS_VAR[r.assetClass] }} aria-hidden />
            {EXPOSURE_ASSET_CLASS_LABEL[r.assetClass]} <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.pct.toFixed(r.pct >= 10 ? 0 : 1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One square per holding — filled = recent evidence, outlined amber = older, hatched indigo = analyst assumption, dashed = needs review. Also stated in words. */
function CoverageSquares({ holdings }: { holdings: HoldingView[] }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Evidence status of each holding">
      {holdings.map((h) => {
        const state = h.status === "UNVALUED" ? "needs review" : h.basis === "ANALYST_ASSUMPTION" ? "analyst assumption" : h.quality.recency === "STALE" ? "older evidence" : "recent evidence";
        const cls = h.status === "UNVALUED" ? "border-dashed border-zinc-400 bg-transparent dark:border-zinc-500" : h.basis === "ANALYST_ASSUMPTION" ? "basis-hatch border-indigo-500 bg-indigo-500 dark:border-indigo-300 dark:bg-indigo-300" : h.quality.recency === "STALE" ? "border-amber-500 bg-amber-100 dark:border-amber-400 dark:bg-amber-400/20" : "border-emerald-600 bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-400";
        return <li key={h.positionId} className={`size-4 rounded-[4px] border-2 ${cls}`} title={`${h.label}: ${state}`} aria-label={`${h.label}: ${state}`} />;
      })}
    </ul>
  );
}

export function Hero({
  name,
  description,
  summary,
  allocation,
  quality,
  holdings,
  valuationDate,
  archived,
  actions,
}: {
  name: string;
  description: string | null;
  summary: PortfolioValuationSummary;
  allocation: AssetAllocation;
  quality: QualityView;
  holdings: HoldingView[];
  valuationDate: string;
  archived: boolean;
  actions: ReactNode;
}) {
  const value = summary.referenceValueGhs;
  const terms = valueTerms(summary);
  const unvaluedPrincipal = holdings.filter((h) => h.status === "UNVALUED").reduce((s, h) => s + (h.principalGhs ?? 0), 0);
  const needsAttention = quality.staleCount + quality.unvaluedCount > 0;
  return (
    <section aria-label="Portfolio summary" className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`grid gap-8 p-6 sm:p-8 ${summary.positionCount > 0 ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-12" : ""}`}>
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/portfolios" className={`rounded hover:underline ${FOCUS}`}>
              Portfolios
            </Link>
          </nav>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
            {name}
            {archived && <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Archived</span>}
          </h1>
          <p className={`${EYEBROW} mt-5`}>{terms.label}</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-zinc-950 dark:text-white sm:text-5xl">{value === null ? <span className="text-zinc-400 dark:text-zinc-500">{summary.positionCount === 0 ? "No holdings yet" : "Not yet valued"}</span> : formatGhs(value)}</p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-semibold tabular-nums">{summary.positionCount}</span> {summary.positionCount === 1 ? "holding" : "holdings"}
            {summary.positionCount > 0 && (
              <>
                {" "}
                · <span className="font-semibold tabular-nums">{summary.valuedCount}</span> valued
              </>
            )}{" "}
            · as at {formatIsoDate(valuationDate)}
          </p>
          {terms.analytical && value !== null && <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200"><span className="font-semibold tabular-nums">{ghsCompact(summary.basis.supported.valueGhs)}</span> Korbly-supported <span aria-hidden>+</span> <span className="font-semibold tabular-nums">{ghsCompact(summary.basis.assumption.valueGhs)}</span> analyst assumptions</p>}
          {value !== null && summary.unvaluedCount > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Covers the {summary.valuedCount} valued holdings only — the {summary.unvaluedCount} not valued are excluded, not counted as zero.</p>}
          {description && <p className="mt-2 hidden max-w-xl text-xs sm:block text-zinc-500 dark:text-zinc-400">{description}</p>}
          <div className="mt-6">
            <MixBar allocation={allocation} />
          </div>
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">{terms.analytical ? ANALYTICAL_STARTING_VALUE_DEFINITION : "Reference Value is Korbly’s dated estimate from the latest reliable observation — not a market value, and not a return."}</p>
        </div>

        {summary.positionCount > 0 && (
        <div className="flex min-w-0 flex-col justify-between gap-6 border-t border-zinc-100 pt-6 dark:border-zinc-800 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <div>
            <p className={EYEBROW}>How much to trust it</p>
            <p className="mt-2 text-sm font-semibold leading-snug tabular-nums text-zinc-900 dark:text-zinc-100">{quality.heroLine || quality.summary}</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">of {summary.positionCount} {summary.positionCount === 1 ? "holding" : "holdings"}</p>
            {holdings.length > 0 && (
              <div className="mt-3">
                <CoverageSquares holdings={holdings} />
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="mr-3 inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-[3px] border-2 border-emerald-600 bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-400" aria-hidden /> Recent</span>
                  <span className="mr-3 inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-[3px] border-2 border-amber-500 bg-amber-100 dark:bg-amber-400/20" aria-hidden /> Older</span>
                  {summary.assumptionCount > 0 && <span className="mr-3 inline-flex items-center gap-1"><span className="basis-hatch inline-block size-2.5 rounded-[3px] border-2 border-indigo-500 bg-indigo-500 dark:border-indigo-300 dark:bg-indigo-300" aria-hidden /> Assumed</span>}
                  <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-[3px] border-2 border-dashed border-zinc-400" aria-hidden /> Needs review</span>
                </p>
              </div>
            )}
            {summary.valuedCount > 0 && (
              <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <ValuationBasisBar summary={summary} unvaluedPrincipalGhs={unvaluedPrincipal} compact />
              </div>
            )}
            {needsAttention && quality.needsReview[0] && (
              <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
                <Link href={quality.needsReview[0].href} className={`rounded font-medium text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
                  {quality.needsReview[0].label}
                </Link>
                {" — "}
                {quality.needsReview[0].message}
              </p>
            )}
            {quality.hasBillDisclosure && <p className="mt-2 hidden text-[11px] sm:block text-zinc-500 dark:text-zinc-400">Treasury bills use an indicative valuation from an interpolated Bank of Ghana auction rate; no secondary-market quote is available.</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        )}
      </div>
    </section>
  );
}
