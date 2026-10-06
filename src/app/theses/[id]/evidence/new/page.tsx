import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getThesis, getThesisResearch } from "@/lib/queries/thesis";
import { datasetId, describeObservation, findObservationId, listDatasets, listObservations, parseDatasetId } from "@/lib/queries/thesis-evidence";
import { CONTEXT_VS_EVIDENCE, isRefKind, KORBLY_LINK_NOTE } from "@/lib/thesis";
import { addEvidenceAction } from "../../../research-actions";
import { EvidenceForm } from "@/components/thesis/EvidenceForm";
import { SnapshotBlock } from "@/components/thesis/EvidenceCard";
import { BTN } from "@/components/thesis/ui";
import { formatDay, INPUT, LABEL } from "@/components/thesis/evidence-ui";

export const dynamic = "force-dynamic";

type Query = { via?: string; dataset?: string; obs?: string; kind?: string; date?: string; condition?: string; catalyst?: string };

const TAB = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${on ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;

export default async function AddEvidencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const q = await searchParams;
  const t = await getThesis(id);
  if (!t) notFound();
  if (t.status === "INVALIDATED" || t.status === "CLOSED") redirect(`/theses/${id}`);
  const research = await getThesisResearch(id);
  const targets = { conditions: research!.conditions.filter((c) => !c.retired).map((c) => ({ id: c.id, kind: c.kind, text: c.text })), catalysts: research!.catalysts.map((c) => ({ id: c.id, description: c.description })) };
  const carry = new URLSearchParams();
  if (q.condition) carry.set("condition", q.condition);
  if (q.catalyst) carry.set("catalyst", q.catalyst);
  const base = `/theses/${id}/evidence/new`;
  const withCarry = (extra: Record<string, string>) => {
    const p = new URLSearchParams(carry);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${base}?${p.toString()}`;
  };
  const initial = { conditionId: q.condition ?? null, catalystId: q.catalyst ?? null };

  // "Add to evidence" from Current Korbly context arrives as ?kind=…&date=… — resolved against THIS thesis's subject.
  let dataset = q.dataset;
  let obsId = q.obs;
  if (!dataset && q.kind && q.date && isRefKind(q.kind)) {
    const found = await findObservationId(q.kind, t.subject.ref.id, q.date);
    if (found) {
      dataset = datasetId(q.kind, t.subject.ref.id);
      obsId = found;
    }
  }
  const via = q.via === "manual" ? "manual" : dataset || q.via === "korbly" || q.kind ? "korbly" : "choose";
  const parsed = parseDatasetId(dataset);
  const datasets = via === "korbly" ? await listDatasets(t.subject) : [];
  const observations = parsed ? await listObservations(parsed.kind, parsed.key) : [];
  const chosen = parsed && obsId ? await describeObservation(parsed.kind, obsId) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/theses" className="hover:underline">Investment theses</Link> / <Link href={`/theses/${id}`} className="hover:underline">{t.title}</Link>
        </nav>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">Add evidence</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Attach an observation to this thesis and say how you read it. {CONTEXT_VS_EVIDENCE}</p>
      </header>

      <nav aria-label="Kind of evidence" className="flex flex-wrap gap-2">
        <Link href={withCarry({ via: "korbly" })} aria-current={via === "korbly" ? "true" : undefined} className={TAB(via === "korbly")}>From Korbly data</Link>
        <Link href={withCarry({ via: "manual" })} aria-current={via === "manual" ? "true" : undefined} className={TAB(via === "manual")}>Write it in</Link>
      </nav>

      {via === "choose" && <p className="rounded-xl border border-dashed border-zinc-300 px-5 py-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">Choose <strong>From Korbly data</strong> to freeze an existing observation (inflation, a Treasury rate, a trade…) as evidence, or <strong>Write it in</strong> for an analyst observation, an official publication, a company disclosure or an outside source.</p>}

      {via === "manual" && <EvidenceForm mode="manual" action={addEvidenceAction.bind(null, id)} targets={targets} initial={initial} cancelHref={`/theses/${id}#evidence`} />}

      {via === "korbly" && (
        <div className="space-y-6">
          <form method="get" action={base} className="space-y-2" role="search" aria-label="Choose a Korbly dataset">
            <input type="hidden" name="via" value="korbly" />
            {q.condition && <input type="hidden" name="condition" value={q.condition} />}
            {q.catalyst && <input type="hidden" name="catalyst" value={q.catalyst} />}
            <label htmlFor="dataset" className={LABEL}>1. Which Korbly dataset?</label>
            <div className="flex flex-wrap gap-2">
              <select id="dataset" name="dataset" defaultValue={dataset ?? ""} className={`${INPUT} min-w-64 flex-1`}>
                <option value="">Choose…</option>
                {(["About this thesis", "Macro", "Rates & FX"] as const).map((g) => (datasets.some((d) => d.group === g) ? <optgroup key={g} label={g}>{datasets.filter((d) => d.group === g).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</optgroup> : null))}
              </select>
              <button type="submit" className={BTN}>Show observations</button>
            </div>
          </form>

          {parsed && (
            <form method="get" action={base} className="space-y-2" aria-label="Choose an observation">
              <input type="hidden" name="via" value="korbly" />
              <input type="hidden" name="dataset" value={dataset} />
              {q.condition && <input type="hidden" name="condition" value={q.condition} />}
              {q.catalyst && <input type="hidden" name="catalyst" value={q.catalyst} />}
              <fieldset>
                <legend className={LABEL}>2. Which observation?</legend>
                {observations.length === 0 ? <p className="text-sm italic text-zinc-500 dark:text-zinc-400">No linkable observations in this dataset.</p> : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                    {observations.map((o) => (
                      <li key={o.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 dark:hover:bg-zinc-800">
                          <input type="radio" name="obs" value={o.id} defaultChecked={o.id === obsId} />
                          <span className="w-28 tabular-nums text-zinc-600 dark:text-zinc-300">{formatDay(o.date)}</span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{o.summary}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              {observations.length > 0 && <button type="submit" className={BTN}>Preview</button>}
            </form>
          )}

          {chosen && !chosen.ok && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{chosen.error}</p>}

          {chosen?.ok && parsed && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-zinc-950 dark:text-white">3. Your reading</h2>
              <EvidenceForm
                mode="link"
                action={addEvidenceAction.bind(null, id)}
                targets={targets}
                initial={initial}
                link={{ refKind: parsed.kind, refId: chosen.refId }}
                cancelHref={`/theses/${id}#evidence`}
                preview={<div className="space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">This observation will be frozen as shown</p><SnapshotBlock e={{ snapshot: chosen.snapshot, revisedTo: null, refKind: parsed.kind }} /><p className="text-[11px] text-zinc-500 dark:text-zinc-400">{KORBLY_LINK_NOTE}</p></div>}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
