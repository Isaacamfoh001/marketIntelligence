import { allowedTransitions, STATUS_LABEL, STATUS_MEANING, STATUS_ANALYST_NOTE, INVALIDATED_VS_CLOSED, TRANSITION_ACTION, type ThesisStatus } from "@/lib/thesis";
import { changeThesisStatusAction } from "@/app/theses/actions";
import { BTN, BTN_PRIMARY, FIELD_FOCUS } from "./ui";

/** Analyst-controlled status change. Lists only the transitions allowed from the current status. */
export function StatusControls({ id, status }: { id: string; status: ThesisStatus }) {
  const options = allowedTransitions(status);
  if (options.length === 0) return null;
  return (
    <details className="group relative">
      <summary className={`${BTN} cursor-pointer list-none`}>Change status ▾</summary>
      <form action={changeThesisStatusAction.bind(null, id)} className="fixed inset-x-4 bottom-4 z-30 max-h-[80vh] overflow-y-auto sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:z-20 sm:mt-2 sm:max-h-none sm:w-[22rem] sm:overflow-visible space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Move this thesis to…</legend>
          {options.map((o, i) => (
            <label key={o} className={`flex cursor-pointer items-start gap-2.5 rounded-md border border-zinc-200 p-2.5 text-sm hover:bg-zinc-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 dark:border-zinc-700 dark:hover:bg-zinc-800`}>
              <input type="radio" name="to" value={o} defaultChecked={i === 0} className="mt-1" />
              <span>
                <span className="block font-medium text-zinc-900 dark:text-zinc-100">{TRANSITION_ACTION[o]} <span className="font-normal text-zinc-500 dark:text-zinc-400">→ {STATUS_LABEL[o]}</span></span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{STATUS_MEANING[o]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor={`note-${id}`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Why? (optional, kept with the thesis)</label>
          <textarea id={`note-${id}`} name="note" rows={2} maxLength={500} className={`w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 ${FIELD_FOCUS}`} />
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{STATUS_ANALYST_NOTE} {INVALIDATED_VS_CLOSED}</p>
        <button type="submit" className={BTN_PRIMARY}>Update status</button>
      </form>
    </details>
  );
}
