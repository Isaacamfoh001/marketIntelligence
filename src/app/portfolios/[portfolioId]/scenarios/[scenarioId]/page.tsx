import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { buildTargetOptions, getScenario, runScenarioForPortfolio } from "@/lib/queries/scenarios";
import { SHOCK_UNIT_LABEL } from "@/lib/scenarios";
import { AddShockForm, EditShockForm, RenameScenarioForm } from "@/components/scenario/ScenarioForms";
import { ClassImpactTable, Contributors, Explanations, PositionResults, ScenarioMethodology, ScenarioSummary, UnavailableSection } from "@/components/scenario/ScenarioResults";
import { archiveScenarioAction, removeShockAction, restoreScenarioAction } from "../actions";

export const dynamic = "force-dynamic";

const KIND_LABEL = { ASSET_CLASS: "Asset class", ISSUER: "Issuer", SECURITY: "Security" } as const;

// Scenario detail (M8.3): the visible assumptions first, then the arithmetic they imply for the portfolio. Recomputed on every view — no result is stored.
export default async function ScenarioPage({ params, searchParams }: { params: Promise<{ portfolioId: string; scenarioId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { portfolioId, scenarioId } = await params;
  const query = await searchParams;
  const ctx = await getInstrumentContext();
  const [portfolio, scenario] = await Promise.all([getPortfolio(portfolioId, ctx), getScenario(scenarioId, ctx)]);
  if (!portfolio || !scenario || scenario.portfolioId !== portfolio.id) notFound();

  const archived = scenario.archivedAt !== null;
  const locked = archived || portfolio.archivedAt !== null;
  const result = runScenarioForPortfolio(portfolio, scenario);
  const options = buildTargetOptions(portfolio);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/portfolios" className="hover:underline">
              Portfolios
            </Link>{" "}
            /{" "}
            <Link href={`/portfolios/${portfolio.id}`} className="hover:underline">
              {portfolio.name}
            </Link>{" "}
            /{" "}
            <Link href={`/portfolios/${portfolio.id}/scenarios`} className="hover:underline">
              Scenarios
            </Link>
          </nav>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {scenario.name}
            {archived && <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Archived</span>}
          </h1>
          {scenario.description && <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{scenario.description}</p>}
        </div>
        <div>
          {archived ? (
            portfolio.archivedAt === null && (
              <form action={restoreScenarioAction.bind(null, portfolio.id, scenario.id)}>
                <button type="submit" className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  Restore scenario
                </button>
              </form>
            )
          ) : (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Archive…</summary>
              <form action={archiveScenarioAction.bind(null, portfolio.id, scenario.id)} className="absolute right-0 z-10 mt-1 w-64 rounded border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-xs text-zinc-600 dark:text-zinc-400">Archiving hides this scenario from the active list. Its assumptions are kept and it can be restored.</p>
                <button type="submit" className="mt-2 rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  Confirm archive
                </button>
              </form>
            </details>
          )}
        </div>
      </header>

      {locked && <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">{archived ? "This scenario is archived and read-only. It can still be run; restore it to change its assumptions." : "The portfolio is archived, so this scenario is read-only."}</p>}
      {query.saved && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Saved.</p>}

      <section aria-labelledby="assumptions" className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 id="assumptions" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Assumptions
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">These are the inputs you chose. The results below are what follows from them mathematically.</p>

        {scenario.shocks.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No assumptions yet — every valued position is unchanged.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Level</th>
                  <th className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Applies to</th>
                  <th className="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Shock</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {scenario.shocks.map(({ rule }) => (
                  <tr key={rule.id} className="align-top">
                    <td className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">{KIND_LABEL[rule.selector.kind]}</td>
                    <td className="px-2 py-2">
                      {rule.targetLabel}
                      <span className="ml-1.5 text-[11px] text-zinc-400">{rule.shockType === "YIELD_BPS" ? (rule.selector.kind === "ISSUER" ? "bond yield" : "yield") : rule.selector.kind === "ISSUER" ? "equity price" : "price"}</span>
                    </td>
                    <td className="px-2 py-2">
                      {locked ? (
                        <span className="tabular-nums">
                          {rule.value > 0 ? "+" : ""}
                          {rule.value} {SHOCK_UNIT_LABEL[rule.shockType]}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <EditShockForm portfolioId={portfolio.id} scenarioId={scenario.id} shockId={rule.id} value={rule.value} unit={rule.shockType} />
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">{SHOCK_UNIT_LABEL[rule.shockType]}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!locked && (
                        <form action={removeShockAction.bind(null, portfolio.id, scenario.id, rule.id)}>
                          <button type="submit" className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" aria-label={`Remove assumption for ${rule.targetLabel}`}>
                            Remove
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!locked && (
          <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <AddShockForm portfolioId={portfolio.id} scenarioId={scenario.id} options={options} />
          </div>
        )}
        {!locked && (
          <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            <summary className="cursor-pointer select-none">Rename or edit description</summary>
            <div className="mt-2">
              <RenameScenarioForm portfolioId={portfolio.id} scenarioId={scenario.id} name={scenario.name} description={scenario.description} />
            </div>
          </details>
        )}
      </section>

      {!result.ok ? (
        <section role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          <p className="font-medium">These assumptions cannot be run.</p>
          <ul className="mt-1 list-disc pl-4">
            {result.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <ScenarioSummary p={result.portfolio} />
          <Explanations lines={result.explanations} />
          <ClassImpactTable p={result.portfolio} />
          <Contributors p={result.portfolio} />
          <PositionResults positions={result.positions} />
          <UnavailableSection portfolioId={portfolio.id} positions={result.positions} />
        </>
      )}
      <ScenarioMethodology />
    </div>
  );
}
