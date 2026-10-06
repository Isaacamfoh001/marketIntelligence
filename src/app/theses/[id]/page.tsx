import Link from "next/link";
import { notFound } from "next/navigation";
import { getThesis, getThesisContext, getThesisResearch } from "@/lib/queries/thesis";
import { activationGaps, AUTHORSHIP_NOTE, CHALLENGED_MEANING, CONFIDENCE_NOTE, HORIZON_LABEL, INVALIDATED_VS_CLOSED, isEditable, normalizeContent, STATUS_LABEL, STATUS_MEANING } from "@/lib/thesis";
import { ConfidenceMark, HorizonText, KindChip, StatusBadge, BTN, relativeDay } from "@/components/thesis/ui";
import { StatusControls } from "@/components/thesis/StatusControls";
import { ContextPanel } from "@/components/thesis/ContextPanel";
import { ReviewPanel } from "@/components/thesis/ReviewPanel";
import { EvidenceSection } from "@/components/thesis/EvidenceSection";
import { CatalystSection } from "@/components/thesis/CatalystSection";
import { InvalidationList, MustBeTrueList } from "@/components/thesis/ConditionLists";
import { Timeline } from "@/components/thesis/Timeline";

export const dynamic = "force-dynamic";

const SAVED: Record<string, string> = { draft: "Draft saved.", activated: "Thesis activated.", edited: "Changes saved.", evidence: "Evidence added.", "evidence-edited": "Evidence updated.", "evidence-removed": "Evidence removed from the thesis (archived).", catalyst: "Catalyst added.", "catalyst-edited": "Catalyst updated.", "catalyst-status": "Catalyst status recorded.", "catalyst-removed": "Catalyst deleted.", flag: "Invalidation condition updated. The thesis status is unchanged.", reviewed: "Review recorded.", active: "Thesis is active.", challenged: "Marked as challenged.", invalidated: "Marked as invalidated.", closed: "Thesis closed." };

