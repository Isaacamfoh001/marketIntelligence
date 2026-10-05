import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio, getPortfolioExposures, getPositionProvenance } from "@/lib/queries/portfolio";
import { getScenarioLibrary } from "@/lib/queries/scenarios";
import { buildWorkspace, getStressOutcome, getTemplatePreviews } from "@/lib/queries/workspace";
import { archivePortfolioAction, restorePortfolioAction } from "../actions";
import { AssetAllocationPanel, Callouts, CouponPanel, IssuerPanel, MaturityLadderPanel, RateSensitivityPanel, UpcomingMaturitiesPanel } from "@/components/portfolio/ExposurePanels";
import { EXPOSURE_COPY, valueTerms } from "@/lib/portfolio";
import type { InsightContext } from "@/lib/decision-insights";
import { GroupHeading } from "@/components/portfolio/exposure-ui";
import { MethodologyDisclosure } from "@/components/portfolio/MethodologyDisclosure";
import { PositionDrilldown } from "@/components/portfolio/PositionDrilldown";
import { UnvaluedSection } from "@/components/portfolio/PositionsTable";
import { EquitySourceNotice } from "@/components/EquitySourceNotice";
import { Hero } from "@/components/workspace/Hero";
import { HoldingsView, parseLens } from "@/components/workspace/Holdings";
import { InsightsSection, InvestigationList, PrimaryConclusionCard } from "@/components/workspace/Insights";
import { Overview } from "@/components/workspace/Overview";
import { QualityPanel } from "@/components/workspace/Quality";
import { Disclosure, FOCUS, SectionHeading } from "@/components/workspace/shared";
import { ScenarioOutcome, StressPicker } from "@/components/workspace/Stress";
import { parseView, WorkspaceTabs } from "@/components/workspace/Tabs";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Portfolio command centre (M9.0). One portfolio, five perspectives, each
// answering a different question:
//   Overview   what does it look like?     Holdings   what exactly do we own?
//   Exposure   where is risk / maturity?   Scenarios  what happens if…?
//   Insights   what deserves attention?
// The perspective is in the URL (?view=…) so a link shows what you saw. Only the
// data the chosen perspective needs is loaded.
// ---------------------------------------------------------------------------

type Query = { view?: string; lens?: string; position?: string; stress?: string; scenario?: string; duplicate?: string; saved?: string; removed?: string; added?: string; assumed?: string; unassumed?: string };

