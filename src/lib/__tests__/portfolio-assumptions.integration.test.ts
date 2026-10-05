// ---------------------------------------------------------------------------
// Integration tests for valuation assumptions (M9.0.1) — real database. ZZVA-
// prefixed bonds/portfolios only (equities are real and read-only), removed
// afterwards. Real DataSource + IngestionRun are reused read-only for the bond
// table's provenance FKs. No market data is written.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPositionsBatch, createPortfolio, previewPositionAssumption, removePosition, removePositionAssumption, setPositionAssumption } from "../portfolio-service";
import { getInstrumentContext, getPortfolio, getPortfolioExposures } from "../queries/portfolio";
import { toScenarioPositions } from "../queries/scenarios";
import { runScenario } from "../scenarios";

const db = getPrisma();
const TAG = "ZZVA";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const portfolioIds: string[] = [];
let sourceId: string;
let runId: string;
let bondId: string; // no observation → "No reliable Reference Value", terms complete → assumable
let bond2Id: string;
let termsBondId: string; // fixed coupon with no rate → TERMS_UNSUPPORTED → NOT assumable
let valuedEquityId: string; // real equity with a recent real trade → Korbly-supported

async function newPortfolio() {
  const r = await createPortfolio({ name: `${TAG} ${Math.random().toString(36).slice(2, 8)}` });
  if (!r.ok) throw new Error(r.error);
  portfolioIds.push(r.id);
  return r.id;
}
const makeBond = async (code: string, over: Record<string, unknown> = {}) =>
  (await db.fixedIncomeSecurity.create({ data: { instrumentCode: `${TAG}${code}`, instrumentName: `${TAG} ${code}`, issuerName: `${TAG} Issuer`, instrumentType: "CORPORATE_BOND", classification: "CORPORATE", issueDate: d("2025-01-01"), maturityDate: d("2030-01-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", sourceId, ingestionRunId: runId, ...over } })).id;
const count = (portfolioId: string) => db.portfolioPosition.count({ where: { portfolioId } });
const assumptionCount = (portfolioId: string) => db.positionAssumption.count({ where: { position: { portfolioId } } });
const load = async (pid: string) => getPortfolio(pid, await getInstrumentContext());

beforeAll(async () => {
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  sourceId = run.dataSourceId;
  runId = run.id;
  bondId = await makeBond("B1");
  bond2Id = await makeBond("B2");
  termsBondId = await makeBond("TERMS", { couponRatePct: null });
  const ctx = await getInstrumentContext();
  const valued = ctx.equities.find((e) => e.input.available && e.addable.addable && !e.ticker.startsWith("ZZ"));
  if (!valued) throw new Error("test needs one real equity with a usable trade");
  valuedEquityId = valued.id;
});

afterAll(async () => {
  await db.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { startsWith: TAG } } });
});

