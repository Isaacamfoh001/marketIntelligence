"use client";

import { useActionState, useState } from "react";
import { addSpecificAssumptionAction, createScenarioAction, saveCoreAssumptionsAction, updateScenarioAction, type ScenarioFormState } from "@/app/portfolios/[portfolioId]/scenarios/actions";
import type { ExposureAssetClass } from "@/lib/portfolio";
import type { ShockType } from "@/lib/scenarios";
import { previewAssumption, toHumanInput, type AmountUnit, type Direction } from "@/lib/scenario-studio/language";

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
        Start from blank — name your scenario <span className="text-zinc-400">(required)</span>
        <input name="name" required maxLength={120} placeholder="e.g. Rates up, equities flat" className={`${INPUT} mt-1`} />
      </label>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Description <span className="text-zinc-400">(optional)</span>
        <input name="description" maxLength={1000} placeholder="The question you are testing" className={`${INPUT} mt-1`} />
      </label>
      <button type="submit" disabled={pending} className={BTN}>
        {pending ? "Creating…" : "Create and add assumptions"}
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
  targetName: string;
  group: string;
  kind: "ASSET_CLASS" | "ISSUER" | "SECURITY";
  shockType: ShockType;
}

type Mode = "pp" | "bps";
interface RowState {
  dir: Direction;
  amount: string;
}

const SEGMENT = "inline-flex overflow-hidden rounded border border-zinc-300 text-sm dark:border-zinc-700";
const SEGMENT_LABEL = "cursor-pointer select-none px-3 py-1.5 text-zinc-700 has-[:checked]:bg-zinc-900 has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-blue-500 dark:text-zinc-300 dark:has-[:checked]:bg-zinc-100 dark:has-[:checked]:text-zinc-900";

function DirectionToggle({ name, value, onChange, labels }: { name: string; value: Direction; onChange: (d: Direction) => void; labels: [string, string] }) {
  return (
    <div role="radiogroup" className={SEGMENT}>
      {(["UP", "DOWN"] as const).map((d, i) => (
        <label key={d} className={`${SEGMENT_LABEL} ${i === 1 ? "border-l border-zinc-300 dark:border-zinc-700" : ""}`}>
          <input type="radio" name={name} value={d} checked={value === d} onChange={() => onChange(d)} className="sr-only" />
          {labels[i]}
        </label>
      ))}
    </div>
  );
}

function Preview({ result, blankHint = "Leave blank to leave this out of the scenario." }: { result: ReturnType<typeof previewAssumption>; blankHint?: string }) {
  return (
    <p aria-live="polite" className="min-h-[1.25rem] text-xs text-zinc-600 dark:text-zinc-400">
      {result.ok ? (
        <>
          <span className="mr-1.5 rounded bg-zinc-100 px-1.5 py-0.5 font-medium tabular-nums text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{result.technical}</span>
          {result.plain}
        </>
      ) : result.message ? (
        <span className="text-red-600 dark:text-red-400">{result.message}</span>
      ) : (
        <span className="text-zinc-400 dark:text-zinc-500">{blankHint}</span>
      )}
    </p>
  );
}

const CORE: { prefix: string; assetClass: ExposureAssetClass; label: string; shockType: ShockType; verbs: [string, string] }[] = [
  { prefix: "tbill", assetClass: "TREASURY_BILL", label: "Treasury bills", shockType: "YIELD_BPS", verbs: ["Rates rise", "Rates fall"] },
  { prefix: "gov", assetClass: "GOVERNMENT_BOND", label: "Government bonds", shockType: "YIELD_BPS", verbs: ["Yields rise", "Yields fall"] },
  { prefix: "corp", assetClass: "CORPORATE_BOND", label: "Corporate bonds", shockType: "YIELD_BPS", verbs: ["Yields rise", "Yields fall"] },
  { prefix: "eq", assetClass: "EQUITY", label: "Equities", shockType: "PRICE_PCT", verbs: ["Prices rise", "Prices fall"] },
];

const fmtAmount = (n: number) => String(Number(n.toFixed(6)));

