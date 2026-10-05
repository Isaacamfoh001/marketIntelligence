// ---------------------------------------------------------------------------
// Integration: the M9.0 workspace read model against the real database. A
// template run in memory must give EXACTLY the figures the saved scenario gives
// in Scenario Studio, and building the workspace must not change anything.
// Only ZZWS portfolios/scenarios are created and removed; real instruments are read-only.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPositionsBatch, createPortfolio } from "../portfolio-service";
import { createScenarioFromTemplate } from "../scenario-service";
import { getInstrumentContext, getPortfolio, getPortfolioExposures, type InstrumentContext } from "../queries/portfolio";
import { getScenarioStudio, getScenario } from "../queries/scenarios";
import { buildWorkspace, getStressOutcome, getTemplatePreviews } from "../queries/workspace";
import { SCENARIO_TEMPLATES } from "../scenario-studio";

const db = getPrisma();
const TAG = "ZZWS";
let portfolioId: string;
let emptyId: string;
let otherId: string;
let ctx: InstrumentContext;

beforeAll(async () => {
  ctx = await getInstrumentContext();
  const real = (code: string) => code.startsWith("ZZ");
  const bond = ctx.bonds.find((b) => b.addable.addable && b.input.available && !real(b.instrumentCode) && b.instrumentType === "GOVERNMENT_BOND");
  const equities = ctx.equities.filter((e) => e.addable.addable && e.input.available && !real(e.ticker)).slice(0, 2);
  if (!bond || equities.length < 2) throw new Error("test needs real valued instruments");
  const p = await createPortfolio({ name: `${TAG} main` });
  if (!p.ok) throw new Error(p.error);
  portfolioId = p.id;
  const e = await createPortfolio({ name: `${TAG} empty` });
  if (!e.ok) throw new Error(e.error);
  emptyId = e.id;
  const o = await createPortfolio({ name: `${TAG} other` });
  if (!o.ok) throw new Error(o.error);
  otherId = o.id;
  const ro = await addPositionsBatch({ portfolioId: otherId, entries: [{ key: "e", assetClass: "EQUITY", instrumentId: equities[0].id, shares: "1,000" }] });
  if (!ro.ok) throw new Error(ro.error);
  const r = await addPositionsBatch({
    portfolioId,
    entries: [
      { key: "b", assetClass: "BOND", instrumentId: bond.id, nominalGhs: "1,000,000" },
      { key: "e1", assetClass: "EQUITY", instrumentId: equities[0].id, shares: "10,000" },
      { key: "e2", assetClass: "EQUITY", instrumentId: equities[1].id, shares: "20,000" },
    ],
  });
  if (!r.ok) throw new Error(r.error);
});

afterAll(async () => {
  await db.scenario.deleteMany({ where: { portfolio: { name: { startsWith: TAG } } } });
  await db.portfolio.deleteMany({ where: { name: { startsWith: TAG } } });
});

describe("workspace read model on real data", () => {
  it("builds hero numbers consistent with the M8.1 summary and M8.2 exposures", async () => {
    const p = (await getPortfolio(portfolioId, ctx))!;
    const e = getPortfolioExposures(p);
    const ws = buildWorkspace(p, e);
    expect(ws.holdings).toHaveLength(3);
    expect(ws.holdings.reduce((s, h) => s + (h.referenceValueGhs ?? 0), 0)).toBeCloseTo(p.summary.referenceValueGhs!, 2);
    expect(ws.holdings.reduce((s, h) => s + (h.weightPct ?? 0), 0)).toBeCloseTo(100, 6);
    expect(ws.insights.primary).not.toBeNull();
    expect(ws.insights.insights.length).toBeLessThanOrEqual(4);
  });

  it("is deterministic: two builds give the same insights", async () => {
    const p = (await getPortfolio(portfolioId, ctx))!;
    const a = buildWorkspace(p, getPortfolioExposures(p));
    const b = buildWorkspace(p, getPortfolioExposures(p));
    expect(b.insights).toEqual(a.insights);
  });

  it("an empty portfolio produces no conclusion and no error", async () => {
    const p = (await getPortfolio(emptyId, ctx))!;
    const ws = buildWorkspace(p, getPortfolioExposures(p));
    expect(ws.insights).toEqual({ primary: null, insights: [], investigations: [] });
    expect(getTemplatePreviews(p).every((t) => t.impactGhs === null)).toBe(true);
    expect(await getStressOutcome(p, ctx, { templateId: "rate-pressure" })).toBeNull();
  });

  it.each(SCENARIO_TEMPLATES.map((t) => t.id))("template %s run in memory equals the saved scenario in Scenario Studio, to the pesewa", async (templateId) => {
    const p = (await getPortfolio(portfolioId, ctx))!;
    const inMemory = (await getStressOutcome(p, ctx, { templateId }))!.insight;
    const saved = await createScenarioFromTemplate({ portfolioId, templateId });
    if (!saved.ok) throw new Error(saved.error);
    const def = (await getScenario(saved.id, ctx))!;
    const studio = await getScenarioStudio(p, def);
    expect(studio.view!.headline.impactGhs).toBe(inMemory.impactGhs);
    expect(studio.view!.headline.scenarioValueGhs).toBe(inMemory.scenarioGhs);
    // …and the same saved scenario opened through the workspace gives the same conclusion text
    const viaSaved = (await getStressOutcome(p, ctx, { scenarioId: saved.id }))!.insight;
    expect(viaSaved.fact.replace(/^Under .*?, Reference/, "Under X, Reference")).toBe(inMemory.fact.replace(/^Under .*?, Reference/, "Under X, Reference"));
    expect(inMemory.reconciles).toBe(true);
    // previews show the same figure
    expect(getTemplatePreviews(p).find((t) => t.id === templateId)!.impactGhs).toBe(inMemory.impactGhs);
  });

  it("running a template does not save anything", async () => {
    const p = (await getPortfolio(portfolioId, ctx))!;
    const before = await db.scenario.count({ where: { portfolioId } });
    await getStressOutcome(p, ctx, { templateId: "broad-selloff" });
    getTemplatePreviews(p);
    expect(await db.scenario.count({ where: { portfolioId } })).toBe(before);
  });

  it("refuses another portfolio's scenario and unknown templates", async () => {
    const p = (await getPortfolio(portfolioId, ctx))!;
    expect(await getStressOutcome(p, ctx, { templateId: "nope" })).toBeNull();
    expect(await getStressOutcome(p, ctx, { scenarioId: "nope" })).toBeNull();
    const other = (await getPortfolio(otherId, ctx))!;
    const mine = await db.scenario.findFirst({ where: { portfolioId } });
    expect(await getStressOutcome(other, ctx, { scenarioId: mine!.id })).toBeNull();
  });
});