describe("batch builder with assumptions", () => {
  it("persists the analyst's INPUT with the position; the value is recomputed and labelled as an assumption", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1,500,000", assumption: { kind: "YIELD_PCT", value: "28" } }, { key: "b", assetClass: "EQUITY", instrumentId: valuedEquityId, shares: "1000" }] });
    expect(r).toMatchObject({ ok: true, positionCount: 2 });
    const stored = await db.positionAssumption.findMany({ where: { position: { portfolioId: pid } } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "YIELD_PCT", overridesReference: false });
    expect(Number(stored[0].value)).toBe(28);

    const p = (await load(pid))!;
    const row = p.positions.find((x) => x.holding.assetClass === "BOND")!;
    expect(row.valuation.status).toBe("VALUED");
    if (row.valuation.status !== "VALUED") return;
    expect(row.valuation.basis).toBe("ANALYST_ASSUMPTION");
    expect(row.valuation.assumption).toMatchObject({ kind: "YIELD_PCT", value: 28, provenance: "Analyst assumption" });
    // Korbly's own valuation is untouched: still unvalued, with its real reason.
    expect(row.korblyValuation.status).toBe("UNVALUED");
    // Mixed portfolio: one Korbly-supported equity, one assumption bond; the split reconciles exactly.
    expect(p.summary.assumptionCount).toBe(1);
    expect(p.summary.basis.reference.count).toBe(1);
    expect(Math.round((p.summary.basis.reference.valueGhs + p.summary.basis.assumption.valueGhs) * 100)).toBe(Math.round(p.summary.referenceValueGhs! * 100));
  });

  it("an unvalued row with NO assumption stays unvalued — nothing is assumed by default", async () => {
    const pid = await newPortfolio();
    expect((await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000000" }] })).ok).toBe(true);
    expect(await assumptionCount(pid)).toBe(0);
    const p = (await load(pid))!;
    expect(p.positions[0].valuation.status).toBe("UNVALUED");
    expect(p.summary.referenceValueGhs).toBeNull();
  });

  it("one impossible assumption fails the WHOLE batch: no position and no assumption is saved (rollback)", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "good", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000000", assumption: { kind: "YIELD_PCT", value: "28" } }, { key: "bad", assetClass: "BOND", instrumentId: bond2Id, nominalGhs: "1000000", assumption: { kind: "YIELD_PCT", value: "500" } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors.map((e) => e.key)).toEqual(["bad"]);
    expect(await count(pid)).toBe(0);
    expect(await assumptionCount(pid)).toBe(0);
  });

  it("missing contract terms stay unavailable even with an assumption — the row is refused with the reason", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "t", assetClass: "BOND", instrumentId: termsBondId, nominalGhs: "1000000", assumption: { kind: "YIELD_PCT", value: "28" } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors[0].error).toMatch(/does not invent contract terms|cannot be used here/i);
    expect(await count(pid)).toBe(0);
  });

  it("par is stored only when explicitly chosen (value null), and never for an equity", async () => {
    const pid = await newPortfolio();
    const ok = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "p", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000000", assumption: { kind: "PAR", value: "" } }] });
    expect(ok.ok).toBe(true);
    const a = await db.positionAssumption.findFirstOrThrow({ where: { position: { portfolioId: pid } } });
    expect(a.kind).toBe("PAR");
    expect(a.value).toBeNull();
    const pid2 = await newPortfolio();
    const bad = await addPositionsBatch({ portfolioId: pid2, entries: [{ key: "e", assetClass: "EQUITY", instrumentId: valuedEquityId, shares: "10", assumption: { kind: "PAR", value: "" } }] });
    expect(bad.ok).toBe(false);
    expect(await count(pid2)).toBe(0);
  });

  it("a malformed assumption value is an error, not a silent drop", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "x", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000", assumption: { kind: "YIELD_PCT", value: "abc" } }] });
    expect(r.ok).toBe(false);
    expect(await count(pid)).toBe(0);
  });
});

