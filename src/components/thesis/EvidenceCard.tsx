// One evidence item: the observation (what was seen, when, from where, how good the data was), then the
// analyst's interpretation beneath it. Korbly-linked evidence shows its frozen snapshot; manual evidence
// shows the source the analyst supplied and says plainly that Korbly has not verified it.

import Link from "next/link";
import type { EvidenceView } from "@/lib/queries/thesis";
import { ANALYST_OBSERVATION_NOTE, EXTERNAL_NOTE, KORBLY_LINK_NOTE, OLDER_DATA_NOTE, REF_KIND_LABEL, REVISED_NOTE } from "@/lib/thesis";
import { archiveEvidenceAction } from "@/app/theses/research-actions";
import { BTN } from "./ui";
import { formatDay, NewBadge, RelevanceMark, SourceChip, StanceBadge } from "./evidence-ui";

export function SnapshotBlock({ e }: { e: Pick<EvidenceView, "snapshot" | "revisedTo" | "refKind"> }) {
  const s = e.snapshot;
  if (!s) return <p className="text-xs italic text-zinc-500 dark:text-zinc-400">The stored snapshot could not be read.</p>;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-800/40">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{s.datasetLabel}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold tabular-nums text-zinc-950 dark:text-white">{s.displayValue}</span>
        <span className="text-xs text-zinc-600 dark:text-zinc-300">observed {formatDay(s.observationDate)}</span>
        {s.quality.recency === "STALE" && <span className="rounded border border-amber-400 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">{OLDER_DATA_NOTE}</span>}
      </p>
      {s.details.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {s.details.map((d) => (
            <div key={d.label} className="flex gap-1.5"><dt className="text-zinc-500 dark:text-zinc-400">{d.label}</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100">{d.value}</dd></div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {s.source.name} · {s.source.provider} · retrieved {formatDay(s.source.retrievedAt.slice(0, 10))} · linked {formatDay(s.capturedAt.slice(0, 10))}
        {s.quality.note ? ` · ${s.quality.note}` : ""}
      </p>
      {e.revisedTo && <p className="mt-1.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">{REVISED_NOTE} Source now shows {e.revisedTo}.</p>}
    </div>
  );
}

export function EvidenceCard({ e, thesisId, editable, showStance = false }: { e: EvidenceView; thesisId: string; editable: boolean; showStance?: boolean }) {
  const external = e.sourceType === "EXTERNAL_SOURCE" || e.sourceType === "OFFICIAL_SOURCE" || e.sourceType === "COMPANY_DISCLOSURE";
  return (
    <li id={`evidence-${e.id}`} className="scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {showStance && <StanceBadge stance={e.stance} />}
        <RelevanceMark relevance={e.relevance} />
        <SourceChip type={e.sourceType} />
        {e.isNew && <NewBadge />}
      </div>
      <h4 className="mt-2 text-sm font-semibold leading-snug text-zinc-950 dark:text-white">{e.title}</h4>

      {e.sourceType === "KORBLY_DATA" ? (
        <div className="mt-2 space-y-1.5">
          <SnapshotBlock e={e} />
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{e.refKind ? `${REF_KIND_LABEL[e.refKind]}. ` : ""}{KORBLY_LINK_NOTE}</p>
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {e.detail && <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{e.detail}</p>}
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            {e.sourceType === "ANALYST_OBSERVATION" ? ANALYST_OBSERVATION_NOTE : <><span className="font-medium">{e.sourceName}</span>{e.observedAt ? ` · ${formatDay(e.observedAt)}` : ""}</>}
            {e.sourceType === "ANALYST_OBSERVATION" && e.observedAt ? ` Observed ${formatDay(e.observedAt)}.` : ""}
            {e.sourceUrl && <> · <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium text-blue-700 underline dark:text-blue-400">{e.sourceUrl}</a></>}
          </p>
          {external && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{EXTERNAL_NOTE}</p>}
        </div>
      )}

      {e.note && (
        <div className="mt-3 border-l-2 border-zinc-300 pl-3 dark:border-zinc-600">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Analyst interpretation</p>
          <p className="whitespace-pre-line text-sm text-zinc-800 dark:text-zinc-100">{e.note}</p>
        </div>
      )}
      {e.target && (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="text-zinc-500 dark:text-zinc-400">{e.target.kind === "CONDITION" ? "About the condition:" : "About the catalyst:"}</span> “{e.target.label}”{e.target.retired ? " (since reworded or removed)" : ""}
        </p>
      )}
      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Added {formatDay(e.createdAt.slice(0, 10))}</p>
      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/theses/${thesisId}/evidence/${e.id}`} className="rounded text-xs font-medium text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-400">Open &amp; edit</Link>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded text-xs font-medium text-zinc-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-300">Remove</summary>
            <form action={archiveEvidenceAction.bind(null, thesisId, e.id)} className="absolute left-0 z-20 mt-1 w-64 space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-zinc-700 dark:text-zinc-200">Remove this from the thesis? It is archived, not destroyed, and no longer counts toward the thesis.</p>
              <button type="submit" className={BTN}>Remove evidence</button>
            </form>
          </details>
        </div>
      )}
    </li>
  );
}
