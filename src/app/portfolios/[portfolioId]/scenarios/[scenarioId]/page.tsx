import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { buildTargetOptions, getScenario, getScenarioStudio } from "@/lib/queries/scenarios";
import type { ExposureAssetClass } from "@/lib/portfolio";
import { CoreAssumptionsForm, RenameScenarioForm, SpecificAssumptionForm } from "@/components/scenario/ScenarioForms";
import { AssumptionList, DataQualityReview, Drivers, HeadlineResult, HypotheticalBanner, Investigations, Meaning, Methodology, NoticeFooter, Positions, Section } from "@/components/scenario/ScenarioStudio";
import { archiveScenarioAction, removeShockAction, restoreScenarioAction } from "../actions";

export const dynamic = "force-dynamic";

const BTN2 = "rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

// Scenario Studio — one scenario. Reading order answers, in turn: what are we
// testing → what happens → what caused it → how far to trust the inputs →
// what to investigate → the evidence. The result is recomputed on every view
// from the saved assumptions and CURRENT reference data; nothing is stored.
export default async function ScenarioPage({ params, searchParams }: { params: Promise<{ portfolioId: string; scenarioId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { portfolioId, scenarioId } = await params;
  const query = await searchParams;
  const ctx = await getInstrumentContext();
  const [portfolio, scenario] = await Promise.all([getPortfolio(portfolioId, ctx), getScenario(scenarioId, ctx)]);
  if (!portfolio || !scenario || scenario.portfolioId !== portfolio.id) notFound();

  const archived = scenario.archivedAt !== null;
  const locked = archived || portfolio.archivedAt !== null;
  const studio = await getScenarioStudio(portfolio, scenario);
  const options = buildTargetOptions(portfolio);
  const view = studio.view;

  const initial: Record<ExposureAssetClass, number | null> = { GOVERNMENT_BOND: null, CORPORATE_BOND: null, EQUITY: null };
  for (const { rule } of scenario.shocks) if (rule.selector.kind === "ASSET_CLASS") initial[rule.selector.assetClass] = rule.value;
  const editorOpen = !locked && scenario.shocks.length === 0;

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
              Scenario Studio
            </Link>
          </nav>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {scenario.name}
            {archived && <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Archived</span>}
          </h1>
          {scenario.description && <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{scenario.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/portfolios/${portfolio.id}/scenarios/compare?ids=${scenario.id}`} className={BTN2}>
            Compare with other scenarios
          </Link>
          {archived ? (
            portfolio.archivedAt === null && (
              <form action={restoreScenarioAction.bind(null, portfolio.id, scenario.id)}>
                <button type="submit" className={BTN2}>
                  Restore scenario
                </button>
              </form>
            )
          ) : (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Archive…</summary>
              <form action={archiveScenarioAction.bind(null, portfolio.id, scenario.id)} className="absolute right-0 z-10 mt-1 w-64 rounded border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-xs text-zinc-600 dark:text-zinc-400">Archiving hides this scenario from the main list. Its assumptions are kept and it can be restored.</p>
                <button type="submit" className="mt-2 rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  Confirm archive
                </button>
              </form>
            </details>
          )}
        </div>
      </header>

      <HypotheticalBanner />

      {locked && <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">{archived ? "This scenario is archived and read-only. It can still be run; restore it to change its assumptions." : "The portfolio is archived, so this scenario is read-only."}</p>}
      {query.saved && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Saved. The result below is recalculated from your assumptions.</p>}

      {/* 1. What are we testing? */}
      <Section id="testing" title="What are we testing?">
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {view ? (
            <AssumptionList
              assumptions={view.assumptions}
              removeAction={
                locked
                  ? undefined
                  : (ruleId) => (
                      <form action={removeShockAction.bind(null, portfolio.id, scenario.id, ruleId)}>
                        <button type="submit" className={BTN2} aria-label="Remove this assumption">
                          Remove
                        </button>
                      </form>
                    )
              }
            />
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">The saved assumptions cannot be run — see below.</p>
          )}

          {!locked && (
            <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <details open={editorOpen} className="group">
                <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-100">What do you want to test?</summary>
                <div className="mt-3">
                  <CoreAssumptionsForm portfolioId={portfolio.id} scenarioId={scenario.id} initial={initial} />
                </div>
              </details>
              <details className="group">
                <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-100">More specific assumptions</summary>
                <div className="mt-3 space-y-5">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">A specific assumption replaces the broader one for that issuer or security — it does not add to it.</p>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Add issuer assumption</h3>
                    <SpecificAssumptionForm portfolioId={portfolio.id} scenarioId={scenario.id} kind="ISSUER" options={options} />
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Add security assumption</h3>
                    <SpecificAssumptionForm portfolioId={portfolio.id} scenarioId={scenario.id} kind="SECURITY" options={options} />
                  </div>
                </div>
              </details>
              <details className="text-xs text-zinc-500 dark:text-zinc-400">
                <summary className="cursor-pointer select-none">Rename or edit description</summary>
                <div className="mt-2">
                  <RenameScenarioForm portfolioId={portfolio.id} scenarioId={scenario.id} name={scenario.name} description={scenario.description} />
                </div>
              </details>
            </div>
          )}
        </div>
      </Section>

      {!view ? (
        <section role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          <p className="font-medium">These assumptions cannot be run.</p>
          <ul className="mt-1 list-disc pl-4">{!studio.result.ok && studio.result.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </section>
      ) : (
        <>
          {/* 2. What happens?  (+ how far to trust the inputs, kept beside it) */}
          <Section id="happens" title="What happens?">
            <HeadlineResult h={view.headline} c={view.confidence} />
          </Section>

          {view.headline.status === "RESULT" && (
            <>
              {/* 3. What caused it? */}
              <Section id="caused" title="What caused it?">
                <Drivers byClass={view.byClass} positions={view.topPositions} direction={view.headline.direction} />
              </Section>

              <Section id="meaning" title="What this means">
                <Meaning lines={view.meaning} />
              </Section>
            </>
          )}

          {/* 5. What should I investigate? */}
          <Section id="investigate" title="What should I investigate?" hint="Investigation priorities drawn from this result — not recommendations.">
            <Investigations items={view.investigations} />
          </Section>

          {/* 6. Evidence */}
          <Section id="holdings" title="Every holding" hint="Select a holding for a plain explanation, then the full technical calculation.">
            <Positions positions={view.positions} />
          </Section>

          <DataQualityReview positions={view.positions} />
          <Methodology />
          <NoticeFooter view={view} valuationDate={portfolio.valuationDate} />
        </>
      )}
    </div>
  );
}
