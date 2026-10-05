// ---------------------------------------------------------------------------
// Valuation-basis presentation (M9.0.1). Server-safe, no hooks, no calculation.
// Four kinds of value are kept visibly apart — and never by colour alone: every
// kind has its own word, its own mark and (in the bar) its own fill pattern.
//
//   ● Reference            what Korbly knows   (accepted observed evidence)
//   ◐ Indicative           what Korbly models  (defensible estimate, no instrument quote)
//   ◇ Analyst assumption   what the analyst assumed (not observed)
//   ○ Unvalued             what remains unknown (excluded — never counted as zero)
//
// Data quality (recent / older evidence) is a SEPARATE question and has its own chips.
// ---------------------------------------------------------------------------

import { BASIS_LABEL, BASIS_MEANING, type PortfolioValuationSummary, type ValuationBasis } from "@/lib/portfolio";
import { ghsCompact, ghsWhole } from "@/lib/scenario-studio/format";

export type BasisKey = ValuationBasis | "UNVALUED";

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-none";

export const BASIS_STYLE: Record<BasisKey, { mark: string; chip: string; swatch: string; fill: string }> = {
  REFERENCE: { mark: "●", chip: "bg-blue-50 text-blue-800 dark:bg-blue-400/10 dark:text-blue-300", swatch: "bg-blue-600 dark:bg-blue-400", fill: "var(--basis-ref)" },
  INDICATIVE: { mark: "◐", chip: "bg-sky-50 text-sky-800 dark:bg-sky-400/10 dark:text-sky-300", swatch: "bg-sky-400 dark:bg-sky-300", fill: "var(--basis-ind)" },
  ANALYST_ASSUMPTION: { mark: "◇", chip: "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30", swatch: "bg-indigo-500 dark:bg-indigo-300", fill: "var(--basis-asm)" },
  UNVALUED: { mark: "○", chip: "border border-dashed border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-300", swatch: "border border-dashed border-zinc-400", fill: "transparent" },
};

/** "Reference" / "Indicative" / "Analyst assumption" / "Unvalued" — word first, mark second, colour last. */
export function BasisBadge({ basis, detail }: { basis: BasisKey; detail?: string | null }) {
  const s = BASIS_STYLE[basis];
  return (
    <span className={`${PILL} ${s.chip}`} title={BASIS_MEANING[basis]}>
      <span aria-hidden>{s.mark}</span>
      {BASIS_LABEL[basis]}
      {detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </span>
  );
}

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(n >= 10 || Number.isInteger(n) ? 0 : 1)}%`);

/**
 * How much of the starting value is what Korbly knows, what Korbly models, and what the analyst assumed — as exact amounts and
 * percentages that add to 100% of the VALUED total. Holdings with no value are listed separately, never folded into the bar.
 */
export function ValuationBasisBar({ summary, unvaluedPrincipalGhs = 0, compact = false, heading = true }: { summary: PortfolioValuationSummary; unvaluedPrincipalGhs?: number; compact?: boolean; heading?: boolean }) {
  const b = summary.basis;
  if (summary.valuedCount === 0 || summary.referenceValueGhs === null) return null;
  const rows: { key: Exclude<BasisKey, "UNVALUED">; label: string; slice: PortfolioValuationSummary["basis"]["reference"] }[] = [
    { key: "REFERENCE", label: "Reference", slice: b.reference },
    { key: "INDICATIVE", label: "Indicative", slice: b.indicative },
    { key: "ANALYST_ASSUMPTION", label: "Analyst assumptions", slice: b.assumption },
  ];
  const shown = rows.filter((r) => r.slice.count > 0);
  const text = shown.map((r) => `${r.label} ${pct(r.slice.pct)}`).join(", ");
  return (
    <div>
      {heading && <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">Valuation basis</p>}
      <div className={`${heading ? "mt-2" : ""} flex ${compact ? "h-2.5" : "h-3.5"} w-full gap-0.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800`} role="img" aria-label={`Valuation basis of ${ghsWhole(summary.referenceValueGhs)}: ${text}`}>
        {shown.map((r) => (
          <div key={r.key} className={`korbly-grow h-full ${r.key === "ANALYST_ASSUMPTION" ? "basis-hatch" : ""}`} style={{ width: `${r.slice.pct ?? 0}%`, background: BASIS_STYLE[r.key].fill }} title={`${r.label} ${pct(r.slice.pct)} · ${ghsWhole(r.slice.valueGhs)}`} />
        ))}
      </div>
      <ul className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 ${compact ? "text-[11px]" : "text-xs"} text-zinc-600 dark:text-zinc-300`}>
        {shown.map((r) => (
          <li key={r.key} className="flex items-center gap-1.5">
            <span className="text-[10px]" aria-hidden>{BASIS_STYLE[r.key].mark}</span>
            <span>{r.label}</span>
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{pct(r.slice.pct)}</span>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{ghsCompact(r.slice.valueGhs)}</span>
          </li>
        ))}
      </ul>
      {summary.unvaluedCount > 0 && (
        <p className={`mt-1.5 ${compact ? "text-[11px]" : "text-xs"} text-zinc-600 dark:text-zinc-300`}>
          <span aria-hidden>{BASIS_STYLE.UNVALUED.mark} </span>
          {summary.unvaluedCount} {summary.unvaluedCount === 1 ? "holding remains" : "holdings remain"} unvalued
          {unvaluedPrincipalGhs > 0 ? ` — ${ghsCompact(unvaluedPrincipalGhs)} of principal excluded` : ""}, not counted as zero.
        </p>
      )}
    </div>
  );
}
