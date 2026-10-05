// ---------------------------------------------------------------------------
// Decision insights presentation (M9.0). Renders what the decision-insights
// layer produced, keeping three things visibly apart:
//   What we see      (fact)             What it means  (interpretation)
//   Worth reviewing  (investigation prompt — never a recommendation)
// Evidence is one disclosure away from every statement.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { DecisionInsights, EvidenceItem, Insight, Investigation, PrimaryConclusion } from "@/lib/decision-insights";
import { Disclosure, EYEBROW, FOCUS, PANEL } from "./shared";

function Evidence({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) return null;
  return (
    <Disclosure summary="Show the evidence">
      <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
        {items.map((e, i) => (
          <div key={`${e.label}-${i}`} className="grid gap-x-4 px-3 py-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <dt className="text-zinc-500 dark:text-zinc-400">{e.label}</dt>
            <dd className="min-w-0 break-words tabular-nums text-zinc-900 dark:text-zinc-100">
              {e.href ? (
                <Link href={e.href} className={`rounded text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
                  {e.value}
                </Link>
              ) : (
                e.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

export function PrimaryConclusionCard({ conclusion, heading = "What matters most" }: { conclusion: PrimaryConclusion | null; heading?: string }) {
  if (!conclusion) return null;
  return (
    <section aria-label={heading} className="rounded-xl border-l-4 border-l-blue-600 bg-blue-50/60 p-5 dark:border-l-blue-400 dark:bg-blue-950/30">
      <p className={EYEBROW}>{heading}</p>
      <p className="mt-2 text-lg font-semibold leading-snug tracking-tight text-zinc-950 dark:text-white sm:text-xl">{conclusion.fact}</p>
      {conclusion.interpretation && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{conclusion.interpretation}</p>}
      <div className="mt-3">
        <Evidence items={conclusion.evidence} />
      </div>
    </section>
  );
}

export function KeyInsights({ insights, investigations }: { insights: Insight[]; investigations: Investigation[] }) {
  if (insights.length === 0) return null;
  const inv = new Map(investigations.map((i) => [i.id, i]));
  return (
    <ol className="grid gap-3 md:grid-cols-2" aria-label="Key insights">
      {insights.map((i) => {
        const review = i.investigationId ? inv.get(i.investigationId) : undefined;
        return (
          <li key={i.id} className={`${PANEL} flex flex-col`}>
            <p className={EYEBROW}>{i.title}</p>
            <p className="mt-2 text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">{i.fact}</p>
            {i.interpretation && (
              <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">What it means: </span>
                {i.interpretation}
              </p>
            )}
            {review && (
              <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">Worth reviewing: </span>
                {review.prompt}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Evidence items={i.evidence} />
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500" title={i.materialityBasis}>
                Ranked by: {i.materialityBasis.split(" (")[0].toLowerCase()}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function InvestigationList({ items, empty = "Nothing stands out for follow-up right now." }: { items: Investigation[]; empty?: string }) {
  if (items.length === 0) return <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{empty}</p>;
  return (
    <ol className="space-y-2" aria-label="Worth investigating">
      {items.map((i, idx) => (
        <li key={i.id} className="flex gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" aria-hidden>
            {idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{i.prompt}</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Why: {i.reason}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {i.href && (
                <Link href={i.href} className={`rounded text-xs font-medium text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
                  Open to review <span aria-hidden>→</span>
                </Link>
              )}
              <Evidence items={i.evidence} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function InsightsSection({ insights }: { insights: DecisionInsights }) {
  return (
    <div className="space-y-5">
      <PrimaryConclusionCard conclusion={insights.primary} />
      <KeyInsights insights={insights.insights.filter((i) => !insights.primary?.basedOn.includes(i.id))} investigations={insights.investigations} />
    </div>
  );
}
