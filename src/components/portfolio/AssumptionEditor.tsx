"use client";

// ---------------------------------------------------------------------------
// Valuation-assumption editor (M9.0.1). One position, one explicit starting
// assumption. The analyst chooses WHAT to assume (a yield, a price, par…) from
// the options that are financially valid for this asset class, sees the exact
// resulting value before saving, and may always leave the holding unvalued.
//
// The preview is the SAME pure domain function the server uses
// (valueWithAssumption), so the preview can never disagree with what is saved.
// Wording rules: an assumption is never called a Reference Value or a market
// price, and par is only ever offered as "Use par as an assumption".
// ---------------------------------------------------------------------------

import { useActionState, useMemo, useState } from "react";
import {
  ASSUMPTION_DISCLOSURE,
  ASSUMPTION_HELP,
  ASSUMPTION_KIND_LABEL,
  ASSUMPTION_UNIT,
  kindsFor,
  parseEnteredNumber,
  valueWithAssumption,
  type AssumptionAvailability,
  type AssumptionKind,
  type AssumptionSubject,
  type StoredAssumption,
  type ValuedPosition,
} from "@/lib/portfolio";
import { formatGhs } from "@/lib/fixed-income";
import type { FormState } from "@/app/portfolios/actions";
import { BasisBadge } from "./basis";

const INPUT = "w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const BTN = "rounded px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60";

export interface KorblyStanding {
  status: "VALUED" | "UNVALUED";
  /** "Reference" | "Indicative" when valued. */
  basisLabel: string | null;
  valueGhs: number | null;
  reason: string | null;
  /** Whether an assumption could responsibly stand in (unvalued) — always true when Korbly has its own value (override). */
  availability: AssumptionAvailability;
}

const helpFor = (kind: AssumptionKind, subject: AssumptionSubject) => ASSUMPTION_HELP[kind][subject.assetClass === "BOND" ? "bond" : subject.assetClass === "TREASURY_BILL" ? "bill" : "equity"] ?? "";

