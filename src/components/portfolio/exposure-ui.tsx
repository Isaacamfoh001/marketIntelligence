// ---------------------------------------------------------------------------
// Shared presentation for the M8.2 exposure panels. Labelling and layout only —
// every number arrives already calculated by src/lib/portfolio/exposures.ts.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import type { ExposureAssetClass } from "@/lib/portfolio";

/** Same hues as AssetBadge so a class keeps one colour everywhere; labels always accompany them. */
export const CLASS_BAR: Record<ExposureAssetClass, string> = {
  GOVERNMENT_BOND: "bg-blue-600 dark:bg-blue-500",
  CORPORATE_BOND: "bg-sky-400 dark:bg-sky-400",
  EQUITY: "bg-violet-500 dark:bg-violet-400",
};

export function ExposurePanel({ id, title, basis, children, method, methodTitle = "How this is calculated" }: { id?: string; title: string; basis?: string; children: ReactNode; method?: ReactNode; methodTitle?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className="min-w-0 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id={id ? `${id}-h` : undefined} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        {basis && <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{basis}</span>}
      </div>
      <div className="mt-3">{children}</div>
      {method && (
        <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer select-none hover:text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:text-zinc-200">{methodTitle}</summary>
          <div className="mt-1.5 space-y-1.5 leading-relaxed">{method}</div>
        </details>
      )}
    </section>
  );
}

export function GroupHeading({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-2 mt-1 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{children}</h2>
      {note && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{note}</p>}
    </div>
  );
}

export function Metric({ label, value, sub, hint }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400" title={hint}>
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</dd>
      {sub && <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</dd>}
    </div>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ghsCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `GHS ${(v / 1e9).toFixed(2)}bn`;
  if (abs >= 1e6) return `GHS ${(v / 1e6).toFixed(2)}m`;
  if (abs >= 1e4) return `GHS ${(v / 1e3).toFixed(0)}k`;
  return `GHS ${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}