/** "What do you want to test?" — the four broad assumptions in human terms, with an advanced basis-point mode. Both modes save the identical rule. */
export function CoreAssumptionsForm({ portfolioId, scenarioId, initial }: { portfolioId: string; scenarioId: string; initial: Record<ExposureAssetClass, number | null> }) {
  const [state, action, pending] = useActionState<ScenarioFormState, FormData>(saveCoreAssumptionsAction.bind(null, portfolioId, scenarioId), {});
  const [mode, setMode] = useState<Mode>("pp");
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      CORE.map((c) => {
        const v = initial[c.assetClass];
        if (v === null) return [c.prefix, { dir: c.shockType === "YIELD_BPS" ? "UP" : "DOWN", amount: "" } satisfies RowState];
        const h = toHumanInput(c.shockType, v);
        return [c.prefix, { dir: h.direction, amount: fmtAmount(h.amount) } satisfies RowState];
      }),
    ),
  );
  const setRow = (prefix: string, patch: Partial<RowState>) => setRows((r) => ({ ...r, [prefix]: { ...r[prefix], ...patch } }));
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setRows((r) => {
      const out = { ...r };
      for (const c of CORE) {
        if (c.shockType !== "YIELD_BPS") continue;
        const n = Number(out[c.prefix].amount);
        if (out[c.prefix].amount.trim() !== "" && Number.isFinite(n)) out[c.prefix] = { ...out[c.prefix], amount: fmtAmount(next === "bps" ? n * 100 : n / 100) };
      }
      return out;
    });
    setMode(next);
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mode" value={mode} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Choose what to test. These are assumptions you set — not Korbly forecasts.</p>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={mode === "bps"} onChange={(e) => switchMode(e.target.checked ? "bps" : "pp")} className="h-3.5 w-3.5" />
          Advanced: enter basis points
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CORE.map((c) => {
          const row = rows[c.prefix];
          const unit: AmountUnit = c.shockType === "PRICE_PCT" ? "PCT" : mode === "bps" ? "BPS" : "PP";
          const unitText = unit === "PCT" ? "%" : unit === "BPS" ? "basis points" : "percentage points";
          const preview = previewAssumption({ selector: { kind: "ASSET_CLASS", assetClass: c.assetClass }, targetLabel: c.label, shockType: c.shockType, direction: row.dir, amountText: row.amount, unit });
          return (
            <fieldset key={c.prefix} className="min-w-0 space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.label}</legend>
              <DirectionToggle name={`${c.prefix}_dir`} value={row.dir} onChange={(dir) => setRow(c.prefix, { dir })} labels={c.verbs} />
              <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <span className="sr-only">{c.label} amount in {unitText}</span>
                <input name={`${c.prefix}_amount`} value={row.amount} onChange={(e) => setRow(c.prefix, { amount: e.target.value })} inputMode="decimal" placeholder={c.shockType === "PRICE_PCT" ? "e.g. 10" : mode === "bps" ? "e.g. 200" : "e.g. 2.0"} className={`${INPUT} w-24`} />
                <span>{unitText}</span>
              </label>
              <Preview result={preview} />
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BTN}>
          {pending ? "Saving…" : "Save and show result"}
        </button>
        <Err s={state} />
      </div>
    </form>
  );
}

/** Add an issuer- or security-specific assumption. Re-adding the same target replaces it. */
export function SpecificAssumptionForm({ portfolioId, scenarioId, kind, options }: { portfolioId: string; scenarioId: string; kind: "ISSUER" | "SECURITY"; options: TargetOptionView[] }) {
  const [state, action, pending] = useActionState<ScenarioFormState, FormData>(addSpecificAssumptionAction.bind(null, portfolioId, scenarioId), {});
  const mine = options.filter((o) => o.kind === kind);
  const [target, setTarget] = useState(mine[0]?.value ?? "");
  const [dir, setDir] = useState<Direction>("UP");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("pp");
  const option = mine.find((o) => o.value === target) ?? mine[0];
  if (!option) return <p className="text-xs text-zinc-500 dark:text-zinc-400">{kind === "ISSUER" ? "Add a holding to the portfolio first — issuer assumptions apply to the issuers you hold." : "Add a holding to the portfolio first."}</p>;
  const yields = option.shockType === "YIELD_BPS";
  const unit: AmountUnit = !yields ? "PCT" : mode === "bps" ? "BPS" : "PP";
  const preview = previewAssumption({ selector: { kind }, targetLabel: option.targetName, shockType: option.shockType, direction: dir, amountText: amount, unit });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="mode" value={mode} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_auto_auto] sm:items-end">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {kind === "ISSUER" ? "Issuer" : "Security"}
          <select name="target" value={option.value} onChange={(e) => setTarget(e.target.value)} className={`${INPUT} mt-1`}>
            {mine.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <DirectionToggle name="v_dir" value={dir} onChange={setDir} labels={yields ? (option.value.startsWith("SECURITY|TREASURY_BILL") ? ["Rate rises", "Rate falls"] : ["Yields rise", "Yields fall"]) : ["Prices rise", "Prices fall"]} />
        <div className="flex items-center gap-2">
          <input name="v_amount" aria-label={`Amount in ${yields ? (mode === "bps" ? "basis points" : "percentage points") : "percent"}`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={yields ? (mode === "bps" ? "e.g. 400" : "e.g. 4.0") : "e.g. 15"} className={`${INPUT} w-24`} />
          {yields ? (
            <select aria-label="Unit" value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={`${INPUT} w-auto`}>
              <option value="pp">percentage points</option>
              <option value="bps">basis points</option>
            </select>
          ) : (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">%</span>
          )}
        </div>
      </div>
      <Preview result={preview} blankHint="Choose a direction and enter the size of the move." />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BTN2}>
          {pending ? "Adding…" : kind === "ISSUER" ? "Add issuer assumption" : "Add security assumption"}
        </button>
        <Err s={state} />
      </div>
    </form>
  );
}
