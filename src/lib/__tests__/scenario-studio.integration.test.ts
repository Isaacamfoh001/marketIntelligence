// ---------------------------------------------------------------------------
// Integration tests for M8.4 Scenario Studio writes and read paths — real
// database. Owns ZZSS-prefixed rows and removes them afterwards; reuses (read
// only) one real source + ingestion run purely to satisfy provenance foreign
// keys. Every assertion is on rows this file created.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPosition, createPortfolio, setPortfolioArchived } from "../portfolio-service";
import { createScenario, createScenarioFromTemplate, setAssetClassAssumptions, upsertShock } from "../scenario-service";
import { getInstrumentContext, getPortfolio } from "../queries/portfolio";
import { getPositionLinks, getScenario, getScenarioComparison, getScenarioLibrary, getScenarioStudio } from "../queries/scenarios";
import { SCENARIO_TEMPLATES, toShockValue } from "../scenario-studio";
import { toValuationDate } from "../fixed-income";

const db = getPrisma();
const TAG = "ZZSS";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dayOffset = (n: number) => new Date(toValuationDate(new Date()).getTime() + n * 86_400_000);

let sourceId: string;
let runId: string;
let companyId: string;
let bondId: string;
let equityId: string;

async function newPortfolio() {
  const r = await createPortfolio({ name: `${TAG} ${Math.random().toString(36).slice(2, 8)}` });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function newScenario(portfolioId: string, name = `${TAG} scenario`) {
  const r = await createScenario({ portfolioId, name });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
const shocksOf = (scenarioId: string) => db.scenarioShock.findMany({ where: { scenarioId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  sourceId = run.dataSourceId;
  runId = run.id;
  companyId = (await db.company.create({ data: { name: `${TAG} Company` } })).id;
  bondId = (
    await db.fixedIncomeSecurity.create({
      data: { instrumentCode: `${TAG}B1`, instrumentName: `${TAG} bond`, issuerName: `${TAG} Issuer`, instrumentType: "CORPORATE_BOND", classification: "CORPORATE", issueDate: d("2025-01-01"), maturityDate: d("2031-01-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", sourceId, ingestionRunId: runId },
    })
  ).id;
  equityId = (await db.security.create({ data: { companyId, ticker: `${TAG}E1` } })).id;
  await db.securityPrice.create({ data: { securityId: equityId, tradingDate: dayOffset(-1), closeVwap: "10", volume: 5000, sourceId, ingestionRunId: runId } });
  await db.fixedIncomeObservation.create({ data: { securityId: bondId, observationDate: dayOffset(-2), sourceYieldPct: "25", observationKind: "SECONDARY_MARKET", tradeStatus: "TRADED", volumeTradedGhs: "1000000", numberOfTrades: 3, sourceId, ingestionRunId: runId } });
});

afterAll(async () => {
  await db.portfolio.deleteMany({ where: { name: { startsWith: TAG } } });
  await db.fixedIncomeObservation.deleteMany({ where: { security: { instrumentCode: { startsWith: TAG } } } });
  await db.securityPrice.deleteMany({ where: { security: { ticker: { startsWith: TAG } } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { startsWith: TAG } } });
  await db.security.deleteMany({ where: { ticker: { startsWith: TAG } } });
  await db.company.deleteMany({ where: { name: `${TAG} Company` } });
});

describe("upsertShock (set semantics)", () => {
  it("creates once, then updates the same row — never a duplicate", async () => {
    const sid = await newScenario(await newPortfolio());
    const target = { kind: "SECURITY", instrument: "BOND", instrumentId: bondId } as const;
    const a = await upsertShock({ scenarioId: sid, target, value: 400 });
    const b = await upsertShock({ scenarioId: sid, target, value: 250 });
    expect(a.ok && b.ok && a.shockId === b.shockId).toBe(true);
    const rows = await shocksOf(sid);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].value)).toBe(250);
  });
  it("keeps an issuer's bond and equity assumptions as separate rows", async () => {
    const sid = await newScenario(await newPortfolio());
    await upsertShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: `company:${companyId}`, shockType: "YIELD_BPS" }, value: 500 });
    await upsertShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: `company:${companyId}`, shockType: "PRICE_PCT" }, value: -5 });
    await upsertShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: `company:${companyId}`, shockType: "YIELD_BPS" }, value: 300 });
    const rows = await shocksOf(sid);
    expect(rows.map((r) => [r.shockType, Number(r.value)]).sort()).toEqual([["PRICE_PCT", -5], ["YIELD_BPS", 300]]);
  });
  it("rejects out-of-bounds values, unknown targets and archived scenarios", async () => {
    const pid = await newPortfolio();
    const sid = await newScenario(pid);
    expect(await upsertShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "EQUITY" }, value: -101 })).toMatchObject({ ok: false });
    expect(await upsertShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "BOND", instrumentId: "nope" }, value: 10 })).toMatchObject({ ok: false });
    expect(await upsertShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: "name:nobody", shockType: "PRICE_PCT" }, value: 10 })).toMatchObject({ ok: false });
    expect(await shocksOf(sid)).toHaveLength(0);
    await db.scenario.update({ where: { id: sid }, data: { archivedAt: new Date() } });
    expect(await upsertShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "EQUITY" }, value: -10 })).toMatchObject({ ok: false });
  });
  it("human (2.0 percentage points) and advanced (200 bps) input store the identical rule", async () => {
    const pid = await newPortfolio();
    const human = await newScenario(pid, `${TAG} human`);
    const expert = await newScenario(pid, `${TAG} expert`);
    const h = toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 2, unit: "PP" });
    const e = toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 200, unit: "BPS" });
    if (!h.ok || !e.ok) throw new Error("conversion failed");
    await upsertShock({ scenarioId: human, target: { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, value: h.value });
    await upsertShock({ scenarioId: expert, target: { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, value: e.value });
    const [a] = await shocksOf(human);
    const [b] = await shocksOf(expert);
    expect([a.targetKind, a.assetClass, a.shockType, Number(a.value)]).toEqual([b.targetKind, b.assetClass, b.shockType, Number(b.value)]);
    expect(Number(a.value)).toBe(200);
  });
});

