import Link from "next/link";
import type { ThesisSummary } from "@/lib/queries/thesis";
import { ConfidenceMark, HorizonText, KindChip, StatusBadge, relativeDay } from "./ui";

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
      </Link>
    </li>
  );
}
