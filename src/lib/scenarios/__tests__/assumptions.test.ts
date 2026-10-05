import { describe, expect, it } from "vitest";
import { computeDuration, type BondTerms } from "../../fixed-income";
import { computeExposures, valueBondPosition, valueBondWithAssumption, valueEquityPosition, valueEquityWithAssumption, summarizePortfolio, type BondValuationInput, type EquityValuationInput, type ExposurePosition, type PositionValuation, type StoredAssumption, type Unvalued, type ValuedPosition } from "../../portfolio";
import { runScenario, type ParticipatingPositionResult, type ScenarioPosition, type ScenarioResult, type ScenarioShockRule } from "..";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VAL = d("2026-10-05");
const GOV_TERMS: BondTerms = { issueDate: d("2024-07-01"), maturityDate: d("2034-07-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const CORP_TERMS: BondTerms = { issueDate: d("2025-09-01"), maturityDate: d("2028-09-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const bondIn = (ytm: number): BondValuationInput => ({ available: true, assetClass: "BOND", observedYtmPct: ytm, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: null, yieldFromSourceQuote: false, pendingReview: null });
const eqIn = (price: number): EquityValuationInput => ({ available: true, assetClass: "EQUITY", priceGhs: price, priceDate: "2026-10-03", ageDays: 2, recency: "RECENT", volume: 1000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-03", skippedNoTradeRows: 0 });
const UNV: Unvalued = { available: false, code: "NO_OBSERVATION", reason: "No usable observation." };
const A = (kind: StoredAssumption["kind"], value: number | null): StoredAssumption => ({ kind, value, overridesReference: false });

const GOV = { key: "name:government of ghana", name: "Government of Ghana" };
const KASA = { key: "company:kasa", name: "Kasapreko" };
const GCB = { key: "company:gcb", name: "GCB" };

const gov = (): ScenarioPosition => ({ positionId: "p-gov", label: "GoG Jul-34", assetClass: "GOVERNMENT_BOND", issuer: GOV, instrumentId: "b-gov", valuation: valueBondPosition(2_000_000, GOV_TERMS, bondIn(28), VAL), terms: GOV_TERMS });
const gcb = (): ScenarioPosition => ({ positionId: "p-gcb", label: "GCB", assetClass: "EQUITY", issuer: GCB, instrumentId: "s-gcb", valuation: valueEquityPosition(100_000, eqIn(5)), terms: null });
/** Kasapreko bond with NO reliable Reference value, carried at an analyst-assumed starting yield. */
const kasa = (yieldPct: number, valuation?: PositionValuation): ScenarioPosition => ({
  positionId: "p-kasa",
  label: "Kasapreko Sep-28",
  assetClass: "CORPORATE_BOND",
  issuer: KASA,
  instrumentId: "b-kasa",
  valuation: valuation ?? valueBondWithAssumption(1_500_000, CORP_TERMS, A("YIELD_PCT", yieldPct), VAL),
  terms: CORP_TERMS,
});
const rule = (id: string, selector: ScenarioShockRule["selector"], shockType: ScenarioShockRule["shockType"], value: number, targetLabel = id): ScenarioShockRule => ({ id, selector, shockType, value, targetLabel });
const corpUp = (bps: number) => rule("corp", { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, "YIELD_BPS", bps, "Corporate bonds");
const govUp = (bps: number) => rule("gov", { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, "YIELD_BPS", bps, "Government bonds");
const eqDown = (pct: number) => rule("eq", { kind: "ASSET_CLASS", assetClass: "EQUITY" }, "PRICE_PCT", pct, "Equities");

function run(positions: ScenarioPosition[], rules: ScenarioShockRule[]): Extract<ScenarioResult, { ok: true }> {
  const r = runScenario({ valuationDate: VAL, positions, rules });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  return r;
}
const part = (r: Extract<ScenarioResult, { ok: true }>, id: string): ParticipatingPositionResult => {
  const p = r.positions.find((x) => x.positionId === id);
  if (!p || p.status !== "PARTICIPATING") throw new Error(`${id} not participating`);
  return p;
};

describe("assumption-valued positions in the scenario engine (M8.3 reused, not forked)", () => {
  it("participates, and the result states its starting basis and the assumption behind it", () => {
    const r = run([gov(), kasa(28), gcb()], [corpUp(300)]);
    const k = part(r, "p-kasa");
    expect(k.status).toBe("PARTICIPATING");
    expect(k.basis).toBe("ANALYST_ASSUMPTION");
    expect(k.startingAssumption).toMatchObject({ kind: "YIELD_PCT", value: 28, provenance: "Analyst assumption" });
    expect(k.recency).toBe("NOT_APPLICABLE");
    expect(part(r, "p-gov").basis).toBe("REFERENCE");
  });

  it("starting assumption ≠ scenario shock: scenario yield = assumed start + shock", () => {
    const k = part(run([kasa(28)], [corpUp(300)]), "p-kasa");
    if (k.detail.assetClass !== "BOND") throw new Error("bond");
    expect(k.detail.referenceYieldPct).toBe(28);
    expect(k.detail.appliedShockBps).toBe(300);
    expect(k.detail.scenarioYieldPct).toBeCloseTo(31, 12);
    expect(k.impactGhs).toBeLessThan(0);
  });

  it("the scenario result depends on BOTH the starting assumption and the shock", () => {
    const at = (y: number, bps: number) => part(run([kasa(y)], [corpUp(bps)]), "p-kasa");
    const a = at(24, 300);
    const b = at(32, 300);
    expect(a.referenceValueGhs).toBeGreaterThan(b.referenceValueGhs); // different start …
    expect(a.scenarioValueGhs).not.toBe(b.scenarioValueGhs); // … different result for the SAME shock
    expect(a.impactGhs).not.toBe(b.impactGhs);
    expect(at(28, 0).impactGhs).toBe(0); // no shock → no impact, whatever the start
  });

  it("mixed-basis starting value reconciles exactly and splits by basis", () => {
    const positions = [gov(), kasa(28), gcb()];
    const r = run(positions, [govUp(200), corpUp(300), eqDown(-10)]);
    const p = r.portfolio;
    const b = p.byBasis;
    expect(Math.round((b.reference.startingValueGhs + b.indicative.startingValueGhs + b.assumption.startingValueGhs) * 100)).toBe(Math.round(p.referenceBasisGhs! * 100));
    expect(Math.round((b.reference.scenarioValueGhs + b.assumption.scenarioValueGhs) * 100)).toBe(Math.round(p.scenarioValueGhs! * 100));
    expect(Math.round((b.reference.impactGhs + b.assumption.impactGhs) * 100)).toBe(Math.round(p.impactGhs! * 100));
    expect(b.reference.count).toBe(2);
    expect(b.assumption.count).toBe(1);
    expect(p.assumptionBasisPct).toBeCloseTo(b.assumption.startingPct!, 12);
    expect(p.reconciles).toBe(true);
    const sumOfPositions = r.positions.reduce((s, x) => s + (x.status === "PARTICIPATING" ? Math.round(x.impactGhs * 100) : 0), 0);
    expect(sumOfPositions).toBe(Math.round(p.impactGhs! * 100));
  });

  it("an unvalued position with no assumption stays UNAVAILABLE and out of the basis (not zero, not par)", () => {
    const unvalued: ScenarioPosition = { ...kasa(28), valuation: valueBondPosition(1_500_000, CORP_TERMS, UNV, VAL) };
    const r = run([gov(), unvalued], [corpUp(300)]);
    const u = r.positions.find((x) => x.positionId === "p-kasa")!;
    expect(u.status).toBe("UNAVAILABLE");
    expect(r.portfolio.unvaluedCount).toBe(1);
    expect(r.portfolio.byBasis.assumption.count).toBe(0);
    expect(r.portfolio.referenceBasisGhs).toBe(part(r, "p-gov").referenceValueGhs);
  });

  it("removing the assumption removes the position from the analysis (scenario invalid for it, not silently valued)", () => {
    const withIt = run([gov(), kasa(28)], [corpUp(300)]);
    const without = run([gov(), { ...kasa(28), valuation: valueBondPosition(1_500_000, CORP_TERMS, UNV, VAL) }], [corpUp(300)]);
    expect(withIt.portfolio.participatingCount).toBe(2);
    expect(without.portfolio.participatingCount).toBe(1);
    expect(without.portfolio.byBasis.assumption.count).toBe(0);
  });

  it("the starting-basis fingerprint changes with the assumption — so two results are only comparable on the same start", () => {
    const f = (y: number) => run([gov(), kasa(y)], [corpUp(100)]).portfolio.startingBasisFingerprint;
    expect(f(28)).toBe(f(28));
    expect(f(28)).not.toBe(f(30));
    expect(run([gov()], [govUp(100)]).portfolio.startingBasisFingerprint).toBe("");
  });

  it("an equity price assumption is shocked like any equity", () => {
    const eq: ScenarioPosition = { ...gcb(), valuation: valueEquityWithAssumption(100_000, A("SHARE_PRICE_GHS", 5), VAL) };
    const r = run([eq], [eqDown(-10)]);
    const p = part(r, "p-gcb");
    expect(p.referenceValueGhs).toBe(500_000);
    expect(p.scenarioValueGhs).toBe(450_000);
    expect(p.basis).toBe("ANALYST_ASSUMPTION");
  });

  it("price-assumed bond gets a yield, so it can be shocked and has a DV01", () => {
    const priced: ScenarioPosition = { ...kasa(0), valuation: valueBondWithAssumption(1_500_000, CORP_TERMS, A("PRICE_PER_100", 85), VAL) };
    const k = part(run([priced], [corpUp(200)]), "p-kasa");
    if (k.detail.assetClass !== "BOND") throw new Error("bond");
    expect(k.detail.dv01Ghs).toBeGreaterThan(0);
    expect(k.impactGhs).toBeLessThan(0);
  });
});

describe("exposures with assumption-valued positions", () => {
  const exposurePosition = (p: ScenarioPosition, bond: boolean): ExposurePosition => ({
    positionId: p.positionId,
    label: p.label,
    assetClass: p.assetClass,
    issuer: p.issuer,
    valuation: p.valuation,
    bond: bond ? { nominalGhs: (p.valuation as ValuedPosition).detail.assetClass === "BOND" ? ((p.valuation as ValuedPosition).detail as { nominalGhs: number }).nominalGhs : 0, currency: "GHS", status: "ACTIVE", terms: p.terms!, maturityConflict: false, couponConflict: false } : null,
  });
  const positions = [exposurePosition(gov(), true), exposurePosition(kasa(28), true), exposurePosition(gcb(), false)];
  const summary = summarizePortfolio(positions.map((p) => p.valuation), VAL);
  const e = computeExposures(positions, summary, VAL);

  it("allocation uses the analytical starting value (assumption included) and sums to 100%", () => {
    expect(e.allocation.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
    expect(e.allocation.rows.find((r) => r.assetClass === "CORPORATE_BOND")?.referenceValueGhs).toBe((positions[1].valuation as ValuedPosition).referenceValueGhs);
  });

  it("issuer concentration includes the assumed holding", () => {
    expect(e.issuers.rows.map((r) => r.issuer.name)).toContain("Kasapreko");
  });

  it("maturity is contractual and independent of the valuation assumption", () => {
    const withAssumption = e.maturity;
    const without = computeExposures([positions[0], { ...positions[1], valuation: valueBondPosition(1_500_000, CORP_TERMS, UNV, VAL) }, positions[2]], summarizePortfolio([positions[0].valuation, valueBondPosition(1_500_000, CORP_TERMS, UNV, VAL), positions[2].valuation], VAL), VAL).maturity;
    expect(withAssumption.buckets.map((b) => b.nominalGhs)).toEqual(without.buckets.map((b) => b.nominalGhs));
  });

  it("rate sensitivity: an assumed-yield bond is measured with M7's duration at the ASSUMED yield; an unvalued bond is listed as excluded", () => {
    const row = e.rates.contributors.find((c) => c.positionId === "p-kasa");
    expect(row).toBeDefined();
    const dur = computeDuration(CORP_TERMS, VAL, 28);
    if (!dur.ok) throw new Error("duration");
    expect(row!.dv01Ghs).toBeCloseTo((dur.dv01 * 1_500_000) / 100, 1); // M8.2 rounds to the pesewa
    const un = computeExposures([positions[0], { ...positions[1], valuation: valueBondPosition(1_500_000, CORP_TERMS, UNV, VAL) }], summarizePortfolio([positions[0].valuation, valueBondPosition(1_500_000, CORP_TERMS, UNV, VAL)], VAL), VAL);
    expect(un.rates.contributors.some((c) => c.positionId === "p-kasa")).toBe(false);
    expect(un.rates.coverage.excluded.some((x) => x.positionId === "p-kasa")).toBe(true);
    expect(row!.basis).toBe("ANALYST_ASSUMPTION");
  });
});
