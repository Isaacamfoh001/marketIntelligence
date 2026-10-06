// EVIDENCE on the thesis page. Supporting and challenging evidence sit in two columns so the tension is
// visible at a glance — they are not merged into one feed. Context evidence is kept below, quieter.
// No count is turned into a verdict; the summary lines are facts about what is recorded.

import Link from "next/link";
import type { EvidenceView, ThesisResearch } from "@/lib/queries/thesis";
import { EVIDENCE_EMPTY, EVIDENCE_HEADING, EVIDENCE_INTRO, EVIDENCE_NO_VERDICT, RELEVANCE_NOTE } from "@/lib/thesis";
import { BTN_PRIMARY } from "./ui";
import { EvidenceCard } from "./EvidenceCard";

function Column({ id, title, glyph, items, thesisId, editable, empty }: { id: string; title: string; glyph: string; items: EvidenceView[]; thesisId: string; editable: boolean; empty: string }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="flex items-center gap-2 border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-950 dark:border-zinc-700 dark:text-white">
        <span aria-hidden className="text-base">{glyph}</span>
        {title}
        <span className="rounded-full bg-zinc-100 px-2 py-px text-xs font-medium tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{items.length}</span>
      </h3>
      {items.length === 0 ? <p className="mt-3 text-sm italic text-zinc-500 dark:text-zinc-400">{empty}</p> : <ul className="mt-3 space-y-3">{items.map((e) => <EvidenceCard key={e.id} e={e} thesisId={thesisId} editable={editable} />)}</ul>}
    </section>
  );
}

export function EvidenceSection({ thesisId, research, editable }: { thesisId: string; research: ThesisResearch; editable: boolean }) {
  const supports = research.evidence.filter((e) => e.stance === "SUPPORTS");
  const challenges = research.evidence.filter((e) => e.stance === "CHALLENGES");
  const context = research.evidence.filter((e) => e.stance === "CONTEXT");
  const none = research.evidence.length === 0;
  return (
    <section id="evidence" aria-labelledby="evidence-h" className="scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="evidence-h" className="text-sm font-semibold text-zinc-950 dark:text-white">{EVIDENCE_HEADING}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{EVIDENCE_INTRO}</p>
        </div>
        {editable && <Link href={`/theses/${thesisId}/evidence/new`} className={BTN_PRIMARY}>Add evidence</Link>}
      </div>

      <ul className="mt-3 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-200" aria-label="Evidence summary">
        {research.state.summary.map((s) => <li key={s}>{s}</li>)}
      </ul>

      {none ? (
        <p className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{EVIDENCE_EMPTY}</p>
      ) : (
        <>
          <div className="mt-5 grid gap-x-8 gap-y-6 lg:grid-cols-2">
            <Column id="supporting-h" title="Supporting" glyph="⊕" items={supports} thesisId={thesisId} editable={editable} empty="Nothing recorded that supports the thesis." />
            <Column id="challenging-h" title="Challenging" glyph="⊖" items={challenges} thesisId={thesisId} editable={editable} empty="Nothing recorded that challenges the thesis." />
          </div>
          {context.length > 0 && (
            <details className="mt-6 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700" open={supports.length === 0 && challenges.length === 0}>
              <summary className="cursor-pointer select-none text-sm font-semibold text-zinc-900 dark:text-zinc-100">◌ Context <span className="ml-1 rounded-full bg-zinc-100 px-2 py-px text-xs font-medium tabular-nums dark:bg-zinc-800">{context.length}</span></summary>
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">{context.map((e) => <EvidenceCard key={e.id} e={e} thesisId={thesisId} editable={editable} />)}</ul>
            </details>
          )}
        </>
      )}
      <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">{EVIDENCE_NO_VERDICT} {RELEVANCE_NOTE}{research.archivedEvidenceCount > 0 ? ` ${research.archivedEvidenceCount} removed ${research.archivedEvidenceCount === 1 ? "item is" : "items are"} archived.` : ""}</p>
    </section>
  );
}
