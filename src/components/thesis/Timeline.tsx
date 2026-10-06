// The research timeline: what information arrived, by the date that applies to it. System metadata
// (when it was recorded in Korbly) stays secondary.

import Link from "next/link";
import { TIMELINE_HEADING, TIMELINE_INTRO, TIMELINE_LABEL, type TimelineEntry, type TimelineKind } from "@/lib/thesis";
import { formatDay } from "./evidence-ui";

const GLYPH: Record<TimelineKind, string> = { SUPPORTING_EVIDENCE: "⊕", CHALLENGING_EVIDENCE: "⊖", CONTEXT_EVIDENCE: "◌", CATALYST_OCCURRED: "✓", INVALIDATION_FLAGGED: "◐", THESIS_REVIEWED: "◉", THESIS_CREATED: "○" };

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <section id="timeline" aria-labelledby="timeline-h" className="scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 id="timeline-h" className="text-sm font-semibold text-zinc-950 dark:text-white">{TIMELINE_HEADING}</h2>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{TIMELINE_INTRO}</p>
      <ol className="mt-4 space-y-0">
        {entries.map((e, i) => (
          <li key={`${e.kind}-${e.recordedAt}-${i}`} className="relative grid grid-cols-[5.5rem_1.25rem_minmax(0,1fr)] gap-x-2 pb-4 last:pb-0">
            <time dateTime={e.date} className="pt-0.5 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatDay(e.date)}</time>
            <span aria-hidden className="relative flex justify-center">
              <span className="absolute inset-y-0 w-px bg-zinc-200 dark:bg-zinc-700" />
              <span className="relative z-10 mt-0.5 flex size-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[9px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">{GLYPH[e.kind]}</span>
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{TIMELINE_LABEL[e.kind]}</p>
              <p className="text-sm text-zinc-900 dark:text-zinc-100">{e.href ? <Link href={e.href} className="hover:underline">{e.title}</Link> : e.title}</p>
              {e.detail && <p className="text-xs text-zinc-600 dark:text-zinc-300">{e.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
