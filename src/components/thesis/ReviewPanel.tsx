// REVIEW SIGNAL. A workflow prompt, never a conclusion: it says why Korbly is asking for a second look,
// what has arrived since the last review, and — when the subject is held — how much exposure is
// connected to it. It offers one action: "Mark as reviewed", which only moves the review baseline.

import Link from "next/link";
import type { ThesisResearch } from "@/lib/queries/thesis";
import type { HeldRow } from "@/lib/thesis/context";
import { formatHeldValue } from "@/lib/thesis/context";
import { REVIEWED_NOTE, REVIEW_BASELINE_NEVER, REVIEW_HEADING, REVIEW_INTRO, REVIEW_NONE, type ThesisStatus } from "@/lib/thesis";
import { markReviewedAction } from "@/app/theses/research-actions";
import { BTN, BTN_PRIMARY } from "./ui";
import { formatDay, INPUT, LABEL, POPOVER } from "./evidence-ui";

function MarkReviewed({ thesisId, primary }: { thesisId: string; primary: boolean }) {
  return (
    <details className="relative">
      <summary className={`${primary ? BTN_PRIMARY : BTN} cursor-pointer list-none`}>Mark as reviewed</summary>
      <form action={markReviewedAction.bind(null, thesisId)} className={POPOVER}>
        <div>
          <label htmlFor="review-note" className={LABEL}>Note (optional)</label>
          <textarea id="review-note" name="note" rows={2} maxLength={2000} placeholder="e.g. Looked at the new CPI print; view unchanged." className={INPUT} />
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{REVIEWED_NOTE}</p>
        <button type="submit" className={BTN_PRIMARY}>Record review</button>
      </form>
    </details>
  );
}

export function ReviewPanel({ thesisId, status, research, held }: { thesisId: string; status: ThesisStatus; research: ThesisResearch; held: HeldRow[] }) {
  const s = research.state;
  const live = status === "ACTIVE" || status === "CHALLENGED";
  if (!live) return null;
  const heldValued = held.filter((h) => h.status === "VALUED");
  const newest = research.evidence.find((e) => e.isMostImportantNew);
  const baselineText = s.neverReviewed ? REVIEW_BASELINE_NEVER : `Last reviewed ${formatDay(s.baseline.slice(0, 10))}.`;

  return (
    <section aria-labelledby="review-h" className={`rounded-xl border p-5 ${s.reviewSuggested ? "border-amber-300 border-l-4 border-l-amber-500 bg-amber-50/70 dark:border-amber-500/30 dark:border-l-amber-400 dark:bg-amber-500/5" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="review-h" className={`text-sm font-semibold ${s.reviewSuggested ? "uppercase tracking-[0.06em] text-amber-950 dark:text-amber-100" : "text-zinc-950 dark:text-white"}`}>{s.reviewSuggested ? REVIEW_HEADING : "Review"}</h2>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-200">{s.reviewSuggested ? REVIEW_INTRO : REVIEW_NONE}</p>
        </div>
        <MarkReviewed thesisId={thesisId} primary={s.reviewSuggested} />
      </div>

      {s.reviewSuggested && (
        <ul className="mt-3 space-y-1.5" aria-label="Reasons for review">
          {s.reasons.map((r) => <li key={r.code} className="flex gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100"><span aria-hidden className="text-amber-700 dark:text-amber-300">▸</span><span>{r.text}{r.persistent && <span className="ml-2 rounded border border-amber-400 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">Still flagged</span>}</span></li>)}
        </ul>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs">
        <div><dt className="text-zinc-500 dark:text-zinc-400">Baseline</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100">{baselineText}</dd></div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">New since then</dt>
          <dd className="font-medium text-zinc-800 dark:text-zinc-100">
            {s.since.total === 0 ? "No new evidence" : `${s.since.total} new evidence ${s.since.total === 1 ? "item" : "items"} · ${s.since.supports} supporting · ${s.since.challenges} challenging${s.since.context ? ` · ${s.since.context} context` : ""}`}
          </dd>
        </div>
        {newest && <div><dt className="text-zinc-500 dark:text-zinc-400">Look first at</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100"><Link href={`#evidence-${newest.id}`} className="hover:underline">{newest.title}</Link></dd></div>}
      </dl>

      {s.reviewSuggested && heldValued.length > 0 && (
        <div className="mt-3 border-t border-amber-200 pt-3 dark:border-amber-500/20">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Held in</p>
          <ul className="mt-1 space-y-1 text-sm text-zinc-800 dark:text-zinc-100">
            {heldValued.map((h) => (
              <li key={h.positionId}>
                <Link href={h.href} className="font-semibold text-blue-700 hover:underline dark:text-blue-400">{h.portfolioName}</Link>
                <span className="text-zinc-600 dark:text-zinc-300"> · {h.valueLabel} </span><span className="font-semibold tabular-nums">{formatHeldValue(h)}</span>
                {h.weightPct !== null && <span className="text-zinc-600 dark:text-zinc-300"> · {h.weightPct.toFixed(1)}% of the portfolio’s valued total</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">Status and confidence are set only by the analyst; neither changes when evidence is added.</p>
    </section>
  );
}
