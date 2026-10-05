// ---------------------------------------------------------------------------
// Integration tests for Treasury bills in the portfolio / scenario domain (M8.5)
// — real database. Reads the REAL Bank of Ghana auction rows already stored
// (never modifies them) and recomputes every expected value with plain
// arithmetic from those raw rows, independent of the application code.
//
// ISOLATION: creates only its own portfolios and TreasuryBill rows (distinctive
// maturity dates + ZZ-prefixed ISINs) and removes exactly those in afterAll.
// No broad cleanup — parallel test files share this database.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addTreasuryBillPosition, createPortfolio, removePosition, setPortfolioArchived, updatePosition } from "../portfolio-service";
import { createScenario, setAssetClassAssumptions, upsertShock } from "../scenario-service";
import { getInstrumentContext, getPortfolio, getPortfolioExposures, getPositionProvenance, toExposurePositions } from "../queries/portfolio";
import { resolveIssuerRef } from "../portfolio";
import { getScenario, getScenarioStudio, runScenarioForPortfolio } from "../queries/scenarios";
import { toValuationDate } from "../fixed-income";

const db = getPrisma();
const TAG = "ZZTB";
const DAY = 86_400_000;
const today = toValuationDate(new Date());
const plusDays = (n: number) => new Date(today.getTime() + n * DAY).toISOString().slice(0, 10);

const portfolioIds: string[] = [];
const billIds = new Set<string>();

async function newPortfolio() {
  const r = await createPortfolio({ name: `${TAG} ${Math.random().toString(36).slice(2, 8)}` });
  if (!r.ok) throw new Error(r.error);
  portfolioIds.push(r.id);
  return r.id;
}

/** Independent re-derivation of the reference value from RAW stored auction rows (plain arithmetic — no application code). */
async function independentBillValue(face: number, maturityIso: string) {
  const rows = await db.treasuryRate.findMany({ where: { observationDate: { lte: today } }, include: { instrument: true }, orderBy: { observationDate: "desc" }, take: 120 });
  const byDate = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const k = r.observationDate.toISOString().slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, new Map());
    byDate.get(k)!.set(r.instrument.tenorDays, Number(r.interestRate));
  }
  const date = [...byDate.keys()].sort().reverse().find((k) => [91, 182, 364].every((t) => byDate.get(k)!.has(t)))!;
  const c = byDate.get(date)!;
  const days = Math.round((new Date(`${maturityIso}T00:00:00.000Z`).getTime() - today.getTime()) / DAY);
  let rate: number;
  if (days < 91) rate = c.get(91)!;
  else if (days === 91 || days === 182 || days === 364) rate = c.get(days)!;
  else {
    const [lo, hi] = days < 182 ? [91, 182] : [182, 364];
    rate = c.get(lo)! + ((days - lo) / (hi - lo)) * (c.get(hi)! - c.get(lo)!);
  }
  const value = (r: number) => Math.round((face / (1 + (r / 100) * (days / 365))) * 100) / 100;
  return { date, days, rate, value, ref: value(rate) };
}

beforeAll(async () => {
  // Fail loudly rather than silently pass if the environment has no real auction data.
  const n = await db.treasuryRate.count({ where: { observationDate: { lte: today } } });
  if (n === 0) throw new Error("No Treasury auction data in this environment — the M8.5 integration tests need it.");
});

afterAll(async () => {
  // Portfolios cascade to their positions and scenarios (→ shocks); only then can this file's own bills be removed.
  await db.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
  await db.treasuryBill.deleteMany({ where: { id: { in: [...billIds] } } });
});

