// ---------------------------------------------------------------------------
// Integration tests for M8.3 scenario definitions — real database. Owns its
// ZZSC-prefixed company/bonds/securities/portfolios/scenarios and removes them
// afterwards. It reuses (read-only) one REAL source + ingestion run purely to
// satisfy provenance foreign keys; it never touches other files' market data
// and never relies on a "first row" of a shared mutable universe — every
// assertion is on rows this file created.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPosition, createPortfolio, setPortfolioArchived } from "../portfolio-service";
import { addShock, createScenario, removeShock, setScenarioArchived, updateScenario, updateShock } from "../scenario-service";
import { getInstrumentContext, getPortfolio } from "../queries/portfolio";
import { getScenario, getScenarios, runScenarioForPortfolio, buildTargetOptions, parseTargetOption } from "../queries/scenarios";
import { toValuationDate } from "../fixed-income";

const db = getPrisma();
const TAG = "ZZSC";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dayOffset = (n: number) => new Date(toValuationDate(new Date()).getTime() + n * 86_400_000);

let sourceId: string;
let runId: string;
let companyId: string;
let bondId: string;
let bond2Id: string;
let equityId: string;
const portfolioIds: string[] = [];

async function newPortfolio() {
  const r = await createPortfolio({ name: `${TAG} ${Math.random().toString(36).slice(2, 8)}` });
  if (!r.ok) throw new Error(r.error);
  portfolioIds.push(r.id);
  return r.id;
}
async function newScenario(portfolioId: string, name = `${TAG} scenario`) {
  const r = await createScenario({ portfolioId, name });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function makeBond(code: string, over: Record<string, unknown> = {}) {
  return (
    await db.fixedIncomeSecurity.create({
      data: { instrumentCode: `${TAG}${code}`, instrumentName: `${TAG} bond ${code}`, issuerName: `${TAG} Issuer`, instrumentType: "CORPORATE_BOND", classification: "CORPORATE", issueDate: d("2025-01-01"), maturityDate: d("2031-01-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", sourceId, ingestionRunId: runId, ...over },
    })
  ).id;
}

beforeAll(async () => {
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  sourceId = run.dataSourceId;
  runId = run.id;
  companyId = (await db.company.create({ data: { name: `${TAG} Company` } })).id;
  bondId = await makeBond("B1");
  bond2Id = await makeBond("B2");
  equityId = (await db.security.create({ data: { companyId, ticker: `${TAG}E1` } })).id;
});

afterAll(async () => {
  await db.portfolio.deleteMany({ where: { name: { startsWith: TAG } } }); // cascades positions, scenarios and shocks
  await db.fixedIncomeObservation.deleteMany({ where: { security: { instrumentCode: { startsWith: TAG } } } });
  await db.securityPrice.deleteMany({ where: { security: { ticker: { startsWith: TAG } } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { startsWith: TAG } } });
  await db.security.deleteMany({ where: { ticker: { startsWith: TAG } } });
  await db.company.deleteMany({ where: { name: `${TAG} Company` } });
});

describe("database constraints (ScenarioShock_target_check / _value_check)", () => {
  const insert = async (data: Record<string, unknown>) => {
    const portfolioId = await newPortfolio();
    const scenarioId = await newScenario(portfolioId);
    return db.scenarioShock.create({ data: { scenarioId, ...data } as never });
  };

  it("accepts well-formed shocks of every target kind", async () => {
    await expect(insert({ targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "YIELD_BPS", value: 200 })).resolves.toBeTruthy();
    await expect(insert({ targetKind: "ASSET_CLASS", assetClass: "EQUITY", shockType: "PRICE_PCT", value: -10 })).resolves.toBeTruthy();
    await expect(insert({ targetKind: "ISSUER", companyId, shockType: "PRICE_PCT", value: -20 })).resolves.toBeTruthy();
    await expect(insert({ targetKind: "ISSUER", issuerNameKey: "government of ghana", shockType: "YIELD_BPS", value: 250 })).resolves.toBeTruthy();
    await expect(insert({ targetKind: "SECURITY", fixedIncomeSecurityId: bondId, shockType: "YIELD_BPS", value: 0 })).resolves.toBeTruthy();
    await expect(insert({ targetKind: "SECURITY", securityId: equityId, shockType: "PRICE_PCT", value: -100 })).resolves.toBeTruthy();
  });

  it.each([
    ["yield shock on equities", { targetKind: "ASSET_CLASS", assetClass: "EQUITY", shockType: "YIELD_BPS", value: 100 }],
    ["price shock on government bonds", { targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "PRICE_PCT", value: -5 }],
    ["price shock on corporate bonds", { targetKind: "ASSET_CLASS", assetClass: "CORPORATE_BOND", shockType: "PRICE_PCT", value: -5 }],
    ["asset-class target without an asset class", { targetKind: "ASSET_CLASS", shockType: "YIELD_BPS", value: 1 }],
    ["asset-class target also carrying a security", { targetKind: "ASSET_CLASS", assetClass: "EQUITY", securityId: "EQ", shockType: "PRICE_PCT", value: 1 }],
    ["issuer with neither company nor name", { targetKind: "ISSUER", shockType: "YIELD_BPS", value: 1 }],
    ["issuer with both company and name", { targetKind: "ISSUER", companyId: "CO", issuerNameKey: "x", shockType: "YIELD_BPS", value: 1 }],
    ["issuer with a blank name key", { targetKind: "ISSUER", issuerNameKey: "   ", shockType: "YIELD_BPS", value: 1 }],
    ["bond security with a price shock", { targetKind: "SECURITY", fixedIncomeSecurityId: "BOND", shockType: "PRICE_PCT", value: 1 }],
    ["equity security with a yield shock", { targetKind: "SECURITY", securityId: "EQ", shockType: "YIELD_BPS", value: 1 }],
    ["security with both a bond and an equity", { targetKind: "SECURITY", fixedIncomeSecurityId: "BOND", securityId: "EQ", shockType: "YIELD_BPS", value: 1 }],
    ["security with no instrument", { targetKind: "SECURITY", shockType: "YIELD_BPS", value: 1 }],
    ["equity price below −100%", { targetKind: "ASSET_CLASS", assetClass: "EQUITY", shockType: "PRICE_PCT", value: -100.01 }],
    ["equity price above +1000%", { targetKind: "ASSET_CLASS", assetClass: "EQUITY", shockType: "PRICE_PCT", value: 1000.01 }],
    ["yield shock above +2000 bps", { targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "YIELD_BPS", value: 2000.01 }],
    ["yield shock below −2000 bps", { targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "YIELD_BPS", value: -2000.01 }],
  ])("rejects %s", async (_n, data) => {
    const resolved: Record<string, unknown> = { ...data };
    if (resolved.fixedIncomeSecurityId === "BOND") resolved.fixedIncomeSecurityId = bondId;
    if (resolved.securityId === "EQ") resolved.securityId = equityId;
    if (resolved.companyId === "CO") resolved.companyId = companyId;
    await expect(insert(resolved)).rejects.toThrow(/check constraint/i);
  });

  it("rejects a security or company target that never existed (foreign keys)", async () => {
    await expect(insert({ targetKind: "SECURITY", fixedIncomeSecurityId: "nope", shockType: "YIELD_BPS", value: 1 })).rejects.toThrow();
    await expect(insert({ targetKind: "SECURITY", securityId: "nope", shockType: "PRICE_PCT", value: 1 })).rejects.toThrow();
    await expect(insert({ targetKind: "ISSUER", companyId: "nope", shockType: "YIELD_BPS", value: 1 })).rejects.toThrow();
  });

  it("forbids two shocks at the same target (unique indexes) but allows the same target in different scenarios", async () => {
    const pid = await newPortfolio();
    const s1 = await newScenario(pid);
    const s2 = await newScenario(pid);
    const mk = (scenarioId: string, over: Record<string, unknown>) => db.scenarioShock.create({ data: { scenarioId, ...over } as never });
    await mk(s1, { targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "YIELD_BPS", value: 1 });
    await expect(mk(s1, { targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "YIELD_BPS", value: 2 })).rejects.toThrow();
    await expect(mk(s2, { targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND", shockType: "YIELD_BPS", value: 2 })).resolves.toBeTruthy();
    await mk(s1, { targetKind: "SECURITY", fixedIncomeSecurityId: bondId, shockType: "YIELD_BPS", value: 1 });
    await expect(mk(s1, { targetKind: "SECURITY", fixedIncomeSecurityId: bondId, shockType: "YIELD_BPS", value: 2 })).rejects.toThrow();
    await mk(s1, { targetKind: "ISSUER", companyId, shockType: "YIELD_BPS", value: 1 });
    await expect(mk(s1, { targetKind: "ISSUER", companyId, shockType: "YIELD_BPS", value: 2 })).rejects.toThrow();
    // Same issuer, different asset domain, is a different assumption.
    await expect(mk(s1, { targetKind: "ISSUER", companyId, shockType: "PRICE_PCT", value: -5 })).resolves.toBeTruthy();
    await mk(s1, { targetKind: "ISSUER", issuerNameKey: "k", shockType: "YIELD_BPS", value: 1 });
    await expect(mk(s1, { targetKind: "ISSUER", issuerNameKey: "k", shockType: "YIELD_BPS", value: 2 })).rejects.toThrow();
  });

  it("restricts deleting an instrument/company that a saved shock references; cascades on scenario and portfolio delete", async () => {
    const tmpBond = await makeBond("RST");
    const tmpCo = await db.company.create({ data: { name: `${TAG} Company RST` } });
    const pid = await newPortfolio();
    const sid = await newScenario(pid);
    const a = await db.scenarioShock.create({ data: { scenarioId: sid, targetKind: "SECURITY", fixedIncomeSecurityId: tmpBond, shockType: "YIELD_BPS", value: 5 } });
    const b = await db.scenarioShock.create({ data: { scenarioId: sid, targetKind: "ISSUER", companyId: tmpCo.id, shockType: "YIELD_BPS", value: 5 } });
    await expect(db.fixedIncomeSecurity.delete({ where: { id: tmpBond } })).rejects.toThrow();
    await expect(db.company.delete({ where: { id: tmpCo.id } })).rejects.toThrow();
    await db.scenario.delete({ where: { id: sid } });
    expect(await db.scenarioShock.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);
    await db.fixedIncomeSecurity.delete({ where: { id: tmpBond } });
    await db.company.delete({ where: { id: tmpCo.id } });

    const sid2 = await newScenario(pid);
    await db.scenarioShock.create({ data: { scenarioId: sid2, targetKind: "ASSET_CLASS", assetClass: "EQUITY", shockType: "PRICE_PCT", value: -1 } });
    await db.portfolio.delete({ where: { id: pid } });
    expect(await db.scenario.count({ where: { portfolioId: pid } })).toBe(0);
    expect(await db.scenarioShock.count({ where: { scenarioId: sid2 } })).toBe(0);
  });
});

describe("scenario service", () => {
  it("creates, trims, renames, and sets/clears a description", async () => {
    const pid = await newPortfolio();
    expect(await createScenario({ portfolioId: pid, name: "  " })).toMatchObject({ ok: false });
    expect(await createScenario({ portfolioId: pid, name: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(await createScenario({ portfolioId: "nope", name: "n" })).toMatchObject({ ok: false, error: "Portfolio not found." });
    const r = await createScenario({ portfolioId: pid, name: `  ${TAG} one  `, description: "  " });
    if (!r.ok) throw new Error(r.error);
    expect(await db.scenario.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ name: `${TAG} one`, description: null, portfolioId: pid, archivedAt: null });
    expect(await updateScenario({ scenarioId: r.id, name: `${TAG} renamed`, description: "why" })).toMatchObject({ ok: true });
    expect(await db.scenario.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ name: `${TAG} renamed`, description: "why" });
    expect(await updateScenario({ scenarioId: r.id, name: "" })).toMatchObject({ ok: false });
    expect(await updateScenario({ scenarioId: "nope", name: "n" })).toMatchObject({ ok: false });
  });

  it("adds, edits and removes shocks; type is implied by the target and values are validated", async () => {
    const pid = await newPortfolio();
    const sid = await newScenario(pid);
    const gov = await addShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, value: 200 });
    if (!gov.ok) throw new Error(gov.error);
    expect(await db.scenarioShock.findUniqueOrThrow({ where: { id: gov.shockId } })).toMatchObject({ shockType: "YIELD_BPS", targetKind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" });
    const eq = await addShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "EQUITY" }, value: -10 });
    expect(eq).toMatchObject({ ok: true });
    expect(await updateShock({ shockId: gov.shockId, value: 350.5 })).toMatchObject({ ok: true });
    expect(Number((await db.scenarioShock.findUniqueOrThrow({ where: { id: gov.shockId } })).value)).toBe(350.5);
    expect(await updateShock({ shockId: gov.shockId, value: 5000 })).toMatchObject({ ok: false });
    expect(Number((await db.scenarioShock.findUniqueOrThrow({ where: { id: gov.shockId } })).value)).toBe(350.5);
    expect(await removeShock(gov.shockId)).toMatchObject({ ok: true });
    expect(await db.scenarioShock.count({ where: { scenarioId: sid } })).toBe(1);
    expect(await removeShock(gov.shockId)).toMatchObject({ ok: false });
  });

  it("rejects out-of-bound, non-finite and equity-below-−100% values; −100% itself is allowed", async () => {
    const sid = await newScenario(await newPortfolio());
    const eq = (value: number) => addShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "EQUITY", instrumentId: equityId }, value });
    expect(await eq(-100.5)).toMatchObject({ ok: false });
    expect(await eq(Number.NaN)).toMatchObject({ ok: false });
    expect(await eq(1000.5)).toMatchObject({ ok: false });
    expect(await eq(-100)).toMatchObject({ ok: true });
    expect(await addShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, value: 2001 })).toMatchObject({ ok: false });
  });

  it("rejects a duplicate at the same target with a clear message, and never changes the existing one", async () => {
    const sid = await newScenario(await newPortfolio());
    const first = await addShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "BOND", instrumentId: bondId }, value: 100 });
    expect(first).toMatchObject({ ok: true });
    const dup = await addShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "BOND", instrumentId: bondId }, value: 999 });
    expect(dup).toMatchObject({ ok: false });
    expect((dup as { error: string }).error).toMatch(/already has an assumption/);
    const rows = await db.scenarioShock.findMany({ where: { scenarioId: sid } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].value)).toBe(100);
    // Same issuer, two domains: allowed. Same issuer same domain: rejected.
    const issuer = (shockType: "YIELD_BPS" | "PRICE_PCT") => addShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: `company:${companyId}`, shockType }, value: 1 });
    expect(await issuer("YIELD_BPS")).toMatchObject({ ok: true });
    expect(await issuer("PRICE_PCT")).toMatchObject({ ok: true });
    expect(await issuer("YIELD_BPS")).toMatchObject({ ok: false });
  });

  it("rejects targets that do not exist (security, company, issuer name) and unrealisable issuer domains", async () => {
    const sid = await newScenario(await newPortfolio());
    expect(await addShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "BOND", instrumentId: "nope" }, value: 1 })).toMatchObject({ ok: false, error: "That bond does not exist." });
    expect(await addShock({ scenarioId: sid, target: { kind: "SECURITY", instrument: "EQUITY", instrumentId: "nope" }, value: 1 })).toMatchObject({ ok: false, error: "That security does not exist." });
    expect(await addShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: "company:nope", shockType: "YIELD_BPS" }, value: 1 })).toMatchObject({ ok: false });
    expect(await addShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: "name:no such issuer anywhere", shockType: "YIELD_BPS" }, value: 1 })).toMatchObject({ ok: false });
    expect(await addShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: "garbage", shockType: "YIELD_BPS" }, value: 1 })).toMatchObject({ ok: false });
    // An issuer with no listed company has no equity to shock.
    await db.fixedIncomeSecurity.create({ data: { instrumentCode: `${TAG}NOCO`, instrumentName: "n", issuerName: `${TAG}  No Company Issuer`, instrumentType: "CORPORATE_BOND", classification: "CORPORATE", issueDate: d("2025-01-01"), maturityDate: d("2031-01-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", sourceId, ingestionRunId: runId } });
    const key = `name:${TAG.toLowerCase()} no company issuer`;
    expect(await addShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: key, shockType: "PRICE_PCT" }, value: -1 })).toMatchObject({ ok: false });
    expect(await addShock({ scenarioId: sid, target: { kind: "ISSUER", issuerKey: key, shockType: "YIELD_BPS" }, value: 1 })).toMatchObject({ ok: true });
  });

  it("an incompatible type/target pair is unrepresentable through the service (type is derived from the target)", async () => {
    // The service has no way to request PRICE_PCT on a bond class; an issuer target with the wrong domain for its instruments simply reaches nothing.
    const sid = await newScenario(await newPortfolio());
    const r = await addShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, value: 1 });
    if (!r.ok) throw new Error(r.error);
    expect((await db.scenarioShock.findUniqueOrThrow({ where: { id: r.shockId } })).shockType).toBe("YIELD_BPS");
  });

  it("archived scenarios and archived portfolios are read-only; archiving is reversible", async () => {
    const pid = await newPortfolio();
    const sid = await newScenario(pid);
    const s = await addShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "EQUITY" }, value: -5 });
    if (!s.ok) throw new Error(s.error);
    expect(await setScenarioArchived(sid, true)).toMatchObject({ ok: true });
    expect(await addShock({ scenarioId: sid, target: { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, value: 1 })).toMatchObject({ ok: false });
    expect(await updateShock({ shockId: s.shockId, value: 1 })).toMatchObject({ ok: false });
    expect(await removeShock(s.shockId)).toMatchObject({ ok: false });
    expect(await updateScenario({ scenarioId: sid, name: "n" })).toMatchObject({ ok: false });
    expect((await getScenarios(pid, { archived: true })).map((x) => x.id)).toContain(sid);
    expect((await getScenarios(pid, { archived: false })).map((x) => x.id)).not.toContain(sid);
    expect(await setScenarioArchived(sid, false)).toMatchObject({ ok: true });
    expect(await updateShock({ shockId: s.shockId, value: 1 })).toMatchObject({ ok: true });
    expect(await setPortfolioArchived(pid, true)).toMatchObject({ ok: true });
    expect(await updateShock({ shockId: s.shockId, value: 2 })).toMatchObject({ ok: false });
    expect(await createScenario({ portfolioId: pid, name: "n" })).toMatchObject({ ok: false });
    expect(await setScenarioArchived("nope", true)).toMatchObject({ ok: false });
  });

  it("scenarios belong to their portfolio: lists are scoped and shocks are returned with their owner", async () => {
    const a = await newPortfolio();
    const b = await newPortfolio();
    const sa = await newScenario(a, `${TAG} A`);
    await newScenario(b, `${TAG} B`);
    expect((await getScenarios(a, { archived: false })).map((x) => x.id)).toEqual([sa]);
    const ctx = await getInstrumentContext();
    expect((await getScenario(sa, ctx))?.portfolioId).toBe(a);
  });
});

