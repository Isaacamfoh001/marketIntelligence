// Small shared pieces for the thesis workspace. Status is never colour alone: each state has a
// glyph and a word. Server-component safe.

import { CONFIDENCE_LABEL, HORIZON_LABEL, STATUS_LABEL, STATUS_MEANING, SUBJECT_KIND_LABEL, type ThesisConfidence, type ThesisHorizon, type ThesisStatus, type ThesisSubjectKind } from "@/lib/thesis";

const STATUS_STYLE: Record<ThesisStatus, { glyph: string; cls: string }> = {
  DRAFT: { glyph: "○", cls: "border-dashed border-zinc-400 bg-zinc-50 text-zinc-700 dark:border-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-200" },
  ACTIVE: { glyph: "●", cls: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200" },
  CHALLENGED: { glyph: "◐", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" },
  INVALIDATED: { glyph: "✕", cls: "border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200" },
  CLOSED: { glyph: "■", cls: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};

export function StatusBadge({ status, size = "sm" }: { status: ThesisStatus; size?: "sm" | "md" }) {
  const s = STATUS_STYLE[status];
  return (
    <span title={STATUS_MEANING[status]} className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"} ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

const CONF_BARS: Record<ThesisConfidence, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Analyst-declared confidence: three bars plus the word. Not a score. */
export function ConfidenceMark({ confidence, withLabel = true }: { confidence: ThesisConfidence | null; withLabel?: boolean }) {
  if (!confidence) return <span className="text-xs text-zinc-500 dark:text-zinc-400">Confidence not set</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`w-1 rounded-sm ${n <= CONF_BARS[confidence] ? "bg-zinc-800 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ height: 4 + n * 3 }} />
        ))}
      </span>
      {withLabel && <span>{CONFIDENCE_LABEL[confidence]} confidence</span>}
    </span>
  );
}

export const HorizonText = ({ horizon }: { horizon: ThesisHorizon | null }) => <span className="text-xs text-zinc-700 dark:text-zinc-300">{horizon ? `${HORIZON_LABEL[horizon]} horizon` : "Horizon not set"}</span>;

const KIND_CLS: Record<ThesisSubjectKind, string> = {
  EQUITY: "bg-[var(--c-eq)]",
  GOVERNMENT_BOND: "bg-[var(--c-gov)]",
  CORPORATE_BOND: "bg-[var(--c-corp)]",
  TREASURY_BILL: "bg-[var(--c-bill)]",
};

export function KindChip({ kind }: { kind: ThesisSubjectKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
      <span className={`size-2 rounded-sm ${KIND_CLS[kind]}`} aria-hidden />
      {SUBJECT_KIND_LABEL[kind]}
    </span>
  );
}

export const FIELD_FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
export const BTN = `rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ${FIELD_FOCUS}`;
export const BTN_PRIMARY = `rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${FIELD_FOCUS}`;

export const relativeDay = (isoTs: string, now = new Date()): string => {
  const days = Math.floor((now.getTime() - new Date(isoTs).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return isoTs.slice(0, 10);
};