describe("addTreasuryBillPosition", () => {
  it("adds a 364-day bill, creating the instrument with a derived issue date; the position stores face value only", async () => {
    const pid = await newPortfolio();
    const maturity = plusDays(245);
    const r = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 364, maturityDate: maturity, faceValueGhs: 1_000_000 });
    if (!r.ok) throw new Error(r.error);
    billIds.add(r.billId);

    const bill = await db.treasuryBill.findUniqueOrThrow({ where: { id: r.billId }, include: { instrument: true } });
    expect(bill.instrument.tenorDays).toBe(364);
    expect(bill.maturityDate.toISOString().slice(0, 10)).toBe(maturity);
    expect(bill.issueDate.toISOString().slice(0, 10)).toBe(plusDays(245 - 364));
    expect(bill.isin).toBeNull(); // never fabricated
    const pos = await db.portfolioPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(pos).toMatchObject({ assetClass: "TREASURY_BILL", treasuryBillId: r.billId, fixedIncomeSecurityId: null, securityId: null, shares: null });
    expect(Number(pos.nominalGhs)).toBe(1_000_000);
  });

  it("values the position from the real stored auction curve — matches an independent calculation to the pesewa", async () => {
    const pid = await newPortfolio();
    const maturity = plusDays(245);
    const r = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 364, maturityDate: maturity, faceValueGhs: 1_000_000 });
    if (!r.ok) throw new Error(r.error);
    billIds.add(r.billId);

    const expected = await independentBillValue(1_000_000, maturity);
    const portfolio = (await getPortfolio(pid))!;
    const row = portfolio.positions[0];
    if (row.valuation.status !== "VALUED" || row.valuation.detail.assetClass !== "TREASURY_BILL") throw new Error("expected a valued bill");
    expect(row.valuation.referenceValueGhs).toBe(expected.ref);
    expect(row.valuation.detail).toMatchObject({ daysToMaturity: expected.days, rateObservationDate: expected.date, faceValueGhs: 1_000_000 });
    expect(row.valuation.detail.referenceRatePct).toBeCloseTo(expected.rate, 10);
    expect(portfolio.summary.referenceValueGhs).toBe(expected.ref);
    expect(portfolio.summary.recentCount + portfolio.summary.staleCount).toBe(1);
  });

  it("provenance names the BoG source, run, auction date and each tender used", async () => {
    const pid = await newPortfolio();
    const r = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 182, maturityDate: plusDays(98), faceValueGhs: 500_000 });
    if (!r.ok) throw new Error(r.error);
    billIds.add(r.billId);
    const row = (await getPortfolio(pid))!.positions[0];
    const prov = await getPositionProvenance(row);
    expect(prov).not.toBeNull();
    expect(prov!.sourceName).toBe("Bank of Ghana — Treasury Bill Rates");
    expect(prov!.ingestionRunId).toBeTruthy();
    const labels = prov!.facts.map((f) => f.label);
    expect(labels).toContain("Auction date");
    expect(labels).toContain("Evidence type");
    expect(labels.some((l) => /^91-day bill, tender/.test(l))).toBe(true);
    expect(labels.some((l) => /^182-day bill, tender/.test(l))).toBe(true);
    expect(prov!.facts.find((f) => f.label === "Evidence type")!.value).toMatch(/not a secondary-market quote/);
  });

  it("reuses the same bill instrument across portfolios; one position per bill per portfolio", async () => {
    const maturity = plusDays(133);
    const p1 = await newPortfolio();
    const p2 = await newPortfolio();
    const a = await addTreasuryBillPosition({ portfolioId: p1, tenorDays: 182, maturityDate: maturity, faceValueGhs: 100_000 });
    const b = await addTreasuryBillPosition({ portfolioId: p2, tenorDays: 182, maturityDate: maturity, faceValueGhs: 200_000 });
    if (!a.ok || !b.ok) throw new Error("add failed");
    billIds.add(a.billId);
    expect(b.billId).toBe(a.billId);
    const dup = await addTreasuryBillPosition({ portfolioId: p1, tenorDays: 182, maturityDate: maturity, faceValueGhs: 5 });
    expect(dup).toMatchObject({ ok: false, existingPositionId: a.positionId });
    expect(await db.portfolioPosition.count({ where: { portfolioId: p1 } })).toBe(1);
  });

  it("rejects malformed and impossible bills without writing anything", async () => {
    const pid = await newPortfolio();
    const before = await db.treasuryBill.count();
    const cases: [string, Parameters<typeof addTreasuryBillPosition>[0]][] = [
      ["unsupported tenor", { portfolioId: pid, tenorDays: 120, maturityDate: plusDays(60), faceValueGhs: 1000 }],
      ["invalid date", { portfolioId: pid, tenorDays: 91, maturityDate: "2026-02-30", faceValueGhs: 1000 }],
      ["matured (past) bill", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(-1), faceValueGhs: 1000 }],
      ["bill maturing today (zero days)", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(0), faceValueGhs: 1000 }],
      ["not yet issued (91-day maturing in 120 days)", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(120), faceValueGhs: 1000 }],
      ["zero face value", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(60), faceValueGhs: 0 }],
      ["negative face value", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(60), faceValueGhs: -5 }],
      ["sub-pesewa face value", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(60), faceValueGhs: 10.001 }],
      ["malformed ISIN", { portfolioId: pid, tenorDays: 91, maturityDate: plusDays(60), faceValueGhs: 1000, isin: "bad" }],
      ["unknown portfolio", { portfolioId: "does-not-exist", tenorDays: 91, maturityDate: plusDays(60), faceValueGhs: 1000 }],
    ];
    for (const [name, input] of cases) {
      const r = await addTreasuryBillPosition(input);
      expect(r.ok, name).toBe(false);
    }
    expect(await db.treasuryBill.count()).toBe(before);
    expect(await db.portfolioPosition.count({ where: { portfolioId: pid } })).toBe(0);
  });

  it("an archived portfolio refuses new bills", async () => {
    const pid = await newPortfolio();
    await setPortfolioArchived(pid, true);
    const r = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 91, maturityDate: plusDays(60), faceValueGhs: 1000 });
    expect(r).toMatchObject({ ok: false });
  });

  it("an ISIN is stored only when supplied, and a conflicting ISIN for the same bill is refused", async () => {
    const maturity = plusDays(77);
    const p = await newPortfolio();
    const first = await addTreasuryBillPosition({ portfolioId: p, tenorDays: 91, maturityDate: maturity, faceValueGhs: 10_000, isin: "ghzztb000012" });
    if (!first.ok) throw new Error(first.error);
    billIds.add(first.billId);
    expect((await db.treasuryBill.findUniqueOrThrow({ where: { id: first.billId } })).isin).toBe("GHZZTB000012");
    const p2 = await newPortfolio();
    const conflict = await addTreasuryBillPosition({ portfolioId: p2, tenorDays: 91, maturityDate: maturity, faceValueGhs: 10_000, isin: "GHZZTB000013" });
    expect(conflict.ok).toBe(false);
  });

  it("updatePosition changes the FACE amount (no purchase fields exist); removePosition leaves the instrument", async () => {
    const pid = await newPortfolio();
    const r = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 364, maturityDate: plusDays(245), faceValueGhs: 1_000_000 });
    if (!r.ok) throw new Error(r.error);
    billIds.add(r.billId);
    expect((await updatePosition({ positionId: r.positionId, nominalGhs: 2_000_000 })).ok).toBe(true);
    expect(Number((await db.portfolioPosition.findUniqueOrThrow({ where: { id: r.positionId } })).nominalGhs)).toBe(2_000_000);
    expect((await updatePosition({ positionId: r.positionId, nominalGhs: 0 })).ok).toBe(false);
    expect((await removePosition(r.positionId)).ok).toBe(true);
    expect(await db.treasuryBill.findUnique({ where: { id: r.billId } })).not.toBeNull();
  });
});

