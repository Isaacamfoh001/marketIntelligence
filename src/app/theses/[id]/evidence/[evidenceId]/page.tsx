import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getThesis, getThesisResearch } from "@/lib/queries/thesis";
import { getPrisma } from "@/lib/prisma";
import { updateEvidenceAction } from "../../../research-actions";
import { EvidenceForm } from "@/components/thesis/EvidenceForm";
import { SnapshotBlock } from "@/components/thesis/EvidenceCard";
import { REVISED_NOTE } from "@/lib/thesis";

export const dynamic = "force-dynamic";

// Evidence detail + edit. Manual evidence is fully editable. For Korbly-linked evidence the observation is
// frozen: it is shown here, read-only, and only stance, relevance, note and target can change.
export default async function EvidencePage({ params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await params;
  const t = await getThesis(id);
  if (!t) notFound();
  const research = await getThesisResearch(id);
  const ev = research?.evidence.find((e) => e.id === evidenceId);
  if (!research || !ev) notFound();
  if (t.status === "INVALIDATED" || t.status === "CLOSED") redirect(`/theses/${id}#evidence-${evidenceId}`);
  const row = await getPrisma().thesisEvidence.findUnique({ where: { id: evidenceId }, select: { conditionId: true, catalystId: true } });
  const linked = ev.sourceType === "KORBLY_DATA";
  const targets = { conditions: research.conditions.filter((c) => !c.retired).map((c) => ({ id: c.id, kind: c.kind, text: c.text })), catalysts: research.catalysts.map((c) => ({ id: c.id, description: c.description })) };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/theses" className="hover:underline">Investment theses</Link> / <Link href={`/theses/${id}`} className="hover:underline">{t.title}</Link>
        </nav>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">{linked ? "Linked Korbly evidence" : "Evidence"}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{ev.title}</p>
      </header>
      <EvidenceForm
        mode={linked ? "edit-linked" : "edit-manual"}
        action={updateEvidenceAction.bind(null, id, evidenceId)}
        targets={targets}
        cancelHref={`/theses/${id}#evidence-${evidenceId}`}
        initial={{ stance: ev.stance, relevance: ev.relevance, sourceType: linked ? null : (ev.sourceType as "OFFICIAL_SOURCE"), title: ev.title, detail: ev.detail ?? "", note: ev.note ?? "", observedAt: ev.observedAt, sourceName: ev.sourceName ?? "", sourceUrl: ev.sourceUrl ?? "", conditionId: row?.conditionId ?? null, catalystId: row?.catalystId ?? null }}
        preview={linked ? <div className="space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">The observation (frozen — it cannot be edited)</p><SnapshotBlock e={ev} /><p className="text-[11px] text-zinc-500 dark:text-zinc-400">{ev.revisedTo ? REVISED_NOTE : "You can change how you read it, never what it said."}</p></div> : undefined}
      />
    </div>
  );
}
