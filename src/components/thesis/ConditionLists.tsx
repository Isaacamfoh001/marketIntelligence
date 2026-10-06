// WHAT MUST BE TRUE and WHAT COULD PROVE US WRONG, as the analyst wrote them — now with the evidence
// attached to each, and (for "could prove us wrong") the analyst's own flag. The flag is a record, not an
// automatic invalidation; the thesis status is unchanged until the analyst changes it.

import Link from "next/link";
import type { ConditionView } from "@/lib/queries/thesis";
import { allowedFlagTransitions, FLAG_LABEL, FLAG_MEANING, FLAG_NOTE } from "@/lib/thesis";
import { setFlagAction } from "@/app/theses/research-actions";
import { BTN_PRIMARY } from "./ui";
import { FlagBadge, formatDay, INPUT, LABEL, POPOVER } from "./evidence-ui";

export function MustBeTrueList({ thesisId, items, editable }: { thesisId: string; items: ConditionView[]; editable: boolean }) {
  if (items.length === 0) return <p className="text-sm italic text-zinc-500 dark:text-zinc-400">No conditions recorded yet.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((c) => (
        <li key={c.id} id={`condition-${c.id}`} className="scroll-mt-4 flex gap-2.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
          <span aria-hidden className="mt-px text-zinc-400 dark:text-zinc-500">✓</span>
          <span className="min-w-0">
            {c.text}
            {c.evidenceCount > 0 && <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{c.evidenceCount} linked evidence</span>}
            {editable && <Link href={`/theses/${thesisId}/evidence/new?condition=${c.id}`} className="ml-2 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">Add evidence</Link>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function InvalidationList({ thesisId, items, editable }: { thesisId: string; items: ConditionView[]; editable: boolean }) {
  if (items.length === 0) return <p className="text-sm italic text-zinc-500 dark:text-zinc-400">Nothing recorded yet — a thesis that cannot be wrong is not yet a thesis.</p>;
  return (
    <>
      <ul className="space-y-3">
        {items.map((c) => {
          const raised = c.flag !== "NOT_OBSERVED";
          return (
            <li key={c.id} id={`condition-${c.id}`} className={`scroll-mt-4 rounded-lg ${raised ? "border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/10" : ""}`}>
              <div className="flex gap-2.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
                <span aria-hidden className="mt-px text-zinc-400 dark:text-zinc-500">↺</span>
                <span className="min-w-0 flex-1">
                  {c.text}
                  <span className="ml-2 inline-block align-middle"><FlagBadge flag={c.flag} /></span>
                </span>
              </div>
              {raised && c.flagChangedAt && <p className="mt-1 pl-6 text-xs text-zinc-700 dark:text-zinc-200">{FLAG_LABEL[c.flag]} by the analyst on {formatDay(c.flagChangedAt.slice(0, 10))}.{c.flagNote ? <> “{c.flagNote}”</> : null}</p>}
              {raised && <p className="pl-6 text-xs font-medium text-amber-900 dark:text-amber-200">This is a reason to review the thesis. The thesis status is unchanged.</p>}
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs">
                {c.evidenceCount > 0 && <span className="text-zinc-500 dark:text-zinc-400">{c.evidenceCount} linked evidence</span>}
                {editable && <Link href={`/theses/${thesisId}/evidence/new?condition=${c.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">Add evidence</Link>}
                {editable && (
                  <details className="relative">
                    <summary className="cursor-pointer list-none rounded font-medium text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-400">Flag ▾</summary>
                    <form action={setFlagAction.bind(null, thesisId, c.id)} className={POPOVER}>
                      <fieldset className="space-y-1.5">
                        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Record this condition as…</legend>
                        {allowedFlagTransitions(c.flag).map((f, i) => (
                          <label key={f} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-zinc-200 p-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 dark:border-zinc-700">
                            <input type="radio" name="to" value={f} defaultChecked={i === 0} className="mt-1" />
                            <span><span className="block font-medium text-zinc-900 dark:text-zinc-100">{FLAG_LABEL[f]}</span><span className="block text-xs text-zinc-500 dark:text-zinc-400">{FLAG_MEANING[f]}</span></span>
                          </label>
                        ))}
                      </fieldset>
                      <div><label htmlFor={`flag-note-${c.id}`} className={LABEL}>Why? (optional)</label><textarea id={`flag-note-${c.id}`} name="note" rows={2} maxLength={500} className={INPUT} /></div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{FLAG_NOTE}</p>
                      <button type="submit" className={BTN_PRIMARY}>Record</button>
                    </form>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