describe("exposures from real data", () => {
  it("allocation, issuer, ladder, upcoming and rate sensitivity for two bills", async () => {
    const pid = await newPortfolio();
    const a = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 364, maturityDate: plusDays(245), faceValueGhs: 1_000_000 });
    const b = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 91, maturityDate: plusDays(63), faceValueGhs: 500_000 });
    if (!a.ok || !b.ok) throw new Error("add failed");
    billIds.add(a.billId);
    billIds.add(b.billId);
    const e = getPortfolioExposures((await getPortfolio(pid))!);
    expect(e.allocation.rows).toHaveLength(1);
    expect(e.allocation.rows[0]).toMatchObject({ assetClass: "TREASURY_BILL", label: "Treasury bills", valuedCount: 2 });
    expect(e.allocation.rows[0].pct).toBeCloseTo(100, 9);
    expect(e.issuers.rows[0].issuer.name).toBe("Government of Ghana");
    expect(e.maturity.buckets.find((x) => x.key === "LT_1Y")).toMatchObject({ nominalGhs: 1_500_000, treasuryBillFaceGhs: 1_500_000, positionCount: 2 });
    expect(e.upcoming.map((u) => u.daysRemaining)).toEqual([63, 245]);
    expect(e.rates.treasuryBills.billPositionCount).toBe(2);
    expect(e.rates.treasuryBills.dv01Ghs).toBeGreaterThan(0);
    expect(e.rates.bondDv01Ghs).toBeNull();
    expect(e.coupon.annualCouponGhs).toBeNull(); // bills pay no coupon
  });
});