describe("edit, remove and override", () => {
  async function bondPosition(): Promise<{ pid: string; positionId: string }> {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "2000000" }] });
    if (!r.ok) throw new Error("setup failed");
    return { pid, positionId: r.positionIds[0] };
  }

  it("set → edit changes the starting basis deterministically; one assumption per position", async () => {
    const { pid, positionId } = await bondPosition();
    expect(await setPositionAssumption({ positionId, kind: "YIELD_PCT", value: 24 })).toMatchObject({ ok: true, overridesReference: false });
    const v24 = ((await load(pid))!.positions[0].valuation as { referenceValueGhs: number }).referenceValueGhs;
    expect(await setPositionAssumption({ positionId, kind: "YIELD_PCT", value: 32 })).toMatchObject({ ok: true });
    const v32 = ((await load(pid))!.positions[0].valuation as { referenceValueGhs: number }).referenceValueGhs;
    expect(v32).toBeLessThan(v24); // a higher assumed yield → a lower starting value
    expect(await assumptionCount(pid)).toBe(1);
    // switching kind (yield → explicit par) replaces it
    expect(await setPositionAssumption({ positionId, kind: "PAR", value: null })).toMatchObject({ ok: true });
    const a = await db.positionAssumption.findUniqueOrThrow({ where: { positionId } });
    expect(a.kind).toBe("PAR");
  });

  it("the preview is exactly what is saved", async () => {
    const { pid, positionId } = await bondPosition();
    const preview = await previewPositionAssumption({ positionId, kind: "PRICE_PER_100", value: 85 });
    if (!preview.ok) throw new Error(preview.error);
    await setPositionAssumption({ positionId, kind: "PRICE_PER_100", value: 85 });
    const saved = (await load(pid))!.positions[0].valuation as { referenceValueGhs: number };
    expect(saved.referenceValueGhs).toBe(preview.evaluation.valuation.referenceValueGhs);
  });

  it("remove returns the position to Korbly's own valuation — unvalued here — and the analysis forgets the assumption", async () => {
    const { pid, positionId } = await bondPosition();
    await setPositionAssumption({ positionId, kind: "YIELD_PCT", value: 28 });
    expect((await load(pid))!.summary.assumptionCount).toBe(1);
    expect(await removePositionAssumption(positionId)).toEqual({ ok: true });
    const p = (await load(pid))!;
    expect(p.positions[0].valuation.status).toBe("UNVALUED");
    expect(p.summary.assumptionCount).toBe(0);
    expect(p.summary.referenceValueGhs).toBeNull();
    expect(await assumptionCount(pid)).toBe(0);
  });

  it("removing the position removes its assumption (cascade)", async () => {
    const { pid, positionId } = await bondPosition();
    await setPositionAssumption({ positionId, kind: "YIELD_PCT", value: 28 });
    expect((await removePosition(positionId)).ok).toBe(true);
    expect(await db.positionAssumption.count({ where: { positionId } })).toBe(0);
    expect(await count(pid)).toBe(0);
  });

  it("rejects invalid assumptions with a reason and stores nothing", async () => {
    const { positionId } = await bondPosition();
    for (const [kind, value] of [["YIELD_PCT", 101], ["YIELD_PCT", -1], ["YIELD_PCT", Number.NaN], ["PRICE_PER_100", 0], ["PRICE_PER_100", -5], ["SHARE_PRICE_GHS", 10], ["RATE_PCT", 20]] as const) {
      const r = await setPositionAssumption({ positionId, kind, value });
      expect(r.ok, `${kind} ${value}`).toBe(false);
    }
    expect(await db.positionAssumption.count({ where: { positionId } })).toBe(0);
  });

  it("an archived portfolio cannot have assumptions changed", async () => {
    const { pid, positionId } = await bondPosition();
    await db.portfolio.update({ where: { id: pid }, data: { archivedAt: new Date() } });
    expect((await setPositionAssumption({ positionId, kind: "YIELD_PCT", value: 28 })).ok).toBe(false);
    expect((await removePositionAssumption(positionId)).ok).toBe(false);
  });

  it("an unsupported assumption type for the asset class is refused", async () => {
    const { positionId } = await bondPosition();
    expect((await setPositionAssumption({ positionId, kind: "SHARE_PRICE_GHS", value: 5 })).ok).toBe(false);
    expect((await setPositionAssumption({ positionId, kind: "PAR", value: 100 })).ok).toBe(false);
  });

  it("OVERRIDE of a Korbly-supported value is explicit, keeps Korbly's value beside it, and can be removed", async () => {
    const pid = await newPortfolio();
    const add = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "e", assetClass: "EQUITY", instrumentId: valuedEquityId, shares: "1000" }] });
    if (!add.ok) throw new Error("setup failed");
    const positionId = add.positionIds[0];
    const before = (await load(pid))!.positions[0].valuation;
    if (before.status !== "VALUED") throw new Error("expected a valued equity");
    expect(before.basis).toBe("REFERENCE");

    const set = await setPositionAssumption({ positionId, kind: "SHARE_PRICE_GHS", value: before.detail.assetClass === "EQUITY" ? before.detail.priceGhs * 2 : 1 });
    expect(set).toMatchObject({ ok: true, overridesReference: true });
    const over = (await load(pid))!.positions[0];
    if (over.valuation.status !== "VALUED") throw new Error("valued");
    expect(over.valuation.basis).toBe("ANALYST_ASSUMPTION");
    expect(over.valuation.korblyBasis).toMatchObject({ basis: "REFERENCE", valueGhs: before.referenceValueGhs });
    // Korbly's reference valuation object is exactly what it was.
    expect(over.korblyValuation).toEqual(before);
    expect(over.valuation.referenceValueGhs).not.toBe(before.referenceValueGhs);

    await removePositionAssumption(positionId);
    const back = (await load(pid))!.positions[0].valuation;
    expect(back).toEqual(before);
  });
});