describe("end-to-end: stored assumptions + current reference valuation → engine", () => {
  it("runs saved assumptions on a portfolio whose positions have test-owned market inputs", async () => {
    // Test-owned inputs dated relative to today so they are RECENT regardless of the calendar.
    await db.securityPrice.create({ data: { securityId: equityId, tradingDate: dayOffset(-1), closeVwap: "10", volume: 5000, sourceId, ingestionRunId: runId } });
    await db.fixedIncomeObservation.create({ data: { securityId: bondId, observationDate: dayOffset(-2), sourceYieldPct: "25", observationKind: "SECONDARY_MARKET", tradeStatus: "TRADED", volumeTradedGhs: "1000000", numberOfTrades: 3, sourceId, ingestionRunId: runId } });

    const pid = await newPortfolio();
    expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 100_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bondId, nominalGhs: 1_000_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bond2Id, nominalGhs: 500_000 })).toMatchObject({ ok: true }); // no observation → unvalued

    const sid = await newScenario(pid);
    for (const [target, value] of [
      [{ kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, 300],
      [{ kind: "ASSET_CLASS", assetClass: "EQUITY" }, -10],
      [{ kind: "SECURITY", instrument: "BOND", instrumentId: bondId }, 400],
    ] as const) expect(await addShock({ scenarioId: sid, target: target as never, value })).toMatchObject({ ok: true });

    const ctx = await getInstrumentContext();
    const portfolio = await getPortfolio(pid, ctx);
    const scenario = await getScenario(sid, ctx);
    if (!portfolio || !scenario) throw new Error("missing");
    const result = runScenarioForPortfolio(portfolio, scenario);
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join());

    expect(result.valuationDate).toBe(portfolio.valuationDate);
    expect(result.portfolio).toMatchObject({ positionCount: 3, valuedCount: 2, participatingCount: 2, unvaluedCount: 1 });
    expect(result.portfolio.referenceBasisGhs).toBe(portfolio.summary.referenceValueGhs);
    expect(result.portfolio.reconciles).toBe(true);

    const eq = result.positions.find((p) => p.label === `${TAG}E1`);
    expect(eq).toMatchObject({ status: "PARTICIPATING", outcome: "SHOCKED", referenceValueGhs: 1_000_000, scenarioValueGhs: 900_000, impactGhs: -100_000 });
    const bond = result.positions.find((p) => p.status === "PARTICIPATING" && p.assetClass === "CORPORATE_BOND");
    expect(bond?.status === "PARTICIPATING" && bond.resolution.precedence).toBe("SECURITY"); // security +400 beat asset class +300
    expect(bond?.status === "PARTICIPATING" && bond.detail.assetClass === "BOND" && bond.detail.appliedShockBps).toBe(400);
    expect(bond?.status === "PARTICIPATING" && bond.impactGhs).toBeLessThan(0);
    const unvalued = result.positions.find((p) => p.status === "UNAVAILABLE");
    expect(unvalued).toMatchObject({ code: "UNVALUED_REFERENCE", upstreamCode: "NO_OBSERVATION" });

    // The issuer label resolves from the live universe; the form options carry a type implied by each target.
    const opts = buildTargetOptions(portfolio);
    expect(opts.filter((o) => o.group === "Asset class")).toHaveLength(3);
    for (const o of opts) {
      const t = parseTargetOption(o.value);
      expect(t).not.toBeNull();
      if (t?.kind === "ASSET_CLASS") expect(o.shockType).toBe(t.assetClass === "EQUITY" ? "PRICE_PCT" : "YIELD_BPS");
    }
    expect(parseTargetOption("garbage")).toBeNull();
    expect(parseTargetOption("ASSET_CLASS|NOPE|YIELD_BPS")).toBeNull();

    // Results are not stored: nothing but definitions exists in the scenario tables.
    expect(Object.keys(await db.scenario.findUniqueOrThrow({ where: { id: sid } })).sort()).toEqual(["archivedAt", "createdAt", "description", "id", "name", "portfolioId", "updatedAt"]);
  });
});
