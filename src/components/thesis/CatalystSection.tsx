// CATALYSTS — "what are we waiting for, and when?" Not a task list: no assignees, no due dates, no
// reminders. A catalyst has an expected window (or none), a status, and — once it has happened — the
// date and the analyst's reading. The next one watching is given prominence.

import Link from "next/link";
import type { CatalystView } from "@/lib/queries/thesis";
import { allowedCatalystTransitions, CATALYST_STATUS_LABEL, CATALYST_STATUS_MEANING, CATALYSTS_EMPTY, CATALYSTS_HEADING, CATALYSTS_INTRO, windowInputValue, WATCHING_VS_CATALYST } from "@/lib/thesis";
import { addCatalystAction, changeCatalystStatusAction, deleteCatalystAction, updateCatalystAction } from "@/app/theses/research-actions";
import { BTN, BTN_PRIMARY } from "./ui";
import { CatalystStatusBadge, formatDay, INPUT, LABEL, POPOVER, TimingBadge } from "./evidence-ui";

/** Next ~10 quarters, as "2027-Q1". */
function quarterOptions(now = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < 10; i++) {
    out.push({ value: `${y}-Q${q}`, label: `Q${q} ${y}` });
    if (++q > 4) { q = 1; y++; }
  }
  return out;
}

function WindowFields({ idPrefix, initialKind = "NONE", initialValue = "" }: { idPrefix: string; initialKind?: string; initialValue?: string }) {
  const quarters = quarterOptions();
  if (initialKind === "QUARTER" && initialValue && !quarters.some((q) => q.value === initialValue)) quarters.unshift({ value: initialValue, label: initialValue.replace("-", " ") });
  return (
    <fieldset className="space-y-2">
      <legend className={LABEL}>Expected timing</legend>
      <select name="windowKind" defaultValue={initialKind} aria-label="Timing precision" className={INPUT}>
        <option value="NONE">No date set — just watching</option>
        <option value="DATE">An exact date</option>
        <option value="MONTH">A month</option>
        <option value="QUARTER">A quarter</option>
      </select>
      <div className="grid gap-2 sm:grid-cols-3">
        <div><label htmlFor={`${idPrefix}-d`} className="mb-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">Date (if exact)</label><input id={`${idPrefix}-d`} type="date" name="window-DATE" defaultValue={initialKind === "DATE" ? initialValue : ""} className={INPUT} /></div>
        <div><label htmlFor={`${idPrefix}-m`} className="mb-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">Month (if a month)</label><input id={`${idPrefix}-m`} type="month" name="window-MONTH" defaultValue={initialKind === "MONTH" ? initialValue : ""} className={INPUT} /></div>
        <div><label htmlFor={`${idPrefix}-q`} className="mb-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">Quarter (if a quarter)</label><select id={`${idPrefix}-q`} name="window-QUARTER" defaultValue={initialKind === "QUARTER" ? initialValue : quarters[0].value} className={INPUT}>{quarters.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}</select></div>
      </div>
    </fieldset>
  );
}

