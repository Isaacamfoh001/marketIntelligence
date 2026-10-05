// ---------------------------------------------------------------------------
// Integration tests for the M8.1 portfolio domain — real database. Creates its
// own ZZPF-prefixed instruments/portfolios and removes them afterwards; reuses
// (read-only) an existing DataSource + IngestionRun only to satisfy the bond
// table's provenance foreign keys. Market observations are never touched.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPosition, createPortfolio, removePosition, setPortfolioArchived, updatePosition } from "../portfolio-service";
import { getInstrumentContext, getPortfolio, getPortfolioExposures, getPortfolios, toExposurePositions } from "../queries/portfolio";

const db = getPrisma();
const TAG = "ZZPF";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Real market instruments only. Every other integration file creates and deletes
 * its own transient ZZ-prefixed bonds/securities in the SAME database while files
 * run in parallel, so a "first valued instrument" lookup over the shared universe
 * can return one of them and then lose it mid-test (FK violation / vanished
 * position). Exclude them; fixture instruments this file needs are its own.
 */
const isTransientFixture = (code: string) => code.startsWith("ZZ");

let sourceId: string;
let runId: string;
let companyId: string;
let bondId: string; // outstanding GHS fixed bond
let bond2Id: string;
let maturedBondId: string;
let floatingBondId: string;
let usdBondId: string;
let equityId: string;
let inactiveEquityId: string;
let usdEquityId: string;
const portfolioIds: string[] = [];

async function newPortfolio(name = `${TAG} ${Math.random().toString(36).slice(2, 8)}`) {
  const r = await createPortfolio({ name });
  if (!r.ok) throw new Error(r.error);
  portfolioIds.push(r.id);
  return r.id;
}

async function makeBond(code: string, over: Record<string, unknown> = {}) {
  const b = await db.fixedIncomeSecurity.create({
    data: {
      instrumentCode: `${TAG}${code}`,
      instrumentName: `${TAG} bond ${code}`,
      issuerName: `${TAG} Issuer`,
      instrumentType: "CORPORATE_BOND",
      classification: "CORPORATE",
      issueDate: d("2025-01-01"),
      maturityDate: d("2030-01-01"),
      couponType: "FIXED",
      couponRatePct: 20,
      couponFrequency: "SEMI_ANNUAL",
      sourceId,
      ingestionRunId: runId,
      ...over,
    },
  });
  return b.id;
}

async function makeSecurity(ticker: string, over: Record<string, unknown> = {}) {
  return (await db.security.create({ data: { companyId, ticker: `${TAG}${ticker}`, ...over } })).id;
}

beforeAll(async () => {
  // The bond table's provenance FKs are Restrict, so the run/source these bonds point at must outlive this file. Take a run of a REAL source:
  // other files create and delete ZZ-prefixed sources/runs concurrently, and an arbitrary `findFirst` can return one of them — which then
  // cannot be deleted by its owner while our bonds reference it (their teardown fails and leaves orphans behind).
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  sourceId = run.dataSourceId;
  runId = run.id;
  companyId = (await db.company.create({ data: { name: `${TAG} Company` } })).id;
  bondId = await makeBond("B1");
  bond2Id = await makeBond("B2");
  maturedBondId = await makeBond("MAT", { issueDate: d("2020-01-01"), maturityDate: d("2025-01-01") });
  floatingBondId = await makeBond("FLT", { couponType: "FLOATING", couponRatePct: null, couponFrequency: null });
  usdBondId = await makeBond("USD", { currency: "USD" });
  equityId = await makeSecurity("E1");
  inactiveEquityId = await makeSecurity("INA", { active: false });
  usdEquityId = await makeSecurity("USD", { currency: "USD" });
});

afterAll(async () => {
  await db.portfolio.deleteMany({ where: { id: { in: portfolioIds } } }); // cascades positions
  await db.portfolioPosition.deleteMany({ where: { portfolio: { name: { startsWith: TAG } } } });
  await db.portfolio.deleteMany({ where: { name: { startsWith: TAG } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { startsWith: TAG } } });
  await db.security.deleteMany({ where: { ticker: { startsWith: TAG } } });
  await db.company.deleteMany({ where: { name: `${TAG} Company` } });
});