export function AssumptionEditor({
  subject,
  valuationDateIso,
  korbly,
  stored,
  inForce,
  saveAction,
  removeAction,
  archived,
}: {
  subject: AssumptionSubject;
  valuationDateIso: string;
  korbly: KorblyStanding;
  stored: StoredAssumption | null;
  /** True when the position is currently carried at the stored assumption. */
  inForce: boolean;
  saveAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  archived: boolean;
}) {
  const kinds = kindsFor(subject.assetClass);
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveAction, {});
  const [kind, setKind] = useState<AssumptionKind>(stored?.kind ?? kinds[0]);
  const [raw, setRaw] = useState(stored?.value === null || stored?.value === undefined ? "" : String(stored.value));
  const overriding = korbly.status === "VALUED";

  const preview = useMemo<{ hint: string } | { error: string } | { valuation: ValuedPosition }>(() => {
    const date = new Date(`${valuationDateIso}T00:00:00.000Z`);
    let value: number | null = null;
    if (kind !== "PAR") {
      if (raw.trim() === "") return { hint: "Enter a value to see the exact result." };
      value = parseEnteredNumber(raw);
      if (value === null) return { error: "Enter the assumption as a number, e.g. 28 for 28%." };
    }
    const valuation = valueWithAssumption(subject, { kind, value, overridesReference: overriding }, date);
    return valuation.status === "VALUED" ? { valuation } : { error: valuation.assumptionProblem?.reason ?? valuation.reason };
  }, [kind, raw, subject, valuationDateIso, overriding]);

  // --- Korbly cannot value it AND an assumption cannot responsibly stand in. ---
  if (!overriding && !korbly.availability.assumable) {
    return (
      <section aria-label="Valuation assumption" className="rounded-lg border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/60">
        <p className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100"><BasisBadge basis="UNVALUED" /> Cannot be modelled</p>
        <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">{korbly.availability.reason}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Korbly does not invent missing contract terms, so no assumption is offered. The holding stays recorded and is excluded from value-based figures.</p>
      </section>
    );
  }

  const form = (
    <form action={formAction} className="mt-3 space-y-3">
      <fieldset>
        <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-300">What do you want to assume?</legend>
        <div className="mt-1.5 space-y-1.5">
          {kinds.map((k) => (
            <label key={k} className={`flex cursor-pointer items-start gap-2 rounded border px-2.5 py-2 text-sm ${kind === k ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-400/60 dark:bg-indigo-400/10" : "border-zinc-200 dark:border-zinc-700"}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-0.5" />
              <span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{ASSUMPTION_KIND_LABEL[k]}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{helpFor(k, subject)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind !== "PAR" && (
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Assumed value <span className="font-normal text-zinc-500">({ASSUMPTION_UNIT[kind]})</span>
          <input name="value" value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" autoComplete="off" placeholder={kind === "YIELD_PCT" || kind === "RATE_PCT" ? "28" : kind === "PRICE_PER_100" ? "85" : "12.50"} className={`${INPUT} mt-1 max-w-[12rem]`} aria-describedby="assumption-preview" />
        </label>
      )}

      <div id="assumption-preview" aria-live="polite" className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Result of this assumption</p>
        {"hint" in preview && <p className="text-xs text-zinc-500 dark:text-zinc-400">{preview.hint}</p>}
        {"error" in preview && <p className="text-xs text-red-600 dark:text-red-400">{preview.error}</p>}
        {"valuation" in preview && preview.valuation.status === "VALUED" && (
          <>
            <p className="text-sm text-zinc-900 dark:text-zinc-100">Assumption value: <span className="font-semibold tabular-nums">{formatGhs(preview.valuation.referenceValueGhs)}</span></p>
            <details className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              <summary className="cursor-pointer select-none">How this was calculated</summary>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 tabular-nums">
                {preview.valuation.assumption?.calculation.map((c) => <li key={c}>{c}</li>)}
              </ol>
            </details>
          </>
        )}
      </div>
      <p className="text-xs font-medium text-indigo-900 dark:text-indigo-200">{ASSUMPTION_DISCLOSURE}</p>
      {overriding && <p className="text-xs text-zinc-600 dark:text-zinc-400">Korbly’s own {korbly.basisLabel?.toLowerCase()} value ({korbly.valueGhs !== null ? formatGhs(korbly.valueGhs) : "—"}) is not changed — it is kept beside your assumption.</p>}

      {state.error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || archived || !("valuation" in preview)} className={`${BTN} bg-indigo-700 text-white hover:bg-indigo-600 dark:bg-indigo-300 dark:text-indigo-950 dark:hover:bg-indigo-200`}>
          {pending ? "Saving…" : stored ? "Update assumption" : "Save assumption"}
        </button>
        {!stored && !overriding && <span className="text-xs text-zinc-500 dark:text-zinc-400">Or do nothing — the holding stays unvalued.</span>}
      </div>
    </form>
  );

  return (
    <section aria-label="Valuation assumption" className={`rounded-lg border p-3 ${stored ? "border-indigo-300 bg-indigo-50/40 dark:border-indigo-400/40 dark:bg-indigo-400/5" : !overriding ? "border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-400/5" : "border-zinc-200 dark:border-zinc-700"}`}>
      {!overriding && !stored && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">No reliable Reference Value</p>
          <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">Korbly does not have enough market evidence to value this holding.</p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{korbly.reason}</p>
          <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">You can leave it unvalued, or provide a valuation assumption so it can take part in portfolio and scenario analysis. Anything that rests on your assumption is labelled as such.</p>
          <details className="mt-2" open={!archived}>
            <summary className="cursor-pointer text-xs font-medium text-blue-700 dark:text-blue-400">Provide a valuation assumption</summary>
            {form}
          </details>
        </>
      )}
      {stored && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <BasisBadge basis="ANALYST_ASSUMPTION" /> {inForce ? "Starting assumption in use" : "Stored assumption — not currently in use"}
          </p>
          {!inForce && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Korbly now has its own supported value, which an assumption never silently replaces. Remove this assumption, or update it to override Korbly deliberately.</p>}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-blue-700 dark:text-blue-400">Change the assumption</summary>
            {form}
          </details>
          {!archived && (
            <form action={removeAction} className="mt-3 border-t border-indigo-100 pt-3 dark:border-indigo-400/20">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Removing it returns the holding to {overriding ? `Korbly’s ${korbly.basisLabel?.toLowerCase()} value` : "unvalued — not counted as zero"}. Market data is not touched.</p>
              <button type="submit" className={`${BTN} mt-2 border border-zinc-300 text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800`}>Remove assumption</button>
            </form>
          )}
        </>
      )}
      {!stored && overriding && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-blue-700 dark:text-blue-400">Test a different starting assumption</summary>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Korbly has its own {korbly.basisLabel?.toLowerCase()} value for this holding. You can analyse a different starting point without changing it: your assumption is used for this portfolio’s analysis and is always labelled as an assumption.</p>
          {form}
        </details>
      )}
    </section>
  );
}