describe("analysis with assumption-valued holdings (real data)", () => {
  it("exposures and the scenario engine include the assumed bond, disclose it, and reconcile exactly", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "k", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1,500,000", assumption: { kind: "YIELD_PCT", value: "28" } }, { key: "e", assetClass: "EQUITY", instrumentId: valuedEquityId, shares: "10000" }] });
    expect(r.ok).toBe(true);
    const p = (await load(pid))!;
    const ex = getPortfolioExposures(p);
    expect(ex.valueBasis.assumptionCount).toBe(1);
    expect(ex.callouts.join(" ")).toMatch(/Analytical Starting Value/);
    expect(ex.rates.contributors.map((c) => c.basis)).toContain("ANALYST_ASSUMPTION");

    const run = (bps: number) =>
      runScenario({
        valuationDate: new Date(`${p.valuationDate}T00:00:00.000Z`),
        positions: toScenarioPositions(p.positions),
        rules: [{ id: "c", selector: { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, shockType: "YIELD_BPS", value: bps, targetLabel: "Corporate bonds" }],
      });
    const res = run(300);
    if (!res.ok) throw new Error("scenario invalid");
    const k = res.positions.find((x) => x.status === "PARTICIPATING" && x.basis === "ANALYST_ASSUMPTION");
    expect(k).toBeDefined();
    expect(res.portfolio.reconciles).toBe(true);
    expect(res.portfolio.byBasis.assumption.count).toBe(1);
    // starting assumption ≠ shock: a different start gives a different result for the same shock
    await setPositionAssumption({ positionId: p.positions.find((x) => x.holding.assetClass === "BOND")!.positionId, kind: "YIELD_PCT", value: 34 });
    const p2 = (await load(pid))!;
    const res2 = runScenario({ valuationDate: new Date(`${p2.valuationDate}T00:00:00.000Z`), positions: toScenarioPositions(p2.positions), rules: [{ id: "c", selector: { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, shockType: "YIELD_BPS", value: 300, targetLabel: "Corporate bonds" }] });
    if (!res2.ok) throw new Error("scenario invalid");
    expect(res2.portfolio.startingBasisFingerprint).not.toBe(res.portfolio.startingBasisFingerprint);
    expect(res2.portfolio.referenceBasisGhs).not.toBe(res.portfolio.referenceBasisGhs);
  });
});

describe("database constraints (backstop)", () => {
  it("rejects a PAR with a value, a price without a value and an out-of-range yield", async () => {
    const pid = await newPortfolio();
    const add = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "k", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000" }] });
    if (!add.ok) throw new Error("setup");
    const positionId = add.positionIds[0];
    await expect(db.positionAssumption.create({ data: { positionId, kind: "PAR", value: 100 } })).rejects.toThrow();
    await expect(db.positionAssumption.create({ data: { positionId, kind: "PRICE_PER_100", value: null } })).rejects.toThrow();
    await expect(db.positionAssumption.create({ data: { positionId, kind: "YIELD_PCT", value: 101 } })).rejects.toThrow();
    await expect(db.positionAssumption.create({ data: { positionId, kind: "PRICE_PER_100", value: 0 } })).rejects.toThrow();
    expect(await db.positionAssumption.count({ where: { positionId } })).toBe(0);
  });
});