describe("database CHECK constraints (PortfolioPosition_shape_check)", () => {
  const insert = async (data: Record<string, unknown>) => {
    const portfolioId = await newPortfolio();
    return db.portfolioPosition.create({ data: { portfolioId, ...data } as never });
  };

  it("accepts a well-formed bond and a well-formed equity", async () => {
    await expect(insert({ assetClass: "BOND", fixedIncomeSecurityId: bondId, nominalGhs: 1000 })).resolves.toBeTruthy();
    await expect(insert({ assetClass: "EQUITY", securityId: equityId, shares: 10 })).resolves.toBeTruthy();
  });

  it.each([
    ["bond with zero nominal", { assetClass: "BOND", fixedIncomeSecurityId: "BOND", nominalGhs: 0 }],
    ["bond with negative nominal", { assetClass: "BOND", fixedIncomeSecurityId: "BOND", nominalGhs: -5 }],
    ["bond without nominal", { assetClass: "BOND", fixedIncomeSecurityId: "BOND" }],
    ["bond carrying shares", { assetClass: "BOND", fixedIncomeSecurityId: "BOND", nominalGhs: 100, shares: 5 }],
    ["bond carrying a security id", { assetClass: "BOND", fixedIncomeSecurityId: "BOND", nominalGhs: 100, securityId: "EQUITY" }],
    ["bond with no instrument", { assetClass: "BOND", nominalGhs: 100 }],
    ["equity with zero shares", { assetClass: "EQUITY", securityId: "EQUITY", shares: 0 }],
    ["equity with negative shares", { assetClass: "EQUITY", securityId: "EQUITY", shares: -1 }],
    ["equity without shares", { assetClass: "EQUITY", securityId: "EQUITY" }],
    ["equity carrying a nominal", { assetClass: "EQUITY", securityId: "EQUITY", shares: 5, nominalGhs: 100 }],
    ["equity carrying a bond id", { assetClass: "EQUITY", securityId: "EQUITY", shares: 5, fixedIncomeSecurityId: "BOND" }],
    ["equity with no instrument", { assetClass: "EQUITY", shares: 5 }],
  ])("rejects %s", async (_name, data) => {
    const resolved: Record<string, unknown> = { ...data };
    if (resolved.fixedIncomeSecurityId === "BOND") resolved.fixedIncomeSecurityId = bondId;
    if (resolved.securityId === "EQUITY") resolved.securityId = equityId;
    await expect(insert(resolved)).rejects.toThrow(/check constraint/i);
  });
});

