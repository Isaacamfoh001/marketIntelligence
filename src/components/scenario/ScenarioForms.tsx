"use client";

import { useActionState, useState } from "react";
import { addShockAction, createScenarioAction, updateScenarioAction, updateShockAction, type ScenarioFormState } from "@/app/portfolios/[portfolioId]/scenarios/actions";
import { SHOCK_BOUNDS, SHOCK_UNIT_LABEL, type ShockType } from "@/lib/scenarios";

const INPUT = "w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const BTN = "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const BTN2 = "rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

const Err = ({ s }: { s: ScenarioFormState }) =>
  s.error ? (
    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
      {s.error}
    </p>
  ) : null;

export function CreateScenarioForm({ portfolioId }: { portfolioId: string }) {
  const [state, action, pending] = useActionState<ScenarioFormState, FormData>(createScenarioAction.bind(null, portfolioId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-end">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Scenario name <span className="text-zinc-400">(required)</span>
        <input name="name" required maxLength={120} placeholder="e.g. Yields +200 bps" className={`${INPUT} mt-1`} />
      </label>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Description <span className="text-zinc-400">(optional)</span>
        <input name="description" maxLength={1000} placeholder="The assumption being tested" className={`${INPUT} mt-1`} />
      </label>
      <button type="submit" disabled={pending} className={BTN}>
        {pending ? "Creating…" : "Create scenario"}
      </button>
      <div className="sm:col-span-3">
        <Err s={state} />
      </div>
    </form>
  );
}

export function RenameScenarioForm({ portfolioId, scenarioId, name, description }: { portfolioId: string; scenarioId: string; name: string; description: string | null }) {
  const [state, action, pending] = useActionState<ScenarioFormState, FormData>(updateScenarioAction.bind(null, portfolioId, scenarioId), {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-end">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Name
        <input name="name" required maxLength={120} defaultValue={name} className={`${INPUT} mt-1`} />
      </label>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Description
        <input name="description" maxLength={1000} defaultValue={description ?? ""} className={`${INPUT} mt-1`} />
      </label>
      <button type="submit" disabled={pending} className={BTN2}>
        {pending ? "Saving…" : "Save"}
      </button>
      <div className="sm:col-span-3">
        <Err s={state} />
      </div>
    </form>
  );
}

export interface TargetOptionView {
  value: string;
  label: string;
  group: string;
  shockType: ShockType;
}

const UNIT_HELP: Record<ShockType, string> = {
  YIELD_BPS: `basis points added to the yield (+200 = +2.00 percentage points). Allowed ${SHOCK_BOUNDS.YIELD_BPS.min} to ${SHOCK_BOUNDS.YIELD_BPS.max}.`,
  PRICE_PCT: `percent change in the price (−10 = −10%). Allowed ${SHOCK_BOUNDS.PRICE_PCT.min} to ${SHOCK_BOUNDS.PRICE_PCT.max}.`,
};

export function AddShockForm({ portfolioId, scenarioId, options }: { portfolioId: string; scenarioId: string; options: TargetOptionView[] }) {
  const [state, action, pending] = useActionState<ScenarioFormState, FormData>(addShockAction.bind(null, portfolioId, scenarioId), {});
  const [target, setTarget] = useState(options[0]?.value ?? "");
  const type = options.find((o) => o.value === target)?.shockType ?? "YIELD_BPS";
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)_auto] sm:items-end">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Applies to
        <select name="target" value={target} onChange={(e) => setTarget(e.target.value)} className={`${INPUT} mt-1`}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} ({SHOCK_UNIT_LABEL[o.shockType]})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Shock ({SHOCK_UNIT_LABEL[type]})
        <input name="value" required inputMode="decimal" placeholder={type === "YIELD_BPS" ? "e.g. 200" : "e.g. -10"} className={`${INPUT} mt-1`} />
      </label>
      <button type="submit" disabled={pending} className={BTN}>
        {pending ? "Adding…" : "Add assumption"}
      </button>
      <p className="text-[11px] text-zinc-500 sm:col-span-3 dark:text-zinc-400">Shock is in {UNIT_HELP[type]} A more specific assumption (security, then issuer) replaces a wider one — they never add up.</p>
      <div className="sm:col-span-3">
        <Err s={state} />
      </div>
    </form>
  );
}

export function EditShockForm({ portfolioId, scenarioId, shockId, value, unit }: { portfolioId: string; scenarioId: string; shockId: string; value: number; unit: ShockType }) {
  const [state, action, pending] = useActionState<ScenarioFormState, FormData>(updateShockAction.bind(null, portfolioId, scenarioId, shockId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input name="value" aria-label={`Shock (${SHOCK_UNIT_LABEL[unit]})`} required inputMode="decimal" defaultValue={String(value)} className={`${INPUT} w-24 py-1`} />
      <button type="submit" disabled={pending} className={BTN2}>
        {pending ? "Saving…" : "Update"}
      </button>
      <Err s={state} />
    </form>
  );
}
