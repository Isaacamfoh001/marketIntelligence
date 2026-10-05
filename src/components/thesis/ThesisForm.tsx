"use client";

// Create / edit a thesis. One page, in the order the analyst thinks: subject → what we believe →
// why → what must be true → what could prove us wrong → what we're watching → confidence & horizon.
// Fields are controlled so nothing is lost when validation fails. Nothing is prefilled by Korbly.

import { useActionState, useState, type ReactNode } from "react";
import { CONFIDENCE_LABEL, HORIZON_LABEL, LIMITS, PROMPTS, THESIS_CONFIDENCES, THESIS_HORIZONS, activationGaps, normalizeContent, parseLines, type ThesisConfidence, type ThesisContent, type ThesisErrors, type ThesisHorizon } from "@/lib/thesis";
import type { SubjectOption } from "@/lib/queries/thesis";
import type { ThesisFormState } from "@/app/theses/actions";
import { SubjectPicker } from "./SubjectPicker";
import { BTN, BTN_PRIMARY, FIELD_FOCUS } from "./ui";
import Link from "next/link";

const INPUT = `w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 ${FIELD_FOCUS}`;

function Step({ n, title, hint, children, error, id }: { n: number; title: string; hint?: string; children: ReactNode; error?: string; id: string }) {
  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-3 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-4">
      <span aria-hidden className="hidden size-7 items-center justify-center rounded-full border border-zinc-300 text-xs font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-300 sm:flex">{n}</span>
      <div className="min-w-0">
        <h2 id={`${id}-h`} className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</h2>
        {hint && <p id={`${id}-hint`} className="mb-2 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
        {children}
        {error && <p id={`${id}-err`} role="alert" className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </section>
  );
}

function Segmented<T extends string>({ name, legend, values, labels, value, onChange, error }: { name: string; legend: string; values: readonly T[]; labels: Record<T, string>; value: T | null; onChange: (v: T) => void; error?: string }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{legend}</legend>
      <div className="inline-flex flex-wrap gap-1">
        {values.map((v) => (
          <label key={v} className={`relative cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${value === v ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"}`}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            {labels[v]}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400">{error}</p>}
    </fieldset>
  );
}

const linesOf = (xs: string[]) => xs.join("\n");

export function ThesisForm({ mode, action, options, initial, initialSubjectKey, cancelHref, lockedSubject }: { mode: "new" | "edit"; action: (prev: ThesisFormState, fd: FormData) => Promise<ThesisFormState>; options?: SubjectOption[]; initial?: ThesisContent; initialSubjectKey?: string | null; cancelHref: string; lockedSubject?: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [title, setTitle] = useState(initial?.title ?? "");
  const [belief, setBelief] = useState(initial?.belief ?? "");
  const [rationale, setRationale] = useState(initial?.rationale ?? "");
  const [mustBeTrue, setMustBeTrue] = useState(linesOf(initial?.mustBeTrue ?? []));
  const [invalidation, setInvalidation] = useState(linesOf(initial?.invalidation ?? []));
  const [risks, setRisks] = useState(linesOf(initial?.risks ?? []));
  const [catalysts, setCatalysts] = useState(linesOf(initial?.catalysts ?? []));
  const [watching, setWatching] = useState(linesOf(initial?.watching ?? []));
  const [confidence, setConfidence] = useState<ThesisConfidence | null>(initial?.confidence ?? null);
  const [horizon, setHorizon] = useState<ThesisHorizon | null>(initial?.horizon ?? null);
  const e: ThesisErrors = state.fieldErrors ?? {};

  const gaps = activationGaps(normalizeContent({ title, belief, rationale, mustBeTrue: parseLines(mustBeTrue), invalidation: parseLines(invalidation), risks: parseLines(risks), catalysts: parseLines(catalysts), watching: parseLines(watching), confidence, horizon }));
  const live = mode === "edit" && initial !== undefined;
  const count = (n: number) => `${n} of ${LIMITS.items}`;

  return (
    <form action={formAction} className="space-y-8" noValidate>
      {state.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{state.error}</p>
      )}

      {mode === "new" ? (
        <Step n={1} id="subject" title="What is this thesis about?" hint="A thesis can exist before you own anything. Pick an instrument Korbly holds data for.">
          <SubjectPicker options={options ?? []} initialKey={initialSubjectKey} error={state.error && !state.fieldErrors?.title && !state.fieldErrors?.belief && Object.keys(state.fieldErrors ?? {}).length === 0 ? state.error : undefined} />
        </Step>
      ) : (
        lockedSubject
      )}

      <Step n={mode === "new" ? 2 : 1} id="belief" title="What we believe" hint={PROMPTS.belief} error={e.belief}>
        <label htmlFor="title" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Title</label>
        <input id="title" name="title" value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={LIMITS.title + 20} placeholder="A short name, e.g. “Disinflation supports duration”" aria-invalid={!!e.title} aria-describedby={e.title ? "title-err" : undefined} className={INPUT} />
        {e.title && <p id="title-err" role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{e.title}</p>}
        <label htmlFor="belief" className="mb-1 mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Core belief</label>
        <textarea id="belief" name="belief" value={belief} onChange={(ev) => setBelief(ev.target.value)} rows={3} aria-invalid={!!e.belief} aria-describedby="belief-hint belief-err" className={INPUT} />
      </Step>

      <Step n={mode === "new" ? 3 : 2} id="rationale" title="Why we believe it" hint={PROMPTS.rationale} error={e.rationale}>
        <label htmlFor="rationale" className="sr-only">Why we believe it</label>
        <textarea id="rationale" name="rationale" value={rationale} onChange={(ev) => setRationale(ev.target.value)} rows={6} aria-invalid={!!e.rationale} className={INPUT} />
      </Step>

      <Step n={mode === "new" ? 4 : 3} id="must" title="What must be true" hint={PROMPTS.mustBeTrue} error={e.mustBeTrue}>
        <label htmlFor="mustBeTrue" className="sr-only">What must be true</label>
        <textarea id="mustBeTrue" name="mustBeTrue" value={mustBeTrue} onChange={(ev) => setMustBeTrue(ev.target.value)} rows={4} aria-invalid={!!e.mustBeTrue} className={INPUT} />
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{count(parseLines(mustBeTrue).length)} items</p>
      </Step>

      <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-500/30 dark:bg-red-500/5 sm:p-5">
        <Step n={mode === "new" ? 5 : 4} id="invalid" title="What could prove us wrong" hint={PROMPTS.invalidation} error={e.invalidation}>
          <label htmlFor="invalidation" className="sr-only">What could prove us wrong</label>
          <p className="mb-1.5 text-sm font-medium text-red-900 dark:text-red-200">We should reconsider if…</p>
          <textarea id="invalidation" name="invalidation" value={invalidation} onChange={(ev) => setInvalidation(ev.target.value)} rows={4} aria-invalid={!!e.invalidation} className={INPUT} />
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Make it observable. “Things may change” can’t be checked; “inflation re-accelerates for two consecutive prints” can.</p>
        </Step>
      </div>

      <Step n={mode === "new" ? 6 : 5} id="watch" title="What we’re watching" hint="Optional, but this is what you will come back to.">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="catalysts" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Catalysts</label>
            <textarea id="catalysts" name="catalysts" value={catalysts} onChange={(ev) => setCatalysts(ev.target.value)} rows={4} placeholder={PROMPTS.catalysts} aria-invalid={!!e.catalysts} className={INPUT} />
            {e.catalysts && <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{e.catalysts}</p>}
          </div>
          <div>
            <label htmlFor="risks" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">What could go wrong</label>
            <textarea id="risks" name="risks" value={risks} onChange={(ev) => setRisks(ev.target.value)} rows={4} placeholder={PROMPTS.risks} aria-invalid={!!e.risks} className={INPUT} />
            {e.risks && <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{e.risks}</p>}
          </div>
          <div>
            <label htmlFor="watching" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Indicators to watch</label>
            <textarea id="watching" name="watching" value={watching} onChange={(ev) => setWatching(ev.target.value)} rows={4} placeholder={PROMPTS.watching} aria-invalid={!!e.watching} className={INPUT} />
            {e.watching && <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{e.watching}</p>}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">A catalyst could make the view play out. A risk could weaken it. Neither is the same as something that would prove you wrong.</p>
      </Step>

      <Step n={mode === "new" ? 7 : 6} id="conf" title="Confidence and horizon" hint="Your own judgment — not a probability, and not a measure of data quality.">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Segmented name="confidence" legend="Confidence in the thesis" values={THESIS_CONFIDENCES} labels={CONFIDENCE_LABEL} value={confidence} onChange={setConfidence} error={e.confidence} />
          <Segmented name="horizon" legend="Time horizon" values={THESIS_HORIZONS} labels={HORIZON_LABEL} value={horizon} onChange={setHorizon} error={e.horizon} />
        </div>
      </Step>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:-mx-6 sm:px-6">
        <p className="text-xs text-zinc-600 dark:text-zinc-300" aria-live="polite">
          {gaps.length === 0 ? "Ready to activate." : <><span className="font-medium">To activate:</span> {gaps.length === 1 ? gaps[0] : `${gaps.length} things still to complete.`}</>}
        </p>
        <div className="flex items-center gap-2">
          <Link href={cancelHref} className={BTN}>Cancel</Link>
          {mode === "new" ? (
            <>
              <button type="submit" name="intent" value="draft" disabled={pending} className={BTN}>Save as draft</button>
              <button type="submit" name="intent" value="activate" disabled={pending} className={BTN_PRIMARY}>Activate thesis</button>
            </>
          ) : (
            <button type="submit" disabled={pending || !live} className={BTN_PRIMARY}>{pending ? "Saving…" : "Save changes"}</button>
          )}
        </div>
      </div>
    </form>
  );
}