describe("setAssetClassAssumptions", () => {
  it("sets, updates and clears the three class assumptions together", async () => {
    const sid = await newScenario(await newPortfolio());
    expect(await setAssetClassAssumptions({ scenarioId: sid, entries: [{ assetClass: "GOVERNMENT_BOND", value: 200 }, { assetClass: "CORPORATE_BOND", value: 300 }, { assetClass: "EQUITY", value: -10 }] })).toEqual({ ok: true });
    expect((await shocksOf(sid)).map((r) => Number(r.value)).sort((x, y) => x - y)).toEqual([-10, 200, 300]);
    expect(await setAssetClassAssumptions({ scenarioId: sid, entries: [{ assetClass: "GOVERNMENT_BOND", value: 100 }, { assetClass: "CORPORATE_BOND", value: null }, { assetClass: "EQUITY", value: 0 }] })).toEqual({ ok: true });
    const rows = await shocksOf(sid);
    expect(rows).toHaveLength(2);
    expect(Object.fromEntries(rows.map((r) => [r.assetClass, Number(r.value)]))).toEqual({ GOVERNMENT_BOND: 100, EQUITY: 0 }); // explicit 0 kept; blank removed
  });
  it("is all-or-nothing: one invalid entry writes nothing", async () => {
    const sid = await newScenario(await newPortfolio());
    const r = await setAssetClassAssumptions({ scenarioId: sid, entries: [{ assetClass: "GOVERNMENT_BOND", value: 200 }, { assetClass: "EQUITY", value: -150 }] });
    expect(r).toMatchObject({ ok: false });
    expect(await shocksOf(sid)).toHaveLength(0);
  });
  it("leaves specific (issuer/security) assumptions untouched", async () => {
    const sid = await newScenario(await newPortfolio());
    await upsertShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "BOND", instrumentId: bondId }, value: 400 });
    await setAssetClassAssumptions({ scenarioId: sid, entries: [{ assetClass: "GOVERNMENT_BOND", value: null }, { assetClass: "CORPORATE_BOND", value: null }, { assetClass: "EQUITY", value: null }] });
    expect((await shocksOf(sid)).map((r) => r.targetKind)).toEqual(["SECURITY"]);
  });
});

describe("createScenarioFromTemplate", () => {
  it.each(SCENARIO_TEMPLATES.map((t) => [t.id, t] as const))("%s becomes an ordinary editable scenario with the template's assumptions", async (_id, t) => {
    const pid = await newPortfolio();
    const r = await createScenarioFromTemplate({ portfolioId: pid, templateId: t.id });
    if (!r.ok) throw new Error(r.error);
    const row = await db.scenario.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.name).toBe(t.name);
    expect(row.description).toContain("Hypothetical starting point");
    const stored = Object.fromEntries((await shocksOf(r.id)).map((s) => [s.assetClass, Number(s.value)]));
    expect(stored).toEqual(Object.fromEntries(t.assumptions.map((a) => [a.assetClass, a.value])));
    // Independent of the template: editing it does not touch constants.
    expect(await upsertShock({ scenarioId: r.id, target: { kind: "ASSET_CLASS", assetClass: "EQUITY" }, value: -3 })).toMatchObject({ ok: true });
  });
  it("rejects an unknown template and an archived portfolio, creating nothing", async () => {
    const pid = await newPortfolio();
    expect(await createScenarioFromTemplate({ portfolioId: pid, templateId: "nope" })).toMatchObject({ ok: false });
    await setPortfolioArchived(pid, true);
    expect(await createScenarioFromTemplate({ portfolioId: pid, templateId: "rate-pressure" })).toMatchObject({ ok: false });
    expect(await db.scenario.count({ where: { portfolioId: pid } })).toBe(0);
  });
});

