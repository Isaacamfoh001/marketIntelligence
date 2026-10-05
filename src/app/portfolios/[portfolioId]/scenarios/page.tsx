import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { getScenarioLibrary } from "@/lib/queries/scenarios";
import { formatIsoDate } from "@/lib/fixed-income";
import { REFERENCE_INPUTS_NOTE, SCENARIO_TEMPLATES, TEMPLATE_DISCLAIMER } from "@/lib/scenario-studio";
import { CreateScenarioForm } from "@/components/scenario/ScenarioForms";
import { HypotheticalBanner, impactTone } from "@/components/scenario/ScenarioStudio";
import { createFromTemplateAction, restoreScenarioAction } from "./actions";

export const dynamic = "force-dynamic";

const BTN2 = "rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

// Scenario Studio home for one portfolio: start a test, reopen a saved one, or
// compare views. A saved scenario is a set of ASSUMPTIONS; the figures shown
// here are recalculated now from current reference inputs, not stored runs.
export default async function ScenarioStudioPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { portfolioId } = await params;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();
  const library = await getScenarioLibrary(portfolio, ctx);
  const portfolioArchived = portfolio.archivedAt !== null;
  const { active, archived } = library;

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
        <h1 className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Scenario Studio</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">Tell Korbly what you are worried about or what view you want to test. It shows what that assumption would do to this portfolio, where the effect comes from, and what deserves investigation.</p>
      </header>

      <HypotheticalBanner />

      {!portfolioArchived && (
        <section aria-labelledby="start" className="space-y-3">
          <h2 id="start" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Start a test
          </h2>
          <ul className="grid gap-3 md:grid-cols-3">
            {SCENARIO_TEMPLATES.map((t) => (
              <li key={t.id} className="flex flex-col rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</p>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{t.blurb}</p>
                <p className="mt-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{TEMPLATE_DISCLAIMER}</p>
                <form action={createFromTemplateAction.bind(null, portfolio.id, t.id)} className="mt-3">
                  <button type="submit" className={BTN2}>
                    Use this starting point
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <CreateScenarioForm portfolioId={portfolio.id} />
          </div>
        </section>
      )}

      <section aria-labelledby="saved">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 id="saved" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Saved scenarios
          </h2>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{REFERENCE_INPUTS_NOTE} Valuation date {formatIsoDate(portfolio.valuationDate)}.</p>
        </div>
        {active.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No saved scenarios yet. Pick a starting point above or start from blank.</p>
        ) : (
          <form action={`/portfolios/${portfolio.id}/scenarios/compare`} method="get">
            <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {active.map((s) => (
                <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  {active.length >= 2 ? (
                    <input type="checkbox" name="ids" value={s.id} aria-label={`Compare ${s.name}`} className="mt-1 h-4 w-4" />
                  ) : (
                    <span />
                  )}
                  <div className="min-w-0">
                    <Link href={`/portfolios/${portfolio.id}/scenarios/${s.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                      {s.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{s.assumptionSummary}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {s.primaryDriver ? `Main driver: ${s.primaryDriver} · ` : ""}
                      {s.quality ? <span className={s.quality.tone === "caution" ? "text-amber-800 dark:text-amber-300" : ""}>{s.quality.label} · </span> : null}
                      edited {formatIsoDate(s.updatedAt.slice(0, 10))}
                    </p>
                  </div>
                  <div className="col-start-2 mt-1 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:text-right">
                    {s.invalid ? (
                      <p className="text-xs text-red-700 dark:text-red-400">Cannot be run</p>
                    ) : s.impactText ? (
                      <>
                        <p className={`text-sm font-medium tabular-nums ${impactTone(s.impactGhs)}`}>
                          {s.impactText} <span className="text-xs font-normal">({s.impactPctText})</span>
                        </p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">on current inputs</p>
                      </>
                    ) : (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">No valued holdings</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {active.length >= 2 && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="submit" className={BTN2}>
                  Compare selected (2–3)
                </button>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Tick two or three scenarios to compare their consequences side by side.</span>
              </div>
            )}
          </form>
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
