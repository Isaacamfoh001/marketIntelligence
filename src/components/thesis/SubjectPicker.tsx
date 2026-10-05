"use client";

// Subject picker: search equities, government bonds, corporate bonds and Treasury-bill tenors that
// exist in Korbly. Nothing is invented. Each result shows enough to avoid ambiguity.

import { useMemo, useState } from "react";
import { SUBJECT_KIND_LABEL, THESIS_SUBJECT_KINDS, type ThesisSubjectKind } from "@/lib/thesis";
import type { SubjectOption } from "@/lib/queries/thesis";
import { FIELD_FOCUS } from "./ui";

const MAX_SHOWN = 40;

export function SubjectPicker({ options, initialKey, error }: { options: SubjectOption[]; initialKey?: string | null; error?: string }) {
  const keyOf = (o: SubjectOption) => `${o.ref.type}:${o.ref.id}`;
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey ?? null);
  const [kind, setKind] = useState<ThesisSubjectKind | "ALL">("ALL");
  const [q, setQ] = useState("");
  const selected = options.find((o) => keyOf(o) === selectedKey) ?? null;

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => (kind === "ALL" || o.kind === kind) && (needle === "" || o.search.includes(needle)));
  }, [options, kind, q]);

  return (
    <div>
      <input type="hidden" name="subjectType" value={selected?.ref.type ?? ""} />
      <input type="hidden" name="subjectId" value={selected?.ref.id ?? ""} />
      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 dark:border-zinc-600 dark:bg-zinc-800/50" role="status">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{SUBJECT_KIND_LABEL[selected.kind]}</p>
            <p className="text-base font-semibold text-zinc-950 dark:text-white">{selected.label}</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-300">{selected.detail}</p>
          </div>
          <button type="button" onClick={() => setSelectedKey(null)} className={`rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-white dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800 ${FIELD_FOCUS}`}>
            Change subject
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-700 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor="subject-search">Search subjects</label>
            <input id="subject-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ticker, code or issuer" autoComplete="off" className={`min-w-[14rem] flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 ${FIELD_FOCUS}`} />
            <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1">
              {(["ALL", ...THESIS_SUBJECT_KINDS] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${kind === k ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"} ${FIELD_FOCUS}`}>
                  {k === "ALL" ? "All" : SUBJECT_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800" aria-label="Matching subjects">
            {results.slice(0, MAX_SHOWN).map((o) => (
              <li key={keyOf(o)}>
                <button type="button" onClick={() => setSelectedKey(keyOf(o))} className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${FIELD_FOCUS}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{o.label}</span>
                    <span className="rounded border border-zinc-200 px-1.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{SUBJECT_KIND_LABEL[o.kind]}</span>
                    {o.note && <span className="text-[11px] text-amber-700 dark:text-amber-400">{o.note}</span>}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{o.detail}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Nothing matches. Korbly only lists instruments it holds data for.</li>}
            {results.length > MAX_SHOWN && <li className="px-3 py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">Showing {MAX_SHOWN} of {results.length} — type more to narrow.</li>}
          </ul>
        </div>
      )}
      {error && !selected && <p role="alert" className="mt-1.5 text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