describe("Studio read paths on a real portfolio", () => {
  async function seeded() {
    const pid = await newPortfolio();
    expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 100_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bondId, nominalGhs: 1_000_000 })).toMatchObject({ ok: true });
    return pid;
  }

  it("builds a view whose figures equal the engine result, with real links", async () => {
    const pid = await seeded();
    const sid = await newScenario(pid);
    await setAssetClassAssumptions({ scenarioId: sid, entries: [{ assetClass: "CORPORATE_BOND", value: 300 }, { assetClass: "EQUITY", value: -10 }, { assetClass: "GOVERNMENT_BOND", value: null }] });
    const ctx = await getInstrumentContext();
    const portfolio = (await getPortfolio(pid, ctx))!;
    const scenario = (await getScenario(sid, ctx))!;
    const { result, view } = await getScenarioStudio(portfolio, scenario);
    if (!result.ok || !view) throw new Error("expected a view");
    expect(view.headline.impactGhs).toBe(result.portfolio.impactGhs);
    expect(view.headline.startingValueGhs).toBe(portfolio.summary.referenceValueGhs);
    expect(view.confidence.coverageLine).toBe("2 of 2 positions included");
    const links = await getPositionLinks(portfolio);
    const bondRow = portfolio.positions.find((p) => p.instrument.kind === "BOND")!;
    expect(links[bondRow.positionId].analysis?.href).toBe(`/fixed-income/${TAG}B1`);
    expect(links[bondRow.positionId].inspect.href).toBe(`/portfolios/${pid}?position=${bondRow.positionId}#inspect`);
    // Every investigation link points at a route the app really has.
    for (const i of view.investigations) expect(i.link?.href).toMatch(/^\/(fixed-income|companies|portfolios)\//);
  });

  it("the library recalculates impacts now and never stores them", async () => {
    const pid = await seeded();
    const sid = await newScenario(pid, `${TAG} mild`);
    await setAssetClassAssumptions({ scenarioId: sid, entries: [{ assetClass: "EQUITY", value: -10 }, { assetClass: "GOVERNMENT_BOND", value: null }, { assetClass: "CORPORATE_BOND", value: null }] });
    const archivedId = await newScenario(pid, `${TAG} old`);
    await db.scenario.update({ where: { id: archivedId }, data: { archivedAt: new Date() } });
    const ctx = await getInstrumentContext();
    const portfolio = (await getPortfolio(pid, ctx))!;
    const lib = await getScenarioLibrary(portfolio, ctx);
    expect(lib.active.map((r) => r.name)).toEqual([`${TAG} mild`]);
    expect(lib.archived.map((r) => r.name)).toEqual([`${TAG} old`]);
    expect(lib.active[0].impactGhs).toBe(-100_000);
    expect(lib.active[0].primaryDriver).toBe("Equities");
    expect(lib.active[0].assumptionSummary).toBe("Equities −10%");
  });

  it("compares scenarios against ONE snapshot: identical starting basis, independent assumptions", async () => {
    const pid = await seeded();
    const mild = await newScenario(pid, `${TAG} mild`);
    const severe = await newScenario(pid, `${TAG} severe`);
    await setAssetClassAssumptions({ scenarioId: mild, entries: [{ assetClass: "CORPORATE_BOND", value: 100 }, { assetClass: "EQUITY", value: 0 }, { assetClass: "GOVERNMENT_BOND", value: null }] });
    await setAssetClassAssumptions({ scenarioId: severe, entries: [{ assetClass: "CORPORATE_BOND", value: 500 }, { assetClass: "EQUITY", value: -15 }, { assetClass: "GOVERNMENT_BOND", value: null }] });
    const ctx = await getInstrumentContext();
    const portfolio = (await getPortfolio(pid, ctx))!;
    const { comparison, invalid, missing } = await getScenarioComparison(portfolio, ctx, [mild, severe]);
    expect(invalid).toEqual([]);
    expect(missing).toEqual([]);
    if (!comparison) throw new Error("expected a comparison");
    expect(comparison.commonBasis).toBe(true);
    expect(comparison.valuationDate).toBe(portfolio.valuationDate);
    expect(comparison.columns[0].startingValueGhs).toBe(comparison.columns[1].startingValueGhs);
    expect(comparison.columns[0].startingValueGhs).toBe(portfolio.summary.referenceValueGhs);
    const [m, s] = comparison.columns;
    expect(s.impactGhs!).toBeLessThan(m.impactGhs!);
    expect(s.rank).toBe(1);
    // Same comparison twice, same data → identical result (no hidden state or time dependence between scenarios).
    expect((await getScenarioComparison(portfolio, ctx, [mild, severe])).comparison).toEqual(comparison);
  });

  it("ignores scenarios of another portfolio instead of leaking them into a comparison", async () => {
    const pid = await seeded();
    const other = await newPortfolio();
    const mine = await newScenario(pid);
    const theirs = await newScenario(other);
    const ctx = await getInstrumentContext();
    const portfolio = (await getPortfolio(pid, ctx))!;
    const out = await getScenarioComparison(portfolio, ctx, [mine, theirs]);
    expect(out.missing).toEqual([theirs]);
    expect(out.comparison).toBeNull();
  });
});
