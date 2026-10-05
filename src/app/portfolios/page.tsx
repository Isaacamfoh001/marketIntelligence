import Link from "next/link";
import { getInstrumentContext, getPortfolios, type PortfolioDetail } from "@/lib/queries/portfolio";
import { formatGhs, formatIsoDate } from "@/lib/fixed-income";
import { restorePortfolioAction } from "./actions";
import { CreatePortfolioForm } from "@/components/portfolio/CreatePortfolioForm";
import { NUM, TD, TH } from "@/components/fixed-income/ui";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Portfolios (M8.1) — answers: "which portfolio am I looking at, and what can
// we responsibly say it is worth today?". Deliberately simple: name, reference
// value, how many positions could be valued, last change. No performance
// figures — there is no cost basis or history to compute them from.
// ---------------------------------------------------------------------------

function Coverage({ p }: { p: PortfolioDetail }) {
  const s = p.summary;
  if (s.positionCount === 0) return <span className="text-zinc-400 dark:text-zinc-500">No positions</span>;
  return (
    <span className={s.isComplete ? "text-zinc-700 dark:text-zinc-300" : "text-amber-700 dark:text-amber-400"}>
      {s.valuedCount} of {s.positionCount} valued
    </span>
  );
}

export default async function PortfoliosPage() {
  const ctx = await getInstrumentContext();
  const [active, archived] = await Promise.all([getPortfolios({ archived: false }, ctx), getPortfolios({ archived: true }, ctx)]);
  const valuedOn = formatIsoDate(ctx.valuationDate.toISOString().slice(0, 10));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Portfolios</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Record Treasury-bill, bond and equity holdings and see what they can responsibly be said to be worth today. Reference values as of {valuedOn}.</p>
      </header>

      <section aria-label="Create portfolio" className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">New portfolio</h2>
        <CreatePortfolioForm />
      </section>

      <section aria-label="Active portfolios">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Active portfolios</h2>
        {active.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No portfolios yet. Create one above, then add Treasury bills, Government of Ghana bonds, corporate bonds and Ghana-listed equities.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[38rem] border-collapse text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                <tr>
                  <th className={`${TH} text-left`}>Portfolio</th>
                  <th className={`${TH} text-right`}>Reference value</th>
                  <th className={`${TH} text-right`}>Positions</th>
                  <th className={`${TH} text-left`}>Valuation coverage</th>
                  <th className={`${TH} text-left`}>Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {active.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className={TD}>
                      <Link href={`/portfolios/${p.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {p.name}
                      </Link>
                      {p.description && <div className="max-w-[22rem] truncate text-[11px] text-zinc-400 dark:text-zinc-500">{p.description}</div>}
                    </td>
                    <td className={`${NUM} font-medium`}>
                      {p.summary.referenceValueGhs === null ? <span className="font-normal text-zinc-400 dark:text-zinc-500">—</span> : formatGhs(p.summary.referenceValueGhs)}
                      {p.summary.referenceValueGhs !== null && !p.summary.isComplete && <div className="text-[10px] font-normal text-amber-700 dark:text-amber-400">valued positions only</div>}
                    </td>
                    <td className={NUM}>{p.summary.positionCount}</td>
                    <td className={TD}>
                      <Coverage p={p} />
                    </td>
                    <td className={`${TD} text-xs text-zinc-500 dark:text-zinc-400`}>{formatIsoDate(p.updatedAt.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <details className="rounded border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400">Archived ({archived.length})</summary>
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {archived.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  <Link href={`/portfolios/${p.id}`} className="text-zinc-700 hover:underline dark:text-zinc-300">
                    {p.name}
                  </Link>
                  <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{p.summary.positionCount} positions · archived {p.archivedAt ? formatIsoDate(p.archivedAt.slice(0, 10)) : ""}</span>
                </span>
                <form action={restorePortfolioAction.bind(null, p.id)}>
                  <button type="submit" className="text-xs text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-400">
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Shared internal workspace: there is no sign-in, so anyone who can open this app can change these portfolios. Not for public exposure without authentication.</p>
    </div>
  );
}
