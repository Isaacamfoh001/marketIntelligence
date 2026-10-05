import { describe, expect, it } from "vitest";
import { selectLatestCompleteCurve, type AuctionRateRow } from "../../treasury-bills";
import { resolveBillValuationInput, valueBillPosition, valueBondPosition, valueEquityPosition, type BondValuationInput, type EquityValuationInput, type Unvalued } from "../../portfolio";
import type { BondTerms } from "../../fixed-income";
import { runScenario, validateRules, type BillScenarioDetail, type ParticipatingPositionResult, type ScenarioPosition, type ScenarioResult, type ScenarioShockRule } from "..";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VAL = d("2026-10-05");
const row = (tenorDays: number, interestRatePct: number): AuctionRateRow => ({ tenorDays, observationDate: "2026-09-28", interestRatePct, discountRatePct: 0, tenderNumber: "2026" });
const CURVE = selectLatestCompleteCurve([row(91, 4.6785), row(182, 6.37), row(364, 9.8339)], "2026-10-05");

const GOV = { key: "name:government of ghana", name: "Government of Ghana" };
const KASA = { key: "company:kasa", name: "Kasapreko" };

const billPosition = (id: string, maturity: string, tenor: number, face: number, over: Partial<ScenarioPosition> = {}, curve = CURVE): ScenarioPosition => ({
  positionId: id,
  label: `${tenor}d bill ${maturity}`,
  assetClass: "TREASURY_BILL",
  issuer: GOV,
  instrumentId: `bill-${id}`,
  valuation: valueBillPosition(face, resolveBillValuationInput({ currency: "GHS", tenorDays: tenor, issueDate: new Date(d(maturity).getTime() - tenor * 86_400_000), maturityDate: d(maturity), curve }, VAL), VAL),
  terms: null,
  ...over,
});

