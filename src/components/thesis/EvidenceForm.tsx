"use client";

// Add or edit evidence. Four shapes: a manual item (analyst / external / official / company), a Korbly
// observation being linked, and the edit forms for each. For linked evidence the observation itself is
// shown read-only (it is frozen); only the analyst's interpretation can be written or changed.

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { EVIDENCE_LIMITS, EVIDENCE_RELEVANCES, EVIDENCE_STANCES, MANUAL_SOURCE_TYPES, RELEVANCE_LABEL, SOURCE_TYPE_HELP, SOURCE_TYPE_LABEL, STANCE_LABEL, STANCE_MEANING, RELEVANCE_NOTE, STANCE_NOTE, type EvidenceRelevance, type EvidenceStance, type ManualSourceType } from "@/lib/thesis";
import type { EvidenceFormState } from "@/app/theses/research-actions";
import { BTN, BTN_PRIMARY } from "./ui";
import { INPUT, LABEL } from "./evidence-ui";

export interface FormTargets {
  conditions: { id: string; kind: "MUST_BE_TRUE" | "INVALIDATION"; text: string }[];
  catalysts: { id: string; description: string }[];
}
export interface EvidenceInitial {
  stance?: EvidenceStance | null;
  relevance?: EvidenceRelevance | null;
  sourceType?: ManualSourceType | null;
  title?: string;
  detail?: string;
  note?: string;
  observedAt?: string | null;
  sourceName?: string;
  sourceUrl?: string;
  conditionId?: string | null;
  catalystId?: string | null;
}
export type EvidenceFormMode = "manual" | "link" | "edit-manual" | "edit-linked";

const ErrorText = ({ msg }: { msg?: string }) => (msg ? <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{msg}</p> : null);