const BTN = `rounded-lg px-3.5 py-2 text-sm font-medium ${FOCUS}`;
const PRIMARY = `${BTN} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`;
const SECONDARY = `${BTN} border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`;

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ portfolioId: string }>; searchParams: Promise<Query> }) {
  const { portfolioId } = await params;
  const query = await searchParams;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();

  const view = parseView(query.view, !!query.position);
  const archived = portfolio.archivedAt !== null;
  const exposures = getPortfolioExposures(portfolio);
  // The perspective IS the question: it decides which dimension leads the insights and the headline conclusion.
  const contextOf: Record<typeof view, InsightContext> = { overview: "OVERVIEW", holdings: "OVERVIEW", exposure: "EXPOSURE", scenarios: "SCENARIO", insights: "QUALITY" };
  const ws = buildWorkspace(portfolio, exposures, contextOf[view]);
  const terms = valueTerms(portfolio.summary);
  const empty = portfolio.positions.length === 0;
  const hasBonds = portfolio.positions.some((p) => p.holding.assetClass === "BOND");
  const hasBills = portfolio.positions.some((p) => p.holding.assetClass === "TREASURY_BILL");
  const hasEquity = portfolio.positions.some((p) => p.holding.assetClass === "EQUITY");

  const selected = view === "holdings" && query.position ? portfolio.positions.find((p) => p.positionId === query.position) : undefined;
  const provenance = selected ? await getPositionProvenance(selected) : null;
  const previews = view === "overview" && !empty ? getTemplatePreviews(portfolio) : [];
  const library = view === "scenarios" && !empty ? await getScenarioLibrary(portfolio, ctx) : null;
  const outcome = view === "scenarios" && (query.stress || query.scenario) ? await getStressOutcome(portfolio, ctx, { templateId: query.stress, scenarioId: query.scenario }) : null;

  const actions = archived ? (
    <form action={restorePortfolioAction.bind(null, portfolio.id)}>
      <button type="submit" className={SECONDARY}>Restore portfolio</button>
    </form>
  ) : (
    <>
      <Link href={`/portfolios/${portfolio.id}/add`} className={PRIMARY}>Add instruments</Link>
      {!empty && (
        <Link href={`/portfolios/${portfolio.id}?view=scenarios`} className={SECONDARY}>Stress this portfolio</Link>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Hero name={portfolio.name} description={portfolio.description} summary={portfolio.summary} allocation={exposures.allocation} quality={ws.quality} holdings={ws.holdings} valuationDate={portfolio.valuationDate} archived={archived} actions={empty ? null : actions} />

      {!empty && <WorkspaceTabs portfolioId={portfolio.id} current={view} />}

      {archived && <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">This portfolio is archived and read-only. Restore it to change positions.</p>}
      {query.removed && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Position removed.</p>}
      {query.added && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Added {query.added} {query.added === "1" ? "position" : "positions"} to the portfolio.</p>}
      {hasEquity && <EquitySourceNotice mode="problem-only" />}

      {empty ? (
        <section aria-label="Empty portfolio" className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Build a portfolio to see what it is made of</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">Pick Treasury bills, Government of Ghana bonds, corporate bonds and equities. Korbly then shows allocation, concentration, maturity, rate sensitivity and how the portfolio responds to scenarios.</p>
          {archived ? (
            <form action={restorePortfolioAction.bind(null, portfolio.id)} className="mt-6">
              <button type="submit" className={SECONDARY}>Restore portfolio</button>
            </form>
          ) : (
            <Link href={`/portfolios/${portfolio.id}/add`} className={`${PRIMARY} mt-6 inline-block`}>Add instruments</Link>
          )}
        </section>
      ) : view === "overview" ? (
        <Overview portfolioId={portfolio.id} archived={archived} exposures={exposures} holdings={ws.holdings} maturity={ws.maturity} insights={ws.insights} previews={previews} />
      ) : view === "holdings" ? (
        <section aria-labelledby="holdings-h" className="space-y-4">
          <SectionHeading id="holdings-h" hint="Select a holding to see its valuation, evidence and source.">Holdings</SectionHeading>
          {selected && <PositionDrilldown portfolioId={portfolio.id} row={selected} provenance={provenance} valuationDateIso={portfolio.valuationDate} notice={query.duplicate ? "duplicate" : query.saved ? "saved" : query.assumed ? "assumed" : query.unassumed ? "unassumed" : undefined} archived={archived} />}
          <HoldingsView portfolioId={portfolio.id} holdings={ws.holdings} lens={parseLens(query.lens)} selectedId={selected?.positionId} valueLabel={terms.label} />
          <UnvaluedSection portfolioId={portfolio.id} rows={portfolio.positions} />
        </section>
      ) : view === "exposure" ? (
        <div className="space-y-6">
          <PrimaryConclusionCard conclusion={ws.insights.primary} heading="What the exposures say" />
          <Callouts callouts={exposures.callouts} />
          <section aria-label="Exposure" className="space-y-3">
            <GroupHeading note={terms.analytical ? "Built from the Analytical Starting Value — Korbly-supported valuations plus the analyst assumptions disclosed below" : "Market analytics — built from Reference Values"}>Exposure</GroupHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <AssetAllocationPanel e={exposures} />
              <IssuerPanel e={exposures} />
            </div>
          </section>
          {(hasBonds || hasBills) && (
            <>
              <section aria-label="Fixed-income profile" className="space-y-3">
                <GroupHeading note="Rate sensitivity is market-based; the ladder is contractual">Fixed-income profile</GroupHeading>
                <RateSensitivityPanel e={exposures} portfolioId={portfolio.id} />
                <MaturityLadderPanel e={exposures} portfolioId={portfolio.id} />
              </section>
              <section aria-label="Contractual cash flows" className="space-y-3">
                <GroupHeading note="Contractual — from bond and bill terms, not market data">Contractual cash flows</GroupHeading>
                <div className="grid gap-3 lg:grid-cols-2">
                  {hasBonds ? <CouponPanel e={exposures} portfolioId={portfolio.id} /> : <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">Treasury bills pay no coupon: each pays its face value once, at maturity.</p>}
                  <UpcomingMaturitiesPanel e={exposures} portfolioId={portfolio.id} />
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{EXPOSURE_COPY.contractualVsMarket}</p>
              </section>
            </>
          )}
          <MethodologyDisclosure />
        </div>
      ) : view === "scenarios" ? (
        <section aria-labelledby="scenarios-h" className="space-y-6">
          <SectionHeading id="scenarios-h" hint="Choose a hypothetical starting point or one of your saved scenarios. The assumptions are always shown with the result.">Scenarios</SectionHeading>
          <StressPicker portfolioId={portfolio.id} activeTemplate={query.stress} activeScenario={query.scenario} library={library?.active ?? []} archived={archived} />
          {outcome ? (
            <ScenarioOutcome insight={outcome.insight} portfolioId={portfolio.id} templateId={outcome.templateId} scenarioId={outcome.scenarioId} archived={archived} />
          ) : query.stress || query.scenario ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">That scenario could not be run against this portfolio.</p>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="insights-h" className="space-y-8">
          <div>
            <SectionHeading id="insights-h" hint="Deterministic: the same portfolio always produces the same insights, in the same order.">Insights</SectionHeading>
            <InsightsSection insights={ws.insights} />
          </div>
          <div>
            <SectionHeading id="insights-inv" hint="Investigation prompts with the measured reason — not recommendations.">Worth investigating</SectionHeading>
            <InvestigationList items={ws.insights.investigations} />
          </div>
          <QualityPanel quality={ws.quality} holdings={ws.holdings} summary={portfolio.summary} />
          <Disclosure summary="How insights are chosen and ranked">
            <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
              <li>Each kind of insight is ranked only against others of its own kind, by the share that fits it: composition and concentration by share of value, rate sensitivity by share of measured sensitivity, maturity by share of contractual principal, data quality by share of value on older evidence, valuation basis by share of value resting on assumptions. These shares are never compared with each other, and there is no combined score.</li>
              <li>Which kinds lead depends on what you are looking at: what is excluded first, then how much rests on assumptions, then the question of the page — composition on the Overview, rate sensitivity on Exposure, valuation basis here.</li>
              <li>Worth-investigating prompts follow their own priority, not the insight ranking: a holding with no value comes first, then a scenario driver that starts from an assumption, a material assumption, older evidence, the largest rate-sensitive holding, near-term maturities, and a majority concentration.</li>
              <li>At most four insights and three investigation prompts are shown; ties are broken in a fixed order.</li>
              <li>Insights describe the portfolio. They are not recommendations, forecasts or ratings, and Korbly does not say any level is &ldquo;too high&rdquo;.</li>
            </ul>
          </Disclosure>
        </section>
      )}

      {!archived && !empty && (
        <footer className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <Disclosure summary="Manage portfolio">
            <form action={archivePortfolioAction.bind(null, portfolio.id)} className="max-w-md rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Archiving hides this portfolio from the active list. Its positions are kept and it can be restored.</p>
              <button type="submit" className={`mt-2 rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800 ${FOCUS}`}>Confirm archive</button>
            </form>
            <p className="mt-3 text-xs"><Link href={`/portfolios/${portfolio.id}/scenarios`} className={`rounded text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>Open Scenario Studio</Link></p>
          </Disclosure>
        </footer>
      )}
    </div>
  );
}