const GOV_TERMS: BondTerms = { issueDate: d("2024-07-01"), maturityDate: d("2034-07-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const CORP_TERMS: BondTerms = { issueDate: d("2025-09-01"), maturityDate: d("2028-09-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const bondIn = (ytm: number): BondValuationInput => ({ available: true, assetClass: "BOND", observedYtmPct: ytm, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: null, yieldFromSourceQuote: false, pendingReview: null });
const eqIn = (price: number): EquityValuationInput => ({ available: true, assetClass: "EQUITY", priceGhs: price, priceDate: "2026-10-03", ageDays: 2, recency: "RECENT", volume: 1000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-03", skippedNoTradeRows: 0 });
const govBond = (): ScenarioPosition => ({ positionId: "gov", label: "GoG Jul-34", assetClass: "GOVERNMENT_BOND", issuer: GOV, instrumentId: "b-gov", valuation: valueBondPosition(2_000_000, GOV_TERMS, bondIn(28), VAL), terms: GOV_TERMS });
const corpBond = (): ScenarioPosition => ({ positionId: "corp", label: "Kasapreko Sep-28", assetClass: "CORPORATE_BOND", issuer: KASA, instrumentId: "b-corp", valuation: valueBondPosition(1_000_000, CORP_TERMS, bondIn(26), VAL), terms: CORP_TERMS });
const equity = (): ScenarioPosition => ({ positionId: "eq", label: "GCB", assetClass: "EQUITY", issuer: { key: "company:gcb", name: "GCB" }, instrumentId: "s-gcb", valuation: valueEquityPosition(50_000, eqIn(4.5)), terms: null });

const rule = (id: string, selector: ScenarioShockRule["selector"], shockType: ScenarioShockRule["shockType"], value: number, targetLabel = id): ScenarioShockRule => ({ id, selector, shockType, value, targetLabel });
const billClass = (v: number) => rule("tb", { kind: "ASSET_CLASS", assetClass: "TREASURY_BILL" }, "YIELD_BPS", v, "Treasury bills");
const govClass = (v: number) => rule("gov", { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, "YIELD_BPS", v, "Government bonds");
const corpClass = (v: number) => rule("corp", { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, "YIELD_BPS", v, "Corporate bonds");
const eqClass = (v: number) => rule("eq", { kind: "ASSET_CLASS", assetClass: "EQUITY" }, "PRICE_PCT", v, "Equities");

type Ok = Extract<ScenarioResult, { ok: true }>;
function run(positions: ScenarioPosition[], rules: ScenarioShockRule[]): Ok {
  const r = runScenario({ valuationDate: VAL, positions, rules });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  return r;
}
const part = (r: Ok, id: string): ParticipatingPositionResult => {
  const p = r.positions.find((x) => x.positionId === id);
  if (!p || p.status !== "PARTICIPATING") throw new Error(`${id} not participating`);
  return p;
};
const bill = (r: Ok, id: string) => {
  const p = part(r, id);
  if (p.detail.assetClass !== "TREASURY_BILL") throw new Error("not a bill");
  return { p, detail: p.detail as BillScenarioDetail };
};

// Independent hand calculation (plain arithmetic, no engine code) — 364-day bill, 245 days, 7.569042307…%
const HAND_364: Record<number, { value: number; impact: number }> = {
  100: { value: 945_610.18, impact: -6_040.36 },
  200: { value: 939_646.01, impact: -12_004.53 },
  [-100]: { value: 957_768.56, impact: 6_118.02 },
  [-200]: { value: 963_965.76, impact: 12_315.22 },
};

describe("Treasury-bill shocks — hand-calculated verification", () => {
  it.each([100, 200, -100, -200])("%i bps on the 364-day bill reproduces the independent calculation", (bps) => {
    const r = run([billPosition("a", "2027-06-07", 364, 1_000_000)], [billClass(bps)]);
    const { p, detail } = bill(r, "a");
    expect(p.referenceValueGhs).toBe(951_650.54);
    expect(p.scenarioValueGhs).toBe(HAND_364[bps].value);
    expect(p.impactGhs).toBe(HAND_364[bps].impact);
    expect(detail.scenarioRatePct).toBeCloseTo(7.569042307692308 + bps / 100, 12);
    expect(detail.appliedShockBps).toBe(bps);
    expect(r.portfolio.reconciles).toBe(true);
  });
  it("182- and 91-day bills react per their own days and rate", () => {
    const r = run([billPosition("b182", "2027-01-11", 182, 1_000_000), billPosition("b91", "2026-12-07", 91, 1_000_000)], [billClass(200)]);
    expect(part(r, "b182").impactGhs).toBe(-5_206.24);
    expect(part(r, "b91").impactGhs).toBe(-3_385.38);
  });
  it("zero shock leaves the value unchanged but is still an explicit SHOCKED assumption", () => {
    const r = run([billPosition("a", "2027-06-07", 364, 1_000_000)], [billClass(0)]);
    const { p, detail } = bill(r, "a");
    expect(p.outcome).toBe("SHOCKED");
    expect(p.impactGhs).toBe(0);
    expect(p.scenarioValueGhs).toBe(p.referenceValueGhs);
    expect(detail.scenarioRatePct).toBe(detail.referenceRatePct);
    expect(detail.firstOrderImpactGhs).toBe(0);
  });
  it("no assumption (missing) ≠ zero assumption: the bill is UNCHANGED, not SHOCKED", () => {
    const r = run([billPosition("a", "2027-06-07", 364, 1_000_000)], []);
    expect(part(r, "a")).toMatchObject({ outcome: "UNCHANGED", impactGhs: 0 });
    expect(part(r, "a").resolution.winner).toBeNull();
  });
  it("a rate rise lowers value, a fall raises it, with convexity (down-move gain > up-move loss)", () => {
    const up = part(run([billPosition("a", "2027-06-07", 364, 1_000_000)], [billClass(100)]), "a").impactGhs;
    const down = part(run([billPosition("a", "2027-06-07", 364, 1_000_000)], [billClass(-100)]), "a").impactGhs;
    expect(up).toBeLessThan(0);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(-up);
  });
  it("DV01 × shock is shown only as a first-order estimate, close to but not equal to the exact result", () => {
    const { detail, p } = bill(run([billPosition("a", "2027-06-07", 364, 1_000_000)], [billClass(100)]), "a");
    expect(detail.dv01Ghs).toBeCloseTo(60.7895, 3);
    expect(detail.firstOrderImpactGhs).toBeCloseTo(-6078.95, 2);
    expect(detail.firstOrderErrorGhs).toBeCloseTo(p.impactGhs - detail.firstOrderImpactGhs, 6);
    expect(Math.abs(detail.firstOrderErrorGhs)).toBeLessThan(50);
  });
  it("does NOT use the M7 compounding routine: result equals the simple-interest formula, not annual compounding", () => {
    const { detail } = bill(run([billPosition("a", "2026-12-07", 91, 1_000_000)], [billClass(0)]), "a");
    const simple = 100 / (1 + (detail.referenceRatePct / 100) * (63 / 365));
    const compounded = 100 / Math.pow(1 + detail.referenceRatePct / 100, 63 / 365);
    expect(detail.referencePricePer100).toBeCloseTo(simple, 10);
    expect(Math.abs(detail.referencePricePer100 - compounded)).toBeGreaterThan(1e-5);
  });
  it("a scenario rate that makes the bill price undefined is reported unavailable, never NaN", () => {
    // Unreachable through ±2000 bps for a real bill, so craft an (unrealistic) −150% reference rate to exercise the guard.
    const base = billPosition("a", "2027-06-07", 364, 1_000_000);
    if (base.valuation.status !== "VALUED" || base.valuation.detail.assetClass !== "TREASURY_BILL") throw new Error("setup");
    const crafted: ScenarioPosition = { ...base, valuation: { ...base.valuation, detail: { ...base.valuation.detail, referenceRatePct: -150 } } };
    const r = run([crafted], [billClass(0)]);
    expect(r.positions[0]).toMatchObject({ status: "UNAVAILABLE", code: "INVALID_YIELD_DOMAIN" });
    expect(r.portfolio.scenarioErrorCount).toBe(1);
    expect(r.portfolio.impactGhs).toBeNull();
  });
});

describe("Treasury-bill targeting and precedence (SECURITY > ISSUER > ASSET_CLASS)", () => {
  const bills = () => [billPosition("a", "2027-06-07", 364, 1_000_000), billPosition("b", "2026-12-07", 91, 1_000_000)];
  it("a Treasury-bill asset-class rule reaches only bills, never government bonds", () => {
    const r = run([...bills(), govBond()], [billClass(200)]);
    expect(part(r, "gov").outcome).toBe("UNCHANGED");
    expect(part(r, "a").outcome).toBe("SHOCKED");
  });
  it("a government-bond class rule does not reach bills", () => {
    const r = run([...bills(), govBond()], [govClass(200)]);
    expect(part(r, "a").outcome).toBe("UNCHANGED");
    expect(part(r, "gov").outcome).toBe("SHOCKED");
  });
  it("an issuer rule (Government of Ghana, YIELD_BPS) reaches both its bills and its bonds and beats the asset-class rules", () => {
    const issuer = rule("gog", { kind: "ISSUER", issuerKey: GOV.key }, "YIELD_BPS", 50, "Government of Ghana");
    const r = run([...bills(), govBond()], [billClass(200), govClass(300), issuer]);
    expect(bill(r, "a").detail.appliedShockBps).toBe(50);
    expect(part(r, "gov").resolution.winner!.id).toBe("gog");
    expect(part(r, "a").resolution.precedence).toBe("ISSUER");
    expect(part(r, "a").resolution.matchedRules.map((x) => x.id)).toEqual(["gog", "tb"]);
  });
  it("a specific-bill rule beats issuer and class rules and touches only that bill", () => {
    const specific = rule("one", { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: "bill-a" }, "YIELD_BPS", -25, "364d bill");
    const issuer = rule("gog", { kind: "ISSUER", issuerKey: GOV.key }, "YIELD_BPS", 50, "Government of Ghana");
    const r = run(bills(), [billClass(200), issuer, specific]);
    expect(bill(r, "a").detail.appliedShockBps).toBe(-25);
    expect(part(r, "a").resolution.precedence).toBe("SECURITY");
    expect(bill(r, "b").detail.appliedShockBps).toBe(50);
  });
  it("a bill SECURITY id never matches a bond or equity with the same id string", () => {
    const sameId = rule("x", { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: "b-gov" }, "YIELD_BPS", 100, "x");
    expect(part(run([govBond()], [sameId]), "gov").outcome).toBe("UNCHANGED");
  });
  it("an equity PRICE_PCT shock cannot target a Treasury bill", () => {
    const bad = rule("bad", { kind: "ASSET_CLASS", assetClass: "TREASURY_BILL" }, "PRICE_PCT", -10, "Treasury bills");
    expect(validateRules([bad]).map((e) => e.code)).toContain("INCOMPATIBLE");
    const badSec = rule("bad2", { kind: "SECURITY", instrument: "TREASURY_BILL", instrumentId: "x" }, "PRICE_PCT", -10, "x");
    expect(validateRules([badSec]).map((e) => e.code)).toContain("INCOMPATIBLE");
  });
  it("issuer PRICE_PCT does not reach a bill (the sovereign has no equity)", () => {
    const issuerPrice = rule("gp", { kind: "ISSUER", issuerKey: GOV.key }, "PRICE_PCT", -10, "Government of Ghana");
    expect(part(run(bills(), [issuerPrice]), "a").outcome).toBe("UNCHANGED");
  });
  it("two assumptions on the same bill target are ambiguous and rejected", () => {
    const dup = [billClass(100), { ...billClass(200), id: "tb2" }];
    expect(validateRules(dup).map((e) => e.code)).toContain("DUPLICATE");
  });
  it("out-of-bounds bill shock is rejected, not clamped", () => {
    expect(validateRules([billClass(2500)]).map((e) => e.code)).toContain("OUT_OF_BOUNDS");
  });
});

describe("unvalued / stale bills in scenarios", () => {
  it("an unvalued bill has no baseline: UNAVAILABLE, excluded from totals (never zero)", () => {
    const r = run([billPosition("u", "2027-06-07", 364, 1_000_000, {}, null), govBond()], [billClass(200)]);
    expect(r.positions.find((p) => p.positionId === "u")).toMatchObject({ status: "UNAVAILABLE", code: "UNVALUED_REFERENCE", upstreamCode: "NO_REFERENCE_RATE" });
    expect(r.portfolio.unvaluedCount).toBe(1);
    expect(r.portfolio.participatingCount).toBe(1);
  });
  it("a matured bill is unavailable with the MATURED upstream code", () => {
    const r = run([billPosition("m", "2026-10-05", 91, 1_000_000)], [billClass(200)]);
    expect(r.positions[0]).toMatchObject({ status: "UNAVAILABLE", upstreamCode: "MATURED" });
  });
  it("stale-input propagation: a stale auction curve makes the bill's scenario basis stale", () => {
    const stale = selectLatestCompleteCurve([{ ...row(91, 4.6785), observationDate: "2026-08-10" }, { ...row(182, 6.37), observationDate: "2026-08-10" }, { ...row(364, 9.8339), observationDate: "2026-08-10" }], "2026-10-05");
    const r = run([billPosition("s", "2027-06-07", 364, 1_000_000, {}, stale), govBond()], [billClass(200)]);
    expect(part(r, "s").recency).toBe("STALE");
    expect(r.portfolio.staleBasis.count).toBe(1);
    expect(r.portfolio.staleBasisPct).toBeGreaterThan(0);
    expect(r.explanations.join(" ")).toMatch(/stale market inputs/);
  });
});

describe("mixed portfolio — T-bill + government bond + corporate bond + equity reconcile exactly", () => {
  const all = () => [billPosition("tb", "2027-06-07", 364, 1_000_000), govBond(), corpBond(), equity()];
  const rules = () => [billClass(200), govClass(200), corpClass(300), eqClass(-10)];
  const r = run(all(), rules());

  it("each instrument reacts according to its own domain", () => {
    expect(part(r, "tb").impactGhs).toBe(-12_004.53);
    expect(part(r, "gov").impactGhs).toBeLessThan(0);
    expect(part(r, "corp").impactGhs).toBeLessThan(0);
    expect(part(r, "eq").impactGhs).toBeCloseTo(-22_500, 2); // 50,000 × 4.50 × −10%
    expect(part(r, "eq").detail.assetClass).toBe("EQUITY");
    expect(part(r, "gov").detail.assetClass).toBe("BOND");
    expect(part(r, "tb").detail.assetClass).toBe("TREASURY_BILL");
  });
  it("position impacts, class impacts and the portfolio impact reconcile to the pesewa", () => {
    const cents = (n: number) => Math.round(n * 100);
    const positionSum = r.positions.reduce((s, p) => (p.status === "PARTICIPATING" ? s + cents(p.impactGhs) : s), 0);
    const classSum = r.portfolio.byAssetClass.reduce((s, c) => s + cents(c.impactGhs), 0);
    expect(positionSum).toBe(cents(r.portfolio.impactGhs!));
    expect(classSum).toBe(cents(r.portfolio.impactGhs!));
    expect(r.portfolio.reconciles).toBe(true);
    expect(r.portfolio.byAssetClass.map((c) => c.assetClass)).toEqual(["TREASURY_BILL", "GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"]);
    expect(r.portfolio.byAssetClass[0]).toMatchObject({ participatingCount: 1, impactGhs: -12_004.53 });
  });
  it("aggregation: scenario value = reference value + impact, in cents", () => {
    expect(Math.round(r.portfolio.scenarioValueGhs! * 100)).toBe(Math.round(r.portfolio.referenceBasisGhs! * 100) + Math.round(r.portfolio.impactGhs! * 100));
  });
  it("explanations describe the bill assumption as a rate, not a price", () => {
    expect(r.explanations[0]).toBe("Treasury-bill rates were increased by 200 bps.");
  });
  it("the same result is produced twice (deterministic)", () => {
    expect(run(all(), rules()).portfolio.impactGhs).toBe(r.portfolio.impactGhs);
  });
});

describe("unavailable-code type guard", () => {
  it("the Unvalued type is unchanged for non-bill upstream codes", () => {
    const u: Unvalued = { available: false, code: "NO_OBSERVATION", reason: "x" };
    expect(u.code).toBe("NO_OBSERVATION");
  });
});
