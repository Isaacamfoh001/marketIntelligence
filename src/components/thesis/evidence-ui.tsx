// Small shared pieces for evidence, catalysts and review (M9.2). Stance is never colour alone — each
// has a glyph and a word — and deliberately avoids green/red: "supports" and "challenges" describe a
// relationship to the thesis, not whether something is good or bad for an investment.

import { CATALYST_STATUS_LABEL, FLAG_LABEL, RELEVANCE_LABEL, SOURCE_TYPE_LABEL, STANCE_LABEL, STANCE_MEANING, TIMING_LABEL, type CatalystStatus, type CatalystTiming, type EvidenceRelevance, type EvidenceSourceType, type EvidenceStance, type InvalidationFlag } from "@/lib/thesis";

const STANCE_STYLE: Record<EvidenceStance, { glyph: string; cls: string }> = {
  SUPPORTS: { glyph: "⊕", cls: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200" },
  CHALLENGES: { glyph: "⊖", cls: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-200" },
  CONTEXT: { glyph: "◌", cls: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-200" },
};

export function StanceBadge({ stance }: { stance: EvidenceStance }) {
  const s = STANCE_STYLE[stance];
  return (
    <span title={STANCE_MEANING[stance]} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span>
      {STANCE_LABEL[stance]}
    </span>
  );
}

/** Three pips plus the words — the analyst's coarse label, not a measure. */
export function RelevanceMark({ relevance }: { relevance: EvidenceRelevance }) {
  const n = relevance === "HIGH" ? 3 : relevance === "MEDIUM" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => <span key={i} className={`size-1.5 rounded-full ${i <= n ? "bg-zinc-800 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-600"}`} />)}
      </span>
      {RELEVANCE_LABEL[relevance]}
    </span>
  );
}

export const SourceChip = ({ type }: { type: EvidenceSourceType }) => (
  <span className="rounded border border-zinc-300 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">{SOURCE_TYPE_LABEL[type]}</span>
);

export const NewBadge = () => <span className="rounded bg-zinc-900 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">New since review</span>;

const FLAG_STYLE: Record<InvalidationFlag, { glyph: string; cls: string }> = {
  NOT_OBSERVED: { glyph: "○", cls: "border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300" },
  POTENTIALLY_TRIGGERED: { glyph: "◐", cls: "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100" },
  TRIGGERED: { glyph: "●", cls: "border-red-400 bg-red-50 text-red-950 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-100" },
};
export const FlagBadge = ({ flag }: { flag: InvalidationFlag }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${FLAG_STYLE[flag].cls}`}>
    <span aria-hidden>{FLAG_STYLE[flag].glyph}</span>
    {FLAG_LABEL[flag]}
  </span>
);

const CAT_STYLE: Record<CatalystStatus, string> = {
  WATCHING: "border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200",
  OCCURRED: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200",
  MISSED: "border-zinc-400 bg-zinc-100 text-zinc-800 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-200",
  NO_LONGER_RELEVANT: "border-dashed border-zinc-400 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400",
};
const CAT_GLYPH: Record<CatalystStatus, string> = { WATCHING: "◎", OCCURRED: "✓", MISSED: "–", NO_LONGER_RELEVANT: "∅" };
export const CatalystStatusBadge = ({ status }: { status: CatalystStatus }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${CAT_STYLE[status]}`}>
    <span aria-hidden>{CAT_GLYPH[status]}</span>
    {CATALYST_STATUS_LABEL[status]}
  </span>
);

export const TimingBadge = ({ timing }: { timing: CatalystTiming }) => (
  <span className={`rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${timing === "WINDOW_PASSED" ? "border-amber-400 text-amber-900 dark:text-amber-200" : "border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"}`}>{TIMING_LABEL[timing]}</span>
);

export const INPUT = "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500";
export const LABEL = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300";
export const POPOVER = "fixed inset-x-4 bottom-4 z-30 max-h-[80vh] overflow-y-auto sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:z-20 sm:mt-2 sm:max-h-none sm:w-[24rem] sm:overflow-visible space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900";

export const formatDay = (iso: string) => {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(iso.slice(8, 10))} ${M[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
};