describe("uniqueness and foreign keys", () => {
  it("allows one position per bond/equity per portfolio, rejects a second", async () => {
    const pid = await newPortfolio();
    await db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "BOND", fixedIncomeSecurityId: bondId, nominalGhs: 1 } });
    await expect(db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "BOND", fixedIncomeSecurityId: bondId, nominalGhs: 2 } })).rejects.toThrow();
    await db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "EQUITY", securityId: equityId, shares: 1 } });
    await expect(db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "EQUITY", securityId: equityId, shares: 2 } })).rejects.toThrow();
  });

  it("the same instrument may be held in different portfolios", async () => {
    const a = await newPortfolio();
    const b = await newPortfolio();
    await db.portfolioPosition.create({ data: { portfolioId: a, assetClass: "EQUITY", securityId: equityId, shares: 1 } });
    await expect(db.portfolioPosition.create({ data: { portfolioId: b, assetClass: "EQUITY", securityId: equityId, shares: 1 } })).resolves.toBeTruthy();
  });

  it("rejects a position for an instrument or portfolio that does not exist", async () => {
    const pid = await newPortfolio();
    await expect(db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "BOND", fixedIncomeSecurityId: "nope", nominalGhs: 1 } })).rejects.toThrow();
    await expect(db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "EQUITY", securityId: "nope", shares: 1 } })).rejects.toThrow();
    await expect(db.portfolioPosition.create({ data: { portfolioId: "nope", assetClass: "EQUITY", securityId: equityId, shares: 1 } })).rejects.toThrow();
  });

  it("an instrument cannot be deleted while a portfolio holds it (Restrict), and can be once the position is gone", async () => {
    const ticker = await makeSecurity("RST");
    const bid = await makeBond("RST");
    const pid = await newPortfolio();
    const eq = await db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "EQUITY", securityId: ticker, shares: 5 } });
    const bd = await db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "BOND", fixedIncomeSecurityId: bid, nominalGhs: 5 } });
    await expect(db.security.delete({ where: { id: ticker } })).rejects.toThrow();
    await expect(db.fixedIncomeSecurity.delete({ where: { id: bid } })).rejects.toThrow();
    await db.portfolioPosition.deleteMany({ where: { id: { in: [eq.id, bd.id] } } });
    await db.security.delete({ where: { id: ticker } });
    await db.fixedIncomeSecurity.delete({ where: { id: bid } });
  });

  it("deleting a portfolio cascades to its positions", async () => {
    const pid = await newPortfolio();
    await db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "EQUITY", securityId: equityId, shares: 3 } });
    await db.portfolio.delete({ where: { id: pid } });
    expect(await db.portfolioPosition.count({ where: { portfolioId: pid } })).toBe(0);
  });
});