describe("sovereign issuer identity", () => {
  it("a Treasury bill and a government bond resolve to the SAME issuer key (one Government of Ghana exposure)", async () => {
    const pid = await newPortfolio();
    const r = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 91, maturityDate: plusDays(66), faceValueGhs: 1000 });
    if (!r.ok) throw new Error(r.error);
    billIds.add(r.billId);
    const ctx = await getInstrumentContext();
    const gogBond = ctx.bonds.find((b) => b.issuerName === "Government of Ghana" && !b.instrumentCode.startsWith("ZZ"));
    if (!gogBond) throw new Error("expected a real Government of Ghana bond in this environment");
    const bondKey = resolveIssuerRef({ companyId: gogBond.companyId, issuerName: gogBond.issuerName }).key;
    const billKey = toExposurePositions((await getPortfolio(pid, ctx))!.positions)[0].issuer.key;
    expect(billKey).toBe(bondKey);
  });
});

describe("scenarios on bills (stored assumptions → engine)", () => {
  it("a +200 bps Treasury-bill assumption reprices the bill; impact reconciles and matches an independent calculation", async () => {
    const pid = await newPortfolio();
    const maturity = plusDays(245);
    const add = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 364, maturityDate: maturity, faceValueGhs: 1_000_000 });
    if (!add.ok) throw new Error(add.error);
    billIds.add(add.billId);
    const sc = await createScenario({ portfolioId: pid, name: `${TAG} +200` });
    if (!sc.ok) throw new Error(sc.error);
    const set = await setAssetClassAssumptions({ scenarioId: sc.id, entries: [{ assetClass: "TREASURY_BILL", value: 200 }, { assetClass: "GOVERNMENT_BOND", value: null }] });
    expect(set.ok).toBe(true);

    const ctx = await getInstrumentContext();
    const portfolio = (await getPortfolio(pid, ctx))!;
    const def = (await getScenario(sc.id, ctx))!;
    const result = runScenarioForPortfolio(portfolio, def);
    if (!result.ok) throw new Error("scenario invalid");

    const exp = await independentBillValue(1_000_000, maturity);
    const expectedImpact = Math.round((exp.value(exp.rate + 2) - exp.ref) * 100) / 100;
    const p = result.positions[0];
    if (p.status !== "PARTICIPATING") throw new Error("expected participating");
    expect(p.impactGhs).toBe(expectedImpact);
    expect(p.impactGhs).toBeLessThan(0);
    expect(result.portfolio.reconciles).toBe(true);
    expect(result.portfolio.impactGhs).toBe(expectedImpact);

    const studio = await getScenarioStudio(portfolio, def);
    expect(studio.view!.headline.sentence).toMatch(/falls by/);
    const text = JSON.stringify(studio.view!.positions[0].simple);
    expect(text).toMatch(/reference rate rises from/);
    expect(studio.view!.assumptions[0].plain).toBe("Treasury-bill rates rise by 2.0 percentage points.");
  });

  it("a security-level bill assumption is stored against the bill and overrides the asset-class assumption", async () => {
    const pid = await newPortfolio();
    const add = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 182, maturityDate: plusDays(98), faceValueGhs: 1_000_000 });
    if (!add.ok) throw new Error(add.error);
    billIds.add(add.billId);
    const sc = await createScenario({ portfolioId: pid, name: `${TAG} specific` });
    if (!sc.ok) throw new Error(sc.error);
    await setAssetClassAssumptions({ scenarioId: sc.id, entries: [{ assetClass: "TREASURY_BILL", value: 200 }] });
    const up = await upsertShock({ scenarioId: sc.id, target: { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: add.billId }, value: -100 });
    expect(up.ok).toBe(true);
    const stored = await db.scenarioShock.findMany({ where: { scenarioId: sc.id }, orderBy: { createdAt: "asc" } });
    expect(stored.find((s) => s.treasuryBillId === add.billId)).toMatchObject({ targetKind: "SECURITY", shockType: "YIELD_BPS", fixedIncomeSecurityId: null, securityId: null });
    const ctx = await getInstrumentContext();
    const portfolio = (await getPortfolio(pid, ctx))!;
    const result = runScenarioForPortfolio(portfolio, (await getScenario(sc.id, ctx))!);
    if (!result.ok) throw new Error("invalid");
    const p = result.positions[0];
    if (p.status !== "PARTICIPATING" || p.detail.assetClass !== "TREASURY_BILL") throw new Error("expected bill");
    expect(p.resolution.precedence).toBe("SECURITY");
    expect(p.detail.appliedShockBps).toBe(-100);
    expect(p.impactGhs).toBeGreaterThan(0);
    // the same assumption twice is an upsert, never a duplicate
    await upsertShock({ scenarioId: sc.id, target: { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: add.billId }, value: -50 });
    expect(await db.scenarioShock.count({ where: { scenarioId: sc.id, treasuryBillId: add.billId } })).toBe(1);
  });

  it("the service refuses an equity-style price shock on a bill, and a non-existent bill target", async () => {
    const pid = await newPortfolio();
    const sc = await createScenario({ portfolioId: pid, name: `${TAG} bad` });
    if (!sc.ok) throw new Error(sc.error);
    expect((await upsertShock({ scenarioId: sc.id, target: { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: "nope" }, value: 100 })).ok).toBe(false);
    expect((await upsertShock({ scenarioId: sc.id, target: { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: "nope" }, value: 5000 })).ok).toBe(false);
  });
});

