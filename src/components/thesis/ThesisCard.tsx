import Link from "next/link";
import type { ThesisSummary } from "@/lib/queries/thesis";
import { ConfidenceMark, HorizonText, KindChip, StatusBadge, relativeDay } from "./ui";
import { TIMING_LABEL } from "@/lib/thesis";

/** One thesis in the research book: the belief first, the subject and status beside it. */
export function ThesisCard({ t }: { t: ThesisSummary }) {
  return (
    <li className="group rounded-xl border border-zinc-200 bg-white transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <Link href={`/theses/${t.id}`} className="block rounded-xl p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <KindChip kind={t.subjectKind} />
            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{t.subject.label}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.subject.sublabel}</span>
          </div>
          <StatusBadge status={t.status} />
        </div>
        <h3 className="mt-2.5 text-base font-semibold leading-snug tracking-tight text-zinc-950 group-hover:underline dark:text-white">{t.title}</h3>
        <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{t.belief}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <ConfidenceMark confidence={t.confidence} />
          <HorizonText horizon={t.horizon} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Updated {relativeDay(t.updatedAt)}</span>
        </div>
        <ResearchLine r={t.research} live={t.status === "ACTIVE" || t.status === "CHALLENGED"} />
      </Link>
    </li>
  );
}

/** One quiet line of research state: what is recorded, what is new, what is next — and, when it applies, that a review is suggested and why. */
export function ResearchLine({ r, live }: { r: ThesisSummary["research"]; live: boolean }) {
  const { counts } = r;
  const bits: string[] = [];
  if (counts.total > 0) bits.push(`${counts.supports} supporting · ${counts.challenges} challenging${counts.context ? ` · ${counts.context} context` : ""}`);
  if (live && r.newSinceReview > 0) bits.push(`${r.newSinceReview} new evidence ${r.newSinceReview === 1 ? "item" : "items"} since ${r.lastReviewedAt ? "last review" : "creation"}`);
  if (r.nextCatalyst) bits.push(`Next catalyst: ${r.nextCatalyst.description} · ${r.nextCatalyst.timing === "NO_DATE" || !r.nextCatalyst.timing ? r.nextCatalyst.label : `${r.nextCatalyst.label} (${TIMING_LABEL[r.nextCatalyst.timing].toLowerCase()})`}`);
  if (bits.length === 0 && !(live && r.reviewSuggested)) return null;
  return (
    <div className="mt-2.5 space-y-1">
      {live && r.reviewSuggested && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-px font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">Review suggested</span>
          <span className="text-zinc-700 dark:text-zinc-200">{r.reasons[0]?.text}{r.reasons.length > 1 ? ` +${r.reasons.length - 1} more` : ""}</span>
        </p>
      )}
      {bits.length > 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">{bits.join("  ·  ")}</p>}
    </div>
  );
}