describe("portfolio service", () => {
  it("requires a name and trims it; description is optional", async () => {
    expect(await createPortfolio({ name: "   " })).toMatchObject({ ok: false });
    expect(await createPortfolio({ name: "x".repeat(121) })).toMatchObject({ ok: false });
    const r = await createPortfolio({ name: `  ${TAG} trimmed  `, description: "  " });
    if (!r.ok) throw new Error(r.error);
    portfolioIds.push(r.id);
    const row = await db.portfolio.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ name: `${TAG} trimmed`, description: null, archivedAt: null });
  });

  it("adds a bond (nominal) and an equity (shares), and rejects wrong-shape or invalid sizes", async () => {
    const pid = await newPortfolio();
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bondId, nominalGhs: 2_000_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 100_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bond2Id, nominalGhs: 0 })).toMatchObject({ ok: false });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bond2Id, nominalGhs: -10 })).toMatchObject({ ok: false });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bond2Id, shares: 10 })).toMatchObject({ ok: false });
    expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: usdEquityId, shares: 10 })).toMatchObject({ ok: false });
    const stored = await db.portfolioPosition.findMany({ where: { portfolioId: pid } });
    expect(stored).toHaveLength(2);
  });

  it("rejects fractional shares", async () => {
    const pid = await newPortfolio();
    expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 10.5 })).toMatchObject({ ok: false });
  });

  it("blocks matured, floating-rate and non-GHS bonds and inactive/non-GHS equities", async () => {
    const pid = await newPortfolio();
    for (const [assetClass, instrumentId, size] of [
      ["BOND", maturedBondId, { nominalGhs: 1000 }],
      ["BOND", floatingBondId, { nominalGhs: 1000 }],
      ["BOND", usdBondId, { nominalGhs: 1000 }],
      ["EQUITY", inactiveEquityId, { shares: 10 }],
      ["EQUITY", usdEquityId, { shares: 10 }],
    ] as const) {
      expect(await addPosition({ portfolioId: pid, assetClass, instrumentId, ...size })).toMatchObject({ ok: false });
    }
    expect(await db.portfolioPosition.count({ where: { portfolioId: pid } })).toBe(0);
  });

  it("adding an instrument already held refuses to duplicate and points at the existing position", async () => {
    const pid = await newPortfolio();
    const first = await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 10 });
    if (!first.ok) throw new Error(first.error);
    const again = await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 99 });
    expect(again).toMatchObject({ ok: false, existingPositionId: first.positionId });
    expect(await db.portfolioPosition.count({ where: { portfolioId: pid } })).toBe(1);
    expect((await db.portfolioPosition.findUniqueOrThrow({ where: { id: first.positionId } })).shares).toBe(10);
  });

  it("updates a position's size with the same validation, and removes it", async () => {
    const pid = await newPortfolio();
    const added = await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bondId, nominalGhs: 1000 });
    if (!added.ok) throw new Error(added.error);
    expect(await updatePosition({ positionId: added.positionId, nominalGhs: 5000.5 })).toMatchObject({ ok: true });
    expect(Number((await db.portfolioPosition.findUniqueOrThrow({ where: { id: added.positionId } })).nominalGhs)).toBe(5000.5);
    expect(await updatePosition({ positionId: added.positionId, nominalGhs: 0 })).toMatchObject({ ok: false });
    expect(await updatePosition({ positionId: added.positionId, shares: 5 })).toMatchObject({ ok: false });
    expect(Number((await db.portfolioPosition.findUniqueOrThrow({ where: { id: added.positionId } })).nominalGhs)).toBe(5000.5);
    expect(await removePosition(added.positionId)).toMatchObject({ ok: true });
    expect(await removePosition(added.positionId)).toMatchObject({ ok: false });
  });

  it("changing a position moves the portfolio's updatedAt", async () => {
    const pid = await newPortfolio();
    const before = (await db.portfolio.findUniqueOrThrow({ where: { id: pid } })).updatedAt;
    await new Promise((r) => setTimeout(r, 15));
    await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 1 });
    expect((await db.portfolio.findUniqueOrThrow({ where: { id: pid } })).updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe("archive behaviour", () => {
  it("archived portfolios leave the active list but keep their positions; restore returns them", async () => {
    const pid = await newPortfolio(`${TAG} archive me`);
    await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 7 });
    expect((await getPortfolios({ archived: false })).some((p) => p.id === pid)).toBe(true);

    expect(await setPortfolioArchived(pid, true)).toMatchObject({ ok: true });
    expect((await getPortfolios({ archived: false })).some((p) => p.id === pid)).toBe(false);
    const archived = (await getPortfolios({ archived: true })).find((p) => p.id === pid);
    expect(archived?.positions).toHaveLength(1);
    expect(archived?.archivedAt).not.toBeNull();

    // An archived portfolio is read-only.
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: bondId, nominalGhs: 1000 })).toMatchObject({ ok: false });
    const pos = archived!.positions[0].positionId;
    expect(await updatePosition({ positionId: pos, shares: 8 })).toMatchObject({ ok: false });
    expect(await removePosition(pos)).toMatchObject({ ok: false });

    expect(await setPortfolioArchived(pid, false)).toMatchObject({ ok: true });
    expect((await getPortfolios({ archived: false })).some((p) => p.id === pid)).toBe(true);
    expect(await setPortfolioArchived("nope", true)).toMatchObject({ ok: false });
  });
});

describe("valuation through the query layer", () => {
  it("values stored positions from market data and summarises coverage over the valued portion", async () => {
    const ctx = await getInstrumentContext();
    const valuedBond = ctx.bonds.find((b) => b.input.available && b.addable.addable && !isTransientFixture(b.instrumentCode));
    const valuedEquity = ctx.equities.find((e) => e.input.available && e.addable.addable && !isTransientFixture(e.ticker));
    // This file's own bond has no market observation, so it is unvalued by construction (not by whatever the shared data happens to hold).
    const unvaluedBond = ctx.bondById.get(bondId);
    expect(valuedBond && valuedEquity && unvaluedBond).toBeTruthy();
    expect(unvaluedBond!.input.available).toBe(false);

    const pid = await newPortfolio();
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: valuedBond!.id, nominalGhs: 2_000_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: valuedEquity!.id, shares: 100_000 })).toMatchObject({ ok: true });
    expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: unvaluedBond!.id, nominalGhs: 500_000 })).toMatchObject({ ok: true });

    const detail = await getPortfolio(pid);
    expect(detail).not.toBeNull();
    const s = detail!.summary;
    expect(s).toMatchObject({ positionCount: 3, valuedCount: 2, unvaluedCount: 1, isComplete: false });
    const sum = detail!.positions.flatMap((p) => (p.valuation.status === "VALUED" ? [p.valuation.referenceValueGhs] : [])).reduce((a, b) => a + b, 0);
    expect(s.referenceValueGhs).toBeCloseTo(sum, 2);
    expect((s.recentPct ?? 0) + (s.stalePct ?? 0)).toBeCloseTo(100, 6);
    expect(detail!.positions.find((p) => p.valuation.status === "UNVALUED")?.valuation).toMatchObject({ status: "UNVALUED", reason: expect.any(String) });
    expect(detail!.valuationDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("an empty portfolio has no reference value", async () => {
    const detail = await getPortfolio(await newPortfolio());
    expect(detail!.summary).toMatchObject({ referenceValueGhs: null, positionCount: 0, isComplete: false });
  });
});

