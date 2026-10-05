// ---------------------------------------------------------------------------
// Portfolio Decision Workspace read model (M9.0). Field mapping and wiring only:
// the portfolio is valued (M8.1) and its exposures computed (M8.2) ONCE by the
// caller; scenarios are the M8.3 engine run in memory; interpretation is the
// pure decision-insights layer. Nothing financial is calculated here and
// nothing is stored.
// ---------------------------------------------------------------------------

import { buildDecisionInsights, buildHoldings, buildMaturityProfile, buildQuality, buildScenarioInsight, type DecisionInsights, type HoldingView, type MaturityProfile, type QualityView, type ScenarioInsight, type WorkspaceInput } from "../decision-insights";
import type { PortfolioExposures } from "../portfolio";
import { runScenario } from "../scenarios";
import { buildStudioView, getTemplate, SCENARIO_TEMPLATES, summariseAssumptions, templateToRules } from "../scenario-studio";
import type { InstrumentContext, PortfolioDetail } from "./portfolio";
import { toExposurePositions } from "./portfolio";
import { getPositionLinks, getScenario, runScenarioForPortfolio, toScenarioPositions } from "./scenarios";

export interface Workspace {
  input: WorkspaceInput;
  holdings: HoldingView[];
  maturity: MaturityProfile;
  quality: QualityView;
  insights: DecisionInsights;
}

/** Pure assembly from an already-valued portfolio and its exposures. */
export function buildWorkspace(portfolio: PortfolioDetail, exposures: PortfolioExposures): Workspace {
  const input: WorkspaceInput = { portfolioId: portfolio.id, valuationDate: portfolio.valuationDate, summary: portfolio.summary, exposures, positions: toExposurePositions(portfolio.positions) };
  const holdings = buildHoldings(input);
  return { input, holdings, maturity: buildMaturityProfile(input), quality: buildQuality(input, holdings), insights: buildDecisionInsights(input) };
}

export interface TemplatePreview {
  id: string;
  name: string;
  blurb: string;
  assumptionSummary: string;
  impactText: string | null;
  impactPctText: string | null;
  impactGhs: number | null;
}

/** Each template run in memory against this portfolio — shown WITH its assumption summary, never saved. */
export function getTemplatePreviews(portfolio: PortfolioDetail): TemplatePreview[] {
  const positions = toScenarioPositions(portfolio.positions);
  const valuationDate = new Date(`${portfolio.valuationDate}T00:00:00.000Z`);
  return SCENARIO_TEMPLATES.map((t) => {
    const rules = templateToRules(t);
    const result = positions.length > 0 ? runScenario({ valuationDate, positions, rules }) : null;
    const view = result && result.ok ? buildStudioView({ result, links: {}, provenance: {} }) : null;
    const shown = view && view.headline.status === "RESULT";
    return { id: t.id, name: t.name, blurb: t.blurb, assumptionSummary: summariseAssumptions(rules, 4), impactText: shown ? view!.headline.impactWhole : null, impactPctText: shown ? view!.headline.impactPctText : null, impactGhs: shown ? view!.headline.impactGhs : null };
  });
}

export interface StressOutcome {
  insight: ScenarioInsight;
  templateId?: string;
  scenarioId?: string;
}

/** The full outcome of one template (in memory) or one saved scenario, for the Scenarios perspective. */
export async function getStressOutcome(portfolio: PortfolioDetail, ctx: InstrumentContext, pick: { templateId?: string; scenarioId?: string }): Promise<StressOutcome | null> {
  if (portfolio.positions.length === 0) return null;
  let name: string;
  let result;
  if (pick.scenarioId) {
    const def = await getScenario(pick.scenarioId, ctx);
    if (!def || def.portfolioId !== portfolio.id) return null;
    name = def.name;
    result = runScenarioForPortfolio(portfolio, def);
  } else if (pick.templateId) {
    const t = getTemplate(pick.templateId);
    if (!t) return null;
    name = t.name;
    result = runScenario({ valuationDate: new Date(`${portfolio.valuationDate}T00:00:00.000Z`), positions: toScenarioPositions(portfolio.positions), rules: templateToRules(t) });
  } else return null;
  if (!result.ok) return null;
  const links = await getPositionLinks(portfolio);
  const view = buildStudioView({ result, links, provenance: {} });
  return { insight: buildScenarioInsight({ name, portfolioId: portfolio.id, view, result }), templateId: pick.templateId, scenarioId: pick.scenarioId };
}