function Choice<T extends string>({ name, legend, values, labels, help, value, onChange, error, hint }: { name: string; legend: string; values: readonly T[]; labels: Record<T, string>; help?: Record<T, string>; value: T | null; onChange: (v: T) => void; error?: string; hint?: string }) {
  return (
    <fieldset>
      <legend className={LABEL}>{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {values.map((v) => (
          <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${value === v ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"}`}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="mt-1" />
            <span><span className="block font-medium text-zinc-900 dark:text-zinc-100">{labels[v]}</span>{help && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{help[v]}</span>}</span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>}
      <ErrorText msg={error} />
    </fieldset>
  );
}

export function EvidenceForm({ mode, action, targets, initial, link, preview, cancelHref }: { mode: EvidenceFormMode; action: (prev: EvidenceFormState, fd: FormData) => Promise<EvidenceFormState>; targets: FormTargets; initial?: EvidenceInitial; link?: { refKind: string; refId: string }; preview?: ReactNode; cancelHref: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  const manual = mode === "manual" || mode === "edit-manual";
  const [stance, setStance] = useState<EvidenceStance | null>(initial?.stance ?? null);
  const [relevance, setRelevance] = useState<EvidenceRelevance | null>(initial?.relevance ?? null);
  const [sourceType, setSourceType] = useState<ManualSourceType | "">(initial?.sourceType ?? "");
  const [target, setTarget] = useState(initial?.conditionId ? `c:${initial.conditionId}` : initial?.catalystId ? `k:${initial.catalystId}` : "");
  const outside = sourceType !== "" && sourceType !== "ANALYST_OBSERVATION";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {mode === "link" && <><input type="hidden" name="mode" value="link" /><input type="hidden" name="refKind" value={link?.refKind} /><input type="hidden" name="refId" value={link?.refId} /></>}
      <input type="hidden" name="conditionId" value={target.startsWith("c:") ? target.slice(2) : ""} />
      <input type="hidden" name="catalystId" value={target.startsWith("k:") ? target.slice(2) : ""} />
      {state.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{state.error}</p>}

      {preview}

      {manual && (
        <>
          <div>
            <label htmlFor="sourceType" className={LABEL}>Where does this come from?</label>
            <select id="sourceType" name="sourceType" value={sourceType} onChange={(ev) => setSourceType(ev.target.value as ManualSourceType | "")} aria-invalid={!!e.sourceType} className={INPUT}>
              <option value="">Choose…</option>
              {MANUAL_SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_TYPE_LABEL[t]} — {SOURCE_TYPE_HELP[t]}</option>)}
            </select>
            <ErrorText msg={e.sourceType} />
          </div>
          <div>
            <label htmlFor="title" className={LABEL}>What was observed? (one line)</label>
            <input id="title" name="title" defaultValue={initial?.title} maxLength={EVIDENCE_LIMITS.title} aria-invalid={!!e.title} placeholder="e.g. September inflation fell further" className={INPUT} />
            <ErrorText msg={e.title} />
          </div>
          <div>
            <label htmlFor="detail" className={LABEL}>Description (optional)</label>
            <textarea id="detail" name="detail" rows={3} defaultValue={initial?.detail} maxLength={EVIDENCE_LIMITS.detail} aria-invalid={!!e.detail} className={INPUT} />
            <ErrorText msg={e.detail} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="observedAt" className={LABEL}>{sourceType === "ANALYST_OBSERVATION" ? "Date observed (optional)" : "Date published or observed"}</label>
              <input id="observedAt" name="observedAt" type="date" max={today} defaultValue={initial?.observedAt ?? ""} aria-invalid={!!e.observedAt} className={INPUT} />
              <ErrorText msg={e.observedAt} />
            </div>
            {outside && (
              <div>
                <label htmlFor="sourceName" className={LABEL}>Source name</label>
                <input id="sourceName" name="sourceName" defaultValue={initial?.sourceName} maxLength={EVIDENCE_LIMITS.sourceName} aria-invalid={!!e.sourceName} placeholder="e.g. Ghana Statistical Service" className={INPUT} />
                <ErrorText msg={e.sourceName} />
              </div>
            )}
          </div>
          {outside && (
            <div>
              <label htmlFor="sourceUrl" className={LABEL}>Link to the source (optional)</label>
              <input id="sourceUrl" name="sourceUrl" type="url" inputMode="url" defaultValue={initial?.sourceUrl} aria-invalid={!!e.sourceUrl} placeholder="https://…" className={INPUT} />
              <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Korbly stores the address as a reference. It does not open it, read it or verify it.</p>
              <ErrorText msg={e.sourceUrl} />
            </div>
          )}
        </>
      )}

      <Choice name="stance" legend="How does it bear on the thesis?" values={EVIDENCE_STANCES} labels={STANCE_LABEL} help={STANCE_MEANING} value={stance} onChange={setStance} error={e.stance} hint={STANCE_NOTE} />
      <Choice name="relevance" legend="How much does it matter?" values={EVIDENCE_RELEVANCES} labels={RELEVANCE_LABEL} value={relevance} onChange={setRelevance} error={e.relevance} hint={RELEVANCE_NOTE} />

      <div>
        <label htmlFor="target" className={LABEL}>Applies to (optional)</label>
        <select id="target" value={target} onChange={(ev) => setTarget(ev.target.value)} className={INPUT}>
          <option value="">The thesis as a whole</option>
          {targets.conditions.some((c) => c.kind === "MUST_BE_TRUE") && <optgroup label="What must be true">{targets.conditions.filter((c) => c.kind === "MUST_BE_TRUE").map((c) => <option key={c.id} value={`c:${c.id}`}>{c.text}</option>)}</optgroup>}
          {targets.conditions.some((c) => c.kind === "INVALIDATION") && <optgroup label="What could prove us wrong">{targets.conditions.filter((c) => c.kind === "INVALIDATION").map((c) => <option key={c.id} value={`c:${c.id}`}>{c.text}</option>)}</optgroup>}
          {targets.catalysts.length > 0 && <optgroup label="Catalysts">{targets.catalysts.map((c) => <option key={c.id} value={`k:${c.id}`}>{c.description}</option>)}</optgroup>}
        </select>
        <ErrorText msg={e.target} />
      </div>

      <div>
        <label htmlFor="note" className={LABEL}>Your interpretation — why does this matter to the thesis? (optional)</label>
        <textarea id="note" name="note" rows={3} defaultValue={initial?.note} maxLength={EVIDENCE_LIMITS.note} aria-invalid={!!e.note} placeholder="e.g. Consistent with our disinflation condition." className={INPUT} />
        <ErrorText msg={e.note} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <button type="submit" disabled={pending} className={BTN_PRIMARY}>{pending ? "Saving…" : mode.startsWith("edit") ? "Save changes" : "Add to thesis"}</button>
        <Link href={cancelHref} className={BTN}>Cancel</Link>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Adding evidence does not change the thesis status or confidence.</p>
      </div>
    </form>
  );
}