function CatalystRow({ c, thesisId, editable, featured }: { c: CatalystView; thesisId: string; editable: boolean; featured: boolean }) {
  const transitions = allowedCatalystTransitions(c.status);
  return (
    <li id={`catalyst-${c.id}`} className={`scroll-mt-4 rounded-lg border p-3.5 ${featured ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800/50" : "border-zinc-200 dark:border-zinc-700"}`}>
      {featured && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300">Next catalyst</p>}
      <p className={`font-semibold text-zinc-950 dark:text-white ${featured ? "text-base" : "text-sm"}`}>{c.description}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
        <span>Expected: <span className="font-medium text-zinc-800 dark:text-zinc-100">{c.windowLabel}</span></span>
        <CatalystStatusBadge status={c.status} />
        {c.timing && c.timing !== "NO_DATE" && <TimingBadge timing={c.timing} />}
        {c.evidenceCount > 0 && <span>{c.evidenceCount} linked evidence</span>}
      </p>
      {c.status === "OCCURRED" && (
        <div className="mt-2 rounded border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm dark:border-sky-500/30 dark:bg-sky-500/10">
          <p className="text-xs font-semibold text-sky-950 dark:text-sky-100">Catalyst occurred{c.occurredOn ? ` · ${formatDay(c.occurredOn)}` : ""}</p>
          {c.outcomeNote ? <p className="mt-0.5 text-zinc-800 dark:text-zinc-100"><span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Analyst interpretation · </span>{c.outcomeNote}</p> : <p className="mt-0.5 text-xs italic text-zinc-600 dark:text-zinc-300">No interpretation recorded yet.</p>}
          {editable && <Link href={`/theses/${thesisId}/evidence/new?catalyst=${c.id}`} className="mt-1 inline-block text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">Record as evidence →</Link>}
        </div>
      )}
      {c.status !== "OCCURRED" && c.status !== "WATCHING" && c.outcomeNote && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200"><span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Analyst note · </span>{c.outcomeNote}</p>}
      {editable && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <details className="relative">
            <summary className="cursor-pointer list-none rounded text-xs font-medium text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-400">Update status ▾</summary>
            <form action={changeCatalystStatusAction.bind(null, thesisId, c.id)} className={POPOVER}>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Record that this…</legend>
                {transitions.map((t, i) => (
                  <label key={t} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-zinc-200 p-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 dark:border-zinc-700">
                    <input type="radio" name="to" value={t} defaultChecked={i === 0} className="mt-1" />
                    <span><span className="block font-medium text-zinc-900 dark:text-zinc-100">{t === "WATCHING" ? "Is still being watched (reopen)" : CATALYST_STATUS_LABEL[t]}</span><span className="block text-xs text-zinc-500 dark:text-zinc-400">{CATALYST_STATUS_MEANING[t]}</span></span>
                  </label>
                ))}
              </fieldset>
              <div><label htmlFor={`occ-${c.id}`} className={LABEL}>Date it occurred (if it did; defaults to today)</label><input id={`occ-${c.id}`} type="date" name="occurredOn" className={INPUT} /></div>
              <div><label htmlFor={`out-${c.id}`} className={LABEL}>Your interpretation (optional)</label><textarea id={`out-${c.id}`} name="outcomeNote" rows={2} maxLength={1000} className={INPUT} /></div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">This records a fact. It does not change the thesis status or confidence.</p>
              <button type="submit" className={BTN_PRIMARY}>Save</button>
            </form>
          </details>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded text-xs font-medium text-zinc-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-300">Edit</summary>
            <form action={updateCatalystAction.bind(null, thesisId, c.id)} className={POPOVER}>
              <div><label htmlFor={`desc-${c.id}`} className={LABEL}>What are we waiting for?</label><input id={`desc-${c.id}`} name="description" defaultValue={c.description} maxLength={200} required className={INPUT} /></div>
              <WindowFields idPrefix={`e-${c.id}`} initialKind={c.window.kind} initialValue={windowInputValue(c.window)} />
              <button type="submit" className={BTN_PRIMARY}>Save changes</button>
            </form>
          </details>
          {c.evidenceCount === 0 && (
            <form action={deleteCatalystAction.bind(null, thesisId, c.id)}><button type="submit" className="rounded text-xs font-medium text-zinc-500 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400">Delete</button></form>
          )}
        </div>
      )}
    </li>
  );
}

export function CatalystSection({ thesisId, catalysts, nextId, editable }: { thesisId: string; catalysts: CatalystView[]; nextId: string | null; editable: boolean }) {
  const next = catalysts.find((c) => c.id === nextId);
  const rest = catalysts.filter((c) => c.id !== nextId);
  return (
    <section id="catalysts" aria-labelledby="catalysts-h" className="scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="catalysts-h" className="text-sm font-semibold text-zinc-950 dark:text-white">{CATALYSTS_HEADING}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{CATALYSTS_INTRO}</p>
        </div>
        {editable && (
          <details className="relative">
            <summary className={`${BTN} cursor-pointer list-none`}>Add catalyst</summary>
            <form action={addCatalystAction.bind(null, thesisId)} className={POPOVER}>
              <div><label htmlFor="new-cat-desc" className={LABEL}>What are we waiting for?</label><input id="new-cat-desc" name="description" maxLength={200} required placeholder="e.g. Next Bank of Ghana MPC decision" className={INPUT} /></div>
              <WindowFields idPrefix="new" />
              <button type="submit" className={BTN_PRIMARY}>Add catalyst</button>
            </form>
          </details>
        )}
      </div>
      {catalysts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{CATALYSTS_EMPTY}</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {next && <CatalystRow c={next} thesisId={thesisId} editable={editable} featured />}
          {rest.map((c) => <CatalystRow key={c.id} c={c} thesisId={thesisId} editable={editable} featured={false} />)}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">{WATCHING_VS_CATALYST}</p>
    </section>
  );
}
