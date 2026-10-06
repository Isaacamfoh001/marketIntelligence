// Thesis presence on a holding (M9.1): a compact chip in the holdings list and a short panel in the
// holding drill-down. Never the whole thesis — it links to it. The portfolio stays portfolio-first.

import Link from "next/link";
import type { ThesisPresence } from "@/lib/queries/thesis";
import { HOLDING_NO_THESIS, STATUS_LABEL } from "@/lib/thesis";
import { ConfidenceMark, HorizonText, StatusBadge } from "./ui";

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";

export function ThesisChip({ presence }: { presence?: ThesisPresence }) {
  if (!presence || presence.live === 0) return null;
  const challenged = presence.lead?.status === "CHALLENGED";
  const text = presence.live === 1 ? `${challenged ? STATUS_LABEL.CHALLENGED : STATUS_LABEL.ACTIVE} thesis` : `${presence.live} active theses`;
  const review = presence.reviewSuggested ? " · Review suggested" : "";
  return (
    <Link href={presence.live === 1 && presence.lead ? `/theses/${presence.lead.id}` : "/theses?status=LIVE"} className={`mt-1 inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800 ${FOCUS}`}>
      <span aria-hidden>{challenged ? "◐" : "●"}</span>
      {text}{review}
    </Link>
  );
}

export function ThesisPanel({ presence, createHref }: { presence: ThesisPresence; createHref: string }) {
  const lead = presence.lead;
  return (
    <section aria-label="Investment thesis" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      {lead ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{lead.status === "CHALLENGED" ? "Challenged thesis" : "Active thesis"}</p>
            <StatusBadge status={lead.status} />
          </div>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{lead.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1"><ConfidenceMark confidence={lead.confidence} /><HorizonText horizon={lead.horizon} /></p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Core belief</p>
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{lead.belief}</p>
          {(lead.research.counts.total > 0 || lead.research.reviewSuggested) && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-200">
              {lead.research.counts.total > 0 && <span>{lead.research.counts.supports} supporting · {lead.research.counts.challenges} challenging</span>}
              {presence.reviewSuggested && <span className="ml-2 rounded border border-amber-400 bg-amber-50 px-1.5 py-px font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">Review suggested</span>}
            </p>
          )}
          <p className="mt-2 flex flex-wrap gap-x-4 text-xs">
            <Link href={`/theses/${lead.id}`} className={`rounded font-medium text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>View thesis</Link>
            {presence.live > 1 && <Link href="/theses?status=LIVE" className={`rounded text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>+{presence.live - 1} more live {presence.live - 1 === 1 ? "thesis" : "theses"}</Link>}
          </p>
        </>
      ) : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Investment thesis</p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">No active thesis{presence.total > 0 ? ` — ${presence.total} other ${presence.total === 1 ? "thesis exists" : "theses exist"}` : ""}.</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{HOLDING_NO_THESIS} captures why we hold this, what must be true and what would prove us wrong.</p>
          <Link href={createHref} className={`mt-2 inline-block rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800 ${FOCUS}`}>Create thesis</Link>
        </>
      )}
    </section>
  );
}
