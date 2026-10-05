import Link from "next/link";
import { listTheses } from "@/lib/queries/thesis";
import { filterTheses, isConfidence, isStatus, isSubjectKind, STATUS_LABEL, THESIS_CONFIDENCES, THESIS_STATUSES, THESIS_SUBJECT_KINDS, CONFIDENCE_LABEL, SUBJECT_KIND_LABEL, THESIS_FILTER_EMPTY, THESIS_LIBRARY_EMPTY, type ThesisStatus } from "@/lib/thesis";
import { ThesisCard } from "@/components/thesis/ThesisCard";
import { BTN, BTN_PRIMARY, FIELD_FOCUS } from "@/components/thesis/ui";

export const dynamic = "force-dynamic";

type Query = { q?: string; status?: string; kind?: string; confidence?: string };

const SELECT = `rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 ${FIELD_FOCUS}`;

// The research book: what are we currently thinking about? Filters live in the URL (shareable, works without JS).
export default async function ThesesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const all = await listTheses();
  const status = query.status === "LIVE" ? "LIVE" : isStatus(query.status) ? query.status : null;
  const kind = isSubjectKind(query.kind) ? query.kind : null;
  const confidence = isConfidence(query.confidence) ? query.confidence : null;
  const q = (query.q ?? "").slice(0, 80);
  const shown = filterTheses(all, { q, status, subjectKind: kind, confidence });
  const filtered = Boolean(q || status || kind || confidence);

  const count = (s: ThesisStatus) => all.filter((t) => t.status === s).length;
  const live = all.filter((t) => t.status === "ACTIVE" || t.status === "CHALLENGED").length;
  const chipHref = (s: string | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("status", s);
    if (kind) p.set("kind", kind);
    if (confidence) p.set("confidence", confidence);
    const qs = p.toString();
    return qs ? `/theses?${qs}` : "/theses";
  };
  const chips: { id: string | null; label: string; n: number }[] = [{ id: null, label: "All", n: all.length }, { id: "LIVE", label: "Live", n: live }, ...THESIS_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], n: count(s) }))];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">Investment theses</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">What are we currently thinking about, and why? Each thesis is written by an analyst; Korbly keeps it beside the market and portfolio data.</p>
        </div>
        <Link href="/theses/new" className={BTN_PRIMARY}>New thesis</Link>
      </header>

      {all.length === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700" aria-label="No theses yet">
          <p className="mx-auto max-w-lg text-base leading-relaxed text-zinc-700 dark:text-zinc-200">{THESIS_LIBRARY_EMPTY}</p>
          <Link href="/theses/new" className={`mt-5 inline-block ${BTN_PRIMARY}`}>Create thesis</Link>
        </section>
      ) : (
        <>
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {chips.map((c) => {
              const on = (status ?? null) === c.id;
              return (
                <Link key={c.label} href={chipHref(c.id)} aria-current={on ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"} ${FIELD_FOCUS}`}>
                  {c.label} <span className="tabular-nums opacity-70">{c.n}</span>
                </Link>
              );
            })}
          </nav>

          <form method="get" action="/theses" className="flex flex-wrap items-end gap-3" role="search" aria-label="Search and filter theses">
            {status && <input type="hidden" name="status" value={status} />}
            <div className="min-w-56 flex-1">
              <label htmlFor="q" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Search title or subject</label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="e.g. MTN, duration" className={`w-full ${SELECT}`} />
            </div>
            <div>
              <label htmlFor="kind" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Asset class</label>
              <select id="kind" name="kind" defaultValue={kind ?? ""} className={SELECT}>
                <option value="">All</option>
                {THESIS_SUBJECT_KINDS.map((k) => <option key={k} value={k}>{SUBJECT_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="confidence" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Confidence</label>
              <select id="confidence" name="confidence" defaultValue={confidence ?? ""} className={SELECT}>
                <option value="">Any</option>
                {THESIS_CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
              </select>
            </div>
            <button type="submit" className={BTN}>Apply</button>
            {filtered && <Link href="/theses" className="pb-2 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">Clear filters</Link>}
          </form>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{THESIS_FILTER_EMPTY} <Link href="/theses" className="font-medium text-blue-700 underline dark:text-blue-400">Show all</Link></p>
          ) : (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">{shown.length} of {all.length} {all.length === 1 ? "thesis" : "theses"}</p>
              <ul className="space-y-3">{shown.map((t) => <ThesisCard key={t.id} t={t} />)}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