function Block({ id, title, kicker, children, tone = "plain" }: { id: string; title: string; kicker?: string; children: React.ReactNode; tone?: "plain" | "danger" }) {
  const cls = tone === "danger" ? "border-red-300 border-l-4 border-l-red-600 bg-red-50/60 dark:border-red-500/30 dark:border-l-red-400 dark:bg-red-500/5" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <section aria-labelledby={id} className={`rounded-xl border p-5 ${cls}`}>
      <h2 id={id} className={`text-sm font-semibold text-zinc-950 dark:text-white`}>{title}</h2>
      {kicker && <p className={`mt-0.5 text-sm font-medium ${tone === "danger" ? "text-red-900 dark:text-red-200" : "text-zinc-500 dark:text-zinc-400"}`}>{kicker}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Items = ({ items, empty, marker = "•" }: { items: string[]; empty: string; marker?: string }) =>
  items.length === 0 ? (
    <p className="text-sm italic text-zinc-500 dark:text-zinc-400">{empty}</p>
  ) : (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
          <span aria-hidden className="mt-px text-zinc-400 dark:text-zinc-500">{marker}</span>
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );

export default async function ThesisPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const t = await getThesis(id);
  if (!t) notFound();
  const [context, research] = await Promise.all([getThesisContext(t.subject), getThesisResearch(id)]);
  if (!research) notFound();
  const editable = isEditable(t.status);
  const must = research.conditions.filter((c) => c.kind === "MUST_BE_TRUE" && !c.retired);
  const wrong = research.conditions.filter((c) => c.kind === "INVALIDATION" && !c.retired);
  const gaps = t.status === "DRAFT" ? activationGaps(normalizeContent(t)) : [];
  const saved = q.saved ? SAVED[q.saved] : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
        <Link href="/theses" className="hover:underline">Investment theses</Link>
      </nav>

      {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">{saved}</p>}
      {q.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{q.error}</p>}

      {/* First viewport: subject · status · the belief · confidence · horizon */}
      <header className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <KindChip kind={t.subjectKind} />
            <Link href={t.subject.href} className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">{t.subject.label}</Link>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.subject.sublabel}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">· {context.held.length > 0 ? `Held in ${new Set(context.held.map((h) => h.portfolioId)).size} ${new Set(context.held.map((h) => h.portfolioId)).size === 1 ? "portfolio" : "portfolios"}` : "Not held"}</span>
          </div>
          <StatusBadge status={t.status} size="md" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-zinc-950 dark:text-white sm:text-3xl">{t.title}</h1>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">What we believe</p>
        <p className="mt-1 max-w-3xl text-lg leading-relaxed text-zinc-800 dark:text-zinc-100">{t.belief}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span title={CONFIDENCE_NOTE}><ConfidenceMark confidence={t.confidence} /></span>
            <HorizonText horizon={t.horizon} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Updated {relativeDay(t.updatedAt)}</span>
            {(t.status === "ACTIVE" || t.status === "CHALLENGED") && <span className="text-xs text-zinc-500 dark:text-zinc-400">{research.state.lastReviewedAt ? `Reviewed ${relativeDay(research.state.lastReviewedAt)}` : "Not yet reviewed"}</span>}
          </div>
          <div className="flex items-center gap-2">
            {isEditable(t.status) && <Link href={`/theses/${t.id}/edit`} className={BTN}>Edit</Link>}
            <StatusControls id={t.id} status={t.status} />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">{AUTHORSHIP_NOTE} {CONFIDENCE_NOTE}</p>
      </header>

      {t.status === "DRAFT" && (
        <p className="rounded-lg border border-dashed border-zinc-400 px-4 py-2.5 text-sm text-zinc-700 dark:border-zinc-600 dark:text-zinc-200">
          <span className="font-medium">Draft.</span> {gaps.length === 0 ? "Ready to activate." : `To activate: ${gaps.join(" ")}`}
        </p>
      )}
      {t.status === "CHALLENGED" && <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"><span className="font-medium">Challenged.</span> {CHALLENGED_MEANING}{t.statusNote ? <> Analyst note: “{t.statusNote}”</> : null}</p>}
      {(t.status === "INVALIDATED" || t.status === "CLOSED") && (
        <p className="rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-2.5 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
          <span className="font-medium">{STATUS_LABEL[t.status]}.</span> {STATUS_MEANING[t.status]} It is kept as a record of what was believed and is no longer edited. {t.statusNote ? <>Analyst note: “{t.statusNote}” </> : null}
          <span className="text-zinc-600 dark:text-zinc-300">{INVALIDATED_VS_CLOSED}</span>
        </p>
      )}

      <ReviewPanel thesisId={t.id} status={t.status} research={research} held={context.held} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Block id="why-h" title="Why we believe it">
            {t.rationale ? <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">{t.rationale}</p> : <p className="text-sm italic text-zinc-500 dark:text-zinc-400">The reasoning has not been written yet.</p>}
          </Block>
          <Block id="must-h" title="What must be true">
            <MustBeTrueList thesisId={t.id} items={must} editable={editable} />
          </Block>
          <Block id="wrong-h" title="What could prove us wrong" kicker="We should reconsider if…" tone="danger">
            <InvalidationList thesisId={t.id} items={wrong} editable={editable} />
          </Block>
          <div className="grid gap-6 md:grid-cols-2">
            <Block id="risk-h" title="What could go wrong"><Items items={t.risks} empty="None recorded." marker="•" /></Block>
            <Block id="watch-h" title="What we’re watching"><Items items={t.watching} empty="None recorded." marker="◎" /></Block>
          </div>
        </div>
        <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <ContextPanel context={context} subject={t.subject} thesisId={editable ? t.id : undefined} />
        </aside>
      </div>

      <EvidenceSection thesisId={t.id} research={research} editable={editable} />
      <CatalystSection thesisId={t.id} catalysts={research.catalysts} nextId={research.state.nextCatalystId} editable={editable} />
      <Timeline entries={research.timeline} />

      <details className="rounded-xl border border-zinc-200 px-5 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
        <summary className="cursor-pointer select-none font-medium">Record details</summary>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div><dt className="text-zinc-500 dark:text-zinc-400">Created</dt><dd>{t.createdAt.slice(0, 16).replace("T", " ")} UTC</dd></div>
          <div><dt className="text-zinc-500 dark:text-zinc-400">Last edited</dt><dd>{t.updatedAt.slice(0, 16).replace("T", " ")} UTC</dd></div>
          <div><dt className="text-zinc-500 dark:text-zinc-400">Status since</dt><dd>{t.statusChangedAt.slice(0, 16).replace("T", " ")} UTC</dd></div>
          <div><dt className="text-zinc-500 dark:text-zinc-400">Horizon</dt><dd>{t.horizon ? HORIZON_LABEL[t.horizon] : "Not set"}</dd></div>
          <div><dt className="text-zinc-500 dark:text-zinc-400">Reference</dt><dd className="font-mono">{t.id}</dd></div>
          <div><dt className="text-zinc-500 dark:text-zinc-400">Authorship</dt><dd>Analyst. No analyst identity is recorded yet.</dd></div>
        </dl>
      </details>
    </div>
  );
}