describe("database constraints (backstop)", () => {
  it("rejects a TREASURY_BILL position that also carries shares or has no bill, and a non-positive face", async () => {
    const pid = await newPortfolio();
    const add = await addTreasuryBillPosition({ portfolioId: pid, tenorDays: 91, maturityDate: plusDays(70), faceValueGhs: 1000 });
    if (!add.ok) throw new Error(add.error);
    billIds.add(add.billId);
    const p2 = await newPortfolio();
    await expect(db.portfolioPosition.create({ data: { portfolioId: p2, assetClass: "TREASURY_BILL", treasuryBillId: add.billId, nominalGhs: 100, shares: 5 } })).rejects.toThrow();
    await expect(db.portfolioPosition.create({ data: { portfolioId: p2, assetClass: "TREASURY_BILL", nominalGhs: 100 } })).rejects.toThrow();
    await expect(db.portfolioPosition.create({ data: { portfolioId: p2, assetClass: "TREASURY_BILL", treasuryBillId: add.billId, nominalGhs: 0 } })).rejects.toThrow();
    await expect(db.portfolioPosition.create({ data: { portfolioId: pid, assetClass: "TREASURY_BILL", treasuryBillId: add.billId, nominalGhs: 100 } })).rejects.toThrow(); // unique per portfolio
  });
  it("rejects an asset-class PRICE_PCT shock on TREASURY_BILL", async () => {
    const pid = await newPortfolio();
    const sc = await createScenario({ portfolioId: pid, name: `${TAG} db` });
    if (!sc.ok) throw new Error(sc.error);
    await expect(db.scenarioShock.create({ data: { scenarioId: sc.id, targetKind: "ASSET_CLASS", assetClass: "TREASURY_BILL", shockType: "PRICE_PCT", value: -10 } })).rejects.toThrow();
    await expect(db.scenarioShock.create({ data: { scenarioId: sc.id, targetKind: "ASSET_CLASS", assetClass: "TREASURY_BILL", shockType: "YIELD_BPS", value: 100 } })).resolves.toBeTruthy();
  });
});
