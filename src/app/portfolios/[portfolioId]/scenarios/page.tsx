import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { getScenarios } from "@/lib/queries/scenarios";
import { formatIsoDate } from "@/lib/fixed-income";
import { CreateScenarioForm } from "@/components/scenario/ScenarioForms";
import { restoreScenarioAction } from "./actions";

export const dynamic = "force-dynamic";

// Scenario list for one portfolio (M8.3). A scenario is a saved set of assumptions — never a forecast.
export default async function ScenariosPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { portfolioId } = await params;
  const portfolio = await getPortfolio(portfolioId, await getInstrumentContext());
  if (!portfolio) notFound();
  const [active, archived] = await Promise.all([getScenarios(portfolioId, { archived: false }), getScenarios(portfolioId, { archived: true })]);
  const portfolioArchived = portfolio.archivedAt !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/portfolios" className="hover:underline">
            Portfolios
          </Link>{" "}
          /{" "}
          <Link href={`/portfolios/${portfolio.id}`} className="hover:underline">
            {portfolio.name}
          </Link>
        </nav>
        <h1 className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Scenarios</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">A scenario is a set of assumptions you choose to test. Korbly shows the arithmetic effect on this portfolio if they held; it does not predict that they will.</p>
      </header>

      {!portfolioArchived && (
        <section aria-label="New scenario" className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <CreateScenarioForm portfolioId={portfolio.id} />
        </section>
      )}

      <section aria-labelledby="active">
        <h2 id="active" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Saved scenarios
        </h2>
        {active.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No scenarios yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {active.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <Link href={`/portfolios/${portfolio.id}/scenarios/${s.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                    {s.name}
                  </Link>
                  {s.description && <div className="max-w-xl truncate text-[11px] text-zinc-400 dark:text-zinc-500">{s.description}</div>}
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {s.shockCount} assumption{s.shockCount === 1 ? "" : "s"} · updated {formatIsoDate(s.updatedAt.slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <details className="rounded border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Archived ({archived.length})</summary>
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {archived.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <Link href={`/portfolios/${portfolio.id}/scenarios/${s.id}`} className="text-zinc-700 hover:underline dark:text-zinc-300">
                  {s.name}
                </Link>
                {!portfolioArchived && (
                  <form action={restoreScenarioAction.bind(null, portfolio.id, s.id)}>
                    <button type="submit" className="text-xs text-blue-700 hover:underline dark:text-blue-400">
                      Restore
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
