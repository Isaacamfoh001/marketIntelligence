// Data-quality panel (M9.0): calm statements of actual evidence — counts and shares, never an invented "confidence score".
import Link from "next/link";
import type { HoldingView, QualityView } from "@/lib/decision-insights";
import { formatIsoDate } from "@/lib/fixed-income";
import type { PortfolioValuationSummary } from "@/lib/portfolio";
import { BASIS_LABEL, BASIS_MEANING, valueTerms } from "@/lib/portfolio";
import { BasisBadge, ValuationBasisBar, type BasisKey } from "@/components/portfolio/basis";
import { EYEBROW, FOCUS, PANEL } from "./shared";
import { StatusChip } from "./Holdings";

export function QualityPanel({ quality, holdings, summary }: { quality: QualityView; holdings: HoldingView[]; summary?: PortfolioValuationSummary }) {
  const valued = holdings.filter((h) => h.status === "VALUED");
  const terms = summary ? valueTerms(summary) : { label: "Reference Value", analytical: false };
  const unvaluedPrincipal = holdings.filter((h) => h.status === "UNVALUED").reduce((s, h) => s + (h.principalGhs ?? 0), 0);
  return (
    <section aria-label="Data quality" className={PANEL}>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Data quality</h3>
      <p className="mb-4 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">How much of the portfolio rests on recent, reliable evidence?</p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className={EYEBROW}>Valued</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{quality.valuedCount} <span className="text-sm font-normal text-zinc-500">of {quality.positionCount}</span></dd>
        </div>
        <div>
          <dt className={EYEBROW}>Recent evidence</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{quality.recentPct === null ? "—" : `${quality.recentPct.toFixed(0)}%`}</dd>
          <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">of valued {terms.label}</dd>
        </div>
        <div>
          <dt className={EYEBROW}>Older evidence</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{quality.staleCount}</dd>
          <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{quality.staleCount === 1 ? "holding" : "holdings"}</dd>
        </div>
        <div>
          <dt className={EYEBROW}>Needs review</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{quality.unvaluedCount}</dd>
          <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{quality.unvaluedCount === 1 ? "holding cannot be valued" : "holdings cannot be valued"}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-zinc-800 dark:text-zinc-200">{quality.summary}</p>
      {summary && summary.valuedCount > 0 && (
        <div className="mt-5 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <ValuationBasisBar summary={summary} unvaluedPrincipalGhs={unvaluedPrincipal} />
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            Valuation basis (what kind of value) is separate from data quality (how recent the evidence is). A recent assumption is still an assumption, and an older observed price is still Korbly-supported.
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            {(["REFERENCE", "INDICATIVE", "ANALYST_ASSUMPTION", "UNVALUED"] as BasisKey[]).map((k) => (
              <div key={k} className="flex items-start gap-2">
                <dt className="shrink-0"><BasisBadge basis={k} /></dt>
                <dd className="text-zinc-600 dark:text-zinc-400"><span className="sr-only">{BASIS_LABEL[k]}: </span>{BASIS_MEANING[k]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {quality.needsReview.length > 0 && (
        <ul className="mt-3 space-y-2">
          {quality.needsReview.map((r) => (
            <li key={r.positionId} className="rounded-lg bg-amber-50/70 px-3 py-2 text-xs text-zinc-800 dark:bg-amber-400/10 dark:text-zinc-200">
              <Link href={r.href} className={`rounded font-semibold text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>{r.label}</Link> — {r.message}
            </li>
          ))}
        </ul>
      )}
      {valued.length > 0 && (
        <details className="mt-4">
          <summary className={`inline-flex cursor-pointer list-none rounded text-xs font-medium text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>Evidence behind each holding</summary>
          <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {holdings.map((h) => (
              <li key={h.positionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="min-w-0">
                  <Link href={h.inspectHref} className={`rounded font-medium text-zinc-900 hover:underline dark:text-zinc-100 ${FOCUS}`}>{h.label}</Link>
                  <span className="ml-2 text-zinc-500 dark:text-zinc-400">{h.quality.label}{h.quality.inputDate ? ` · observed ${formatIsoDate(h.quality.inputDate)}` : ""}</span>
                </span>
                <StatusChip h={h} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {quality.hasBillDisclosure && <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">Treasury bills: indicative valuation using an interpolated Bank of Ghana auction rate; no secondary-market quote is available.</p>}
    </section>
  );
}
