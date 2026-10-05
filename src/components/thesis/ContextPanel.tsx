// CURRENT KORBLY CONTEXT — Korbly's own data about the subject, kept visibly separate from the analyst's
// reasoning. It is shown beside the thesis, never as support for it.

import Link from "next/link";
import type { ThesisContextView } from "@/lib/queries/thesis";
import type { ThesisSubject } from "@/lib/queries/thesis";
import type { HeldRow } from "@/lib/thesis/context";
import { ASSUMPTION_CONTEXT_NOTE, CONTEXT_HEADING, CONTEXT_NOTE, NOT_HELD_NOTE, SCENARIO_NOTE, STALE_CONTEXT_NOTE } from "@/lib/thesis";
import { formatGhs, formatIsoDate } from "@/lib/fixed-income";
import { BTN } from "./ui";

function HeldCard({ r }: { r: HeldRow }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={r.href} className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">{r.portfolioName}</Link>
        {r.weightPct !== null && <span className="text-xs text-zinc-600 dark:text-zinc-300"><span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.weightPct.toFixed(1)}%</span> of the portfolio’s valued total</span>}
      </div>
      {r.status === "VALUED" ? (
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{r.valueLabel}</span> <span className="font-semibold tabular-nums">{formatGhs(r.valueGhs!)}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">Not valued <span className="text-xs text-zinc-500 dark:text-zinc-400">— {r.unvaluedReason}</span></p>
      )}
      {r.assumption && (
        <div className="mt-2 rounded border border-indigo-200 bg-indigo-50/60 px-2.5 py-2 text-xs text-indigo-950 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-100">
          <p className="font-semibold">Valuation context · Analyst assumption — {r.assumption.summary}</p>
          {r.assumption.kind === "FALLBACK" ? (
            <p className="mt-0.5">No reliable Korbly Reference Value exists, so this holding starts from the assumption.</p>
          ) : (
            <p className="mt-0.5">Analytical override: Korbly’s own value is {formatGhs(r.assumption.korblyValueGhs ?? 0)} and is unchanged; the analysis starts from the assumption instead.</p>
          )}
          <p className="mt-0.5 text-indigo-900/80 dark:text-indigo-200/80">{ASSUMPTION_CONTEXT_NOTE}</p>
        </div>
      )}
      {r.inactiveAssumptionSummary && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">A stored analyst assumption ({r.inactiveAssumptionSummary}) is not currently in use — Korbly now has its own value.</p>}
    </li>
  );
}

export function ContextPanel({ context, subject }: { context: ThesisContextView; subject: ThesisSubject }) {
  const anyStale = context.facts.some((f) => f.stale);
  return (
    <section aria-labelledby="context-h" className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="context-h" className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300">{CONTEXT_HEADING}</h2>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">as at {formatIsoDate(context.valuationDate)}</p>
      </div>
      <p className="mt-1 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">{CONTEXT_NOTE}</p>

      {context.facts.length > 0 && (
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {context.facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{f.label}</dt>
              <dd className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {f.value}
                {f.stale && <span className="ml-2 rounded border border-amber-400 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">Older evidence</span>}
              </dd>
              {f.sub && <dd className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{f.sub}</dd>}
            </div>
          ))}
        </dl>
      )}
      {anyStale && <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{STALE_CONTEXT_NOTE}</p>}

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300">Held in</h3>
      {context.held.length === 0 ? (
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{NOT_HELD_NOTE}</p>
      ) : (
        <ul className="mt-2 space-y-2.5">{context.held.map((r) => <HeldCard key={r.positionId} r={r} />)}</ul>
      )}

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300">Test in Scenario Studio</h3>
      <p className="mt-1 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">{SCENARIO_NOTE}</p>
      {context.scenarioLinks.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {context.scenarioLinks.map((l) => <Link key={l.portfolioId} href={l.href} className={BTN}>Open Scenario Studio · {l.portfolioName}</Link>)}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">Scenarios run on a portfolio. <Link href="/portfolios" className="font-medium text-blue-700 underline dark:text-blue-400">Add this to a portfolio</Link> to test it.</p>
      )}

      <p className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {context.links.map((l) => <Link key={l.href + l.label} href={l.href} className="font-medium text-blue-700 hover:underline dark:text-blue-400">{l.label} →</Link>)}
        {subject.kind === "TREASURY_BILL" && <span className="text-zinc-500 dark:text-zinc-400">A Treasury-bill thesis is about the tenor, so it matches every dated bill of that tenor.</span>}
      </p>
    </section>
  );
}
