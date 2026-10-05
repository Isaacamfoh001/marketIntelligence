// ---------------------------------------------------------------------------
// Shared presentation for the Portfolio Decision Workspace (M9.0). Layout and
// labelling only — every number arrives from the domain / decision-insights
// layers. Server-component safe (no hooks).
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import type { ExposureAssetClass } from "@/lib/portfolio";

export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
export const PANEL = "rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-zinc-800 dark:bg-zinc-900";
export const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400";

export const CLASS_VAR: Record<ExposureAssetClass, string> = {
  TREASURY_BILL: "var(--c-bill)",
  GOVERNMENT_BOND: "var(--c-gov)",
  CORPORATE_BOND: "var(--c-corp)",
  EQUITY: "var(--c-eq)",
};

export function Card({ title, question, children, className = "" }: { title: string; question: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`${PANEL} flex flex-col ${className}`}>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      <p className="mb-4 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{question}</p>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </section>
  );
}

export function SectionHeading({ id, children, hint }: { id: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {children}
      </h2>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

/** Technical detail behind progressive disclosure. */
export function Disclosure({ summary, children, className = "" }: { summary: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group ${className}`}>
      <summary className={`inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{children}</p>;
}