describe("exposure analytics through the query layer (M8.2)", () => {
  it("resolves one issuer for a company's bond and equity, and keeps an unvalued bond in contractual analytics", async () => {
    const linkedBond = await makeBond("LNK", { companyId, maturityDate: d("2031-06-30") });
    const pid = await newPortfolio();
    await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: linkedBond, nominalGhs: 1_000_000 });
    await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: equityId, shares: 1000 });

    const detail = (await getPortfolio(pid))!;
    const inputs = toExposurePositions(detail.positions);
    expect(new Set(inputs.map((p) => p.issuer.key)).size).toBe(1);
    expect(inputs[0].issuer.key).toBe(`company:${companyId}`);

    const e = getPortfolioExposures(detail);
    // Neither position has market data: value-based analytics are empty (never zero-filled)…
    expect(e.valuedCount).toBe(0);
    expect(e.allocation.rows).toEqual([]);
    expect(e.issuers.rows).toEqual([]);
    expect(e.issuers.unvaluedOnly).toEqual([{ issuer: expect.objectContaining({ key: `company:${companyId}` }), unvaluedCount: 2 }]);
    expect(e.rates.bondDv01Ghs).toBeNull();
    // …while the bond's trusted terms still feed the contractual analytics.
    expect(e.maturity.eligibleNominalGhs).toBe(1_000_000);
    expect(e.coupon.annualCouponGhs).toBe(200_000);
    expect(e.upcoming[0]).toMatchObject({ nominalGhs: 1_000_000, referenceValueGhs: null });
  });

  it("a valued real portfolio satisfies the allocation/issuer invariants against the M8.1 summary", async () => {
    const ctx = await getInstrumentContext();
    const bonds = ctx.bonds.filter((b) => b.input.available && b.addable.addable && !isTransientFixture(b.instrumentCode)).slice(0, 3);
    const eq = ctx.equities.find((x) => x.input.available && x.addable.addable && !isTransientFixture(x.ticker));
    expect(bonds.length).toBeGreaterThan(0);
    const pid = await newPortfolio();
    for (const b of bonds) expect(await addPosition({ portfolioId: pid, assetClass: "BOND", instrumentId: b.id, nominalGhs: 1_000_000 })).toMatchObject({ ok: true });
    if (eq) expect(await addPosition({ portfolioId: pid, assetClass: "EQUITY", instrumentId: eq.id, shares: 10_000 })).toMatchObject({ ok: true });

    const detail = (await getPortfolio(pid))!;
    const e = getPortfolioExposures(detail);
    const total = Math.round((detail.summary.referenceValueGhs as number) * 100);
    expect(e.allocation.rows.reduce((a, r) => a + Math.round(r.referenceValueGhs * 100), 0)).toBe(total);
    expect(e.issuers.rows.reduce((a, r) => a + Math.round(r.referenceValueGhs * 100), 0)).toBe(total);
    expect(e.rates.bondDv01Ghs).toBeGreaterThan(0);
    expect(Math.round((e.rates.governmentDv01Ghs + e.rates.corporateDv01Ghs) * 100)).toBe(Math.round((e.rates.bondDv01Ghs as number) * 100));
  });
});
