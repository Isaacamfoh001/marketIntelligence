import { describe, expect, it } from "vitest";
import { computeDuration, priceFromYield, type BondTerms } from "../../fixed-income";
import { valueBondPosition, valueEquityPosition, type BondValuationInput, type EquityValuationInput, type Unvalued } from "../../portfolio";
import { runScenario, type ScenarioInput, type ScenarioPosition, type ScenarioShockRule, type ParticipatingPositionResult, type ScenarioResult } from "..";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VAL = d("2026-10-05");
const TERMS_GOV_LONG: BondTerms = { issueDate: d("2024-07-01"), maturityDate: d("2034-07-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const TERMS_GOV_SHORT: BondTerms = { issueDate: d("2023-01-01"), maturityDate: d("2028-01-01"), couponType: "FIXED", couponRatePct: 15, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const TERMS_CORP: BondTerms = { issueDate: d("2025-09-01"), maturityDate: d("2028-09-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };

const bondIn = (ytm: number, over: Partial<BondValuationInput> = {}): BondValuationInput => ({ available: true, assetClass: "BOND", observedYtmPct: ytm, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: null, yieldFromSourceQuote: false, pendingReview: null, ...over });
const eqIn = (price: number, over: Partial<EquityValuationInput> = {}): EquityValuationInput => ({ available: true, assetClass: "EQUITY", priceGhs: price, priceDate: "2026-10-03", ageDays: 2, recency: "RECENT", volume: 1000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-03", skippedNoTradeRows: 0, ...over });
const UNV: Unvalued = { available: false, code: "NO_OBSERVATION", reason: "No usable observation." };

const GOV = { key: "name:government of ghana", name: "Government of Ghana" };
const KASA = { key: "company:kasa", name: "Kasapreko" };
const GCB = { key: "company:gcb", name: "GCB" };

const govLong = (over: Partial<ScenarioPosition> = {}, ytm = 28.0073, nominal = 2_000_000, input: BondValuationInput | Unvalued = bondIn(ytm)): ScenarioPosition => ({ positionId: "p-govlong", label: "GoG Jul-34", assetClass: "GOVERNMENT_BOND", issuer: GOV, instrumentId: "b-govlong", valuation: valueBondPosition(nominal, TERMS_GOV_LONG, input, VAL), terms: TERMS_GOV_LONG, ...over });
const govShort = (over: Partial<ScenarioPosition> = {}): ScenarioPosition => ({ positionId: "p-govshort", label: "GoG Jan-28", assetClass: "GOVERNMENT_BOND", issuer: GOV, instrumentId: "b-govshort", valuation: valueBondPosition(2_000_000, TERMS_GOV_SHORT, bondIn(24), VAL), terms: TERMS_GOV_SHORT, ...over });
const corp = (over: Partial<ScenarioPosition> = {}): ScenarioPosition => ({ positionId: "p-corp", label: "Kasapreko Sep-28", assetClass: "CORPORATE_BOND", issuer: KASA, instrumentId: "b-corp", valuation: valueBondPosition(1_000_000, TERMS_CORP, bondIn(26, { recency: "STALE", ageDays: 20 }), VAL), terms: TERMS_CORP, ...over });
const kasa = (over: Partial<ScenarioPosition> = {}): ScenarioPosition => ({ positionId: "p-kasa", label: "KASA", assetClass: "EQUITY", issuer: KASA, instrumentId: "s-kasa", valuation: valueEquityPosition(100_000, eqIn(10)), terms: null, ...over });
const gcb = (over: Partial<ScenarioPosition> = {}): ScenarioPosition => ({ positionId: "p-gcb", label: "GCB", assetClass: "EQUITY", issuer: GCB, instrumentId: "s-gcb", valuation: valueEquityPosition(50_000, eqIn(4.5)), terms: null, ...over });

const rule = (id: string, selector: ScenarioShockRule["selector"], shockType: ScenarioShockRule["shockType"], value: number, targetLabel = id): ScenarioShockRule => ({ id, selector, shockType, value, targetLabel });
const govClass = (v: number) => rule("gov", { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, "YIELD_BPS", v, "Government bonds");
const corpClass = (v: number) => rule("corp", { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, "YIELD_BPS", v, "Corporate bonds");
const eqClass = (v: number) => rule("eq", { kind: "ASSET_CLASS", assetClass: "EQUITY" }, "PRICE_PCT", v, "Equities");

function run(positions: ScenarioPosition[], rules: ScenarioShockRule[]): Extract<ScenarioResult, { ok: true }> {
  const r = runScenario({ valuationDate: VAL, positions, rules } satisfies ScenarioInput);
  if (!r.ok) throw new Error(`validation failed: ${r.errors.map((e) => e.message).join("; ")}`);
  return r;
}
const part = (r: Extract<ScenarioResult, { ok: true }>, id: string) => {
  const p = r.positions.find((x) => x.positionId === id);
  if (!p || p.status !== "PARTICIPATING") throw new Error(`${id} not participating`);
  return p;
};
const ALL = () => [govLong(), govShort(), corp(), kasa(), gcb()];

describe("zero-shock invariant", () => {
  it("an explicit 0 shock reproduces reference price, value and impact for every position", () => {
    const r = run(ALL(), [govClass(0), corpClass(0), eqClass(0)]);
    for (const p of r.positions) {
      if (p.status !== "PARTICIPATING") throw new Error("expected participating");
      expect(p.outcome).toBe("SHOCKED");
      expect(p.scenarioValueGhs).toBe(p.referenceValueGhs);
      expect(p.impactGhs).toBe(0);
      expect(p.impactPct).toBe(0);
      if (p.detail.assetClass === "BOND") {
        expect(p.detail.scenarioDirtyPrice).toBeCloseTo(p.detail.referenceDirtyPrice, 12);
        expect(p.detail.scenarioYieldPct).toBe(p.detail.referenceYieldPct);
      } else if (p.detail.assetClass === "EQUITY") expect(p.detail.scenarioPriceGhs).toBe(p.detail.referencePriceGhs);
    }
    expect(r.portfolio.impactGhs).toBe(0);
    expect(r.portfolio.scenarioValueGhs).toBe(r.portfolio.referenceBasisGhs);
  });

  it("no rules at all leaves every position unchanged (not unavailable)", () => {
    const r = run(ALL(), []);
    expect(r.portfolio.impactGhs).toBe(0);
    expect(r.portfolio.shockedPositionCount).toBe(0);
    expect(r.portfolio.unchangedPositionCount).toBe(5);
    expect(r.positions.every((p) => p.status === "PARTICIPATING" && p.outcome === "UNCHANGED" && p.resolution.winner === null)).toBe(true);
  });

  it("reference basis equals the M8.1 valued reference value", () => {
    const r = run(ALL(), [govClass(200)]);
    expect(r.portfolio.referenceBasisGhs).toBe(r.portfolio.m81ValuedReferenceValueGhs);
  });
});

describe("bond repricing (full M7 repricing, dirty-price basis)", () => {
  it("scenario price comes from priceFromYield at y0 + bps/100, not from DV01", () => {
    const r = run([govLong()], [govClass(200)]);
    const p = part(r, "p-govlong");
    if (p.detail.assetClass !== "BOND") throw new Error();
    const y1 = 28.0073 + 2;
    expect(p.detail.scenarioYieldPct).toBeCloseTo(y1, 10);
    const dirty = (priceFromYield(TERMS_GOV_LONG, VAL, y1) as { dirtyPrice: number }).dirtyPrice;
    expect(p.detail.scenarioDirtyPrice).toBe(dirty);
    expect(p.scenarioValueGhs).toBeCloseTo((2_000_000 * dirty) / 100, 2);
    expect(p.impactGhs).toBeCloseTo(p.scenarioValueGhs - p.referenceValueGhs, 2);
    // DV01 estimate is secondary and differs from exact repricing (convexity).
    const dv01 = (computeDuration(TERMS_GOV_LONG, VAL, 28.0073) as { dv01: number }).dv01 * 20000;
    expect(p.detail.dv01Ghs).toBeCloseTo(dv01, 8);
    expect(p.detail.firstOrderImpactGhs).toBeCloseTo(-dv01 * 200, 6);
    expect(p.detail.firstOrderImpactGhs).not.toBe(p.impactGhs);
    expect(p.detail.firstOrderErrorGhs).toBeCloseTo(p.impactGhs - (p.detail.firstOrderImpactGhs as number), 6);
    // Convexity: the exact fall is smaller in magnitude than the linear estimate for a rise in yield.
    expect(Math.abs(p.impactGhs)).toBeLessThan(Math.abs(p.detail.firstOrderImpactGhs as number));
  });

  it("direction: +yield lowers price/value, −yield raises it", () => {
    for (const pos of [govLong(), govShort(), corp()]) {
      const up = part(run([pos], [govClass(150), corpClass(150)]), pos.positionId);
      const dn = part(run([pos], [govClass(-150), corpClass(-150)]), pos.positionId);
      if (up.detail.assetClass !== "BOND" || dn.detail.assetClass !== "BOND") throw new Error();
      expect(up.detail.scenarioDirtyPrice).toBeLessThan(up.detail.referenceDirtyPrice);
      expect(up.impactGhs).toBeLessThan(0);
      expect(dn.detail.scenarioDirtyPrice).toBeGreaterThan(dn.detail.referenceDirtyPrice);
      expect(dn.impactGhs).toBeGreaterThan(0);
    }
  });

  it("accrued interest and valuation date are unchanged by a yield shock; clean moves, not accrued", () => {
    const p = part(run([govLong()], [govClass(300)]), "p-govlong");
    if (p.detail.assetClass !== "BOND") throw new Error();
    expect(p.detail.accruedInterest).toBeGreaterThan(0);
    expect(p.detail.scenarioCleanPrice + p.detail.accruedInterest).toBeCloseTo(p.detail.scenarioDirtyPrice, 12);
    expect(p.detail.referenceCleanPrice + p.detail.accruedInterest).toBeCloseTo(p.detail.referenceDirtyPrice, 12);
  });

  it("near maturity, maturity today and matured are handled by the engine/upstream — never NaN", () => {
    const near: BondTerms = { ...TERMS_GOV_SHORT, issueDate: d("2025-10-10"), maturityDate: d("2026-10-10") };
    const pos: ScenarioPosition = { ...govShort(), valuation: valueBondPosition(1_000_000, near, bondIn(24), VAL), terms: near };
    const p = part(run([pos], [govClass(500)]), "p-govshort");
    expect(Number.isFinite(p.scenarioValueGhs)).toBe(true);
    expect(p.impactGhs).toBeLessThan(0);
    const today: BondTerms = { ...near, maturityDate: VAL };
    const m = run([{ ...govShort(), valuation: valueBondPosition(1_000_000, today, bondIn(24), VAL), terms: today }], [govClass(100)]);
    expect(m.positions[0]).toMatchObject({ status: "UNAVAILABLE", code: "UNVALUED_REFERENCE" });
  });

  it("an invalid yield domain yields a deterministic unavailable result, not NaN/Infinity/crash", () => {
    const zero: BondTerms = { issueDate: d("2026-01-01"), maturityDate: d("2028-01-01"), couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null, faceValue: 100 };
    // y0 = -95% is itself contrived; −1000 bps → −105%: (1 + y) < 0 for a fractional exponent.
    const pos: ScenarioPosition = { ...govLong(), valuation: valueBondPosition(1_000_000, zero, bondIn(-95), VAL), terms: zero };
    const r = run([pos], [govClass(-1000)]);
    expect(r.positions[0]).toMatchObject({ status: "UNAVAILABLE", code: "INVALID_YIELD_DOMAIN" });
    expect(r.portfolio.scenarioErrorCount).toBe(1);
    expect(r.portfolio.participatingCount).toBe(0);
    expect(r.portfolio.referenceBasisGhs).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it("allows a mathematically valid NEGATIVE scenario yield with a warning (no clamp to zero)", () => {
    const p = part(run([govShort()], [govClass(-2000)]), "p-govshort");
    // 24% − 20pp = 4% (positive); push lower with a low-yield bond:
    expect(p.detail.assetClass === "BOND" && p.detail.scenarioYieldPct).toBeCloseTo(4, 10);
    const lowPos: ScenarioPosition = { ...govShort(), valuation: valueBondPosition(2_000_000, TERMS_GOV_SHORT, bondIn(10), VAL) };
    const low = part(run([lowPos], [govClass(-2000)]), "p-govshort");
    if (low.detail.assetClass !== "BOND") throw new Error();
    expect(low.detail.scenarioYieldPct).toBeCloseTo(-10, 10);
    expect(low.warnings.join(" ")).toMatch(/negative/);
    expect(low.scenarioValueGhs).toBeGreaterThan(low.referenceValueGhs);
  });
});

describe("equity repricing", () => {
  it("+10% → ×1.10, −10% → ×0.90, −100% → 0, +1000% allowed", () => {
    const base = 100_000 * 10;
    expect(part(run([kasa()], [eqClass(10)]), "p-kasa").scenarioValueGhs).toBeCloseTo(base * 1.1, 2);
    expect(part(run([kasa()], [eqClass(-10)]), "p-kasa").scenarioValueGhs).toBeCloseTo(base * 0.9, 2);
    const wipe = part(run([kasa()], [eqClass(-100)]), "p-kasa");
    expect(wipe.scenarioValueGhs).toBe(0);
    expect(wipe.impactGhs).toBe(-base);
    expect(wipe.impactPct).toBe(-100);
    expect(part(run([kasa()], [eqClass(1000)]), "p-kasa").scenarioValueGhs).toBeCloseTo(base * 11, 2);
  });

  it("uses the M8.1 reference price (no other price source)", () => {
    const p = part(run([gcb()], [eqClass(-10)]), "p-gcb");
    expect(p.detail).toMatchObject({ assetClass: "EQUITY", referencePriceGhs: 4.5, scenarioPriceGhs: 4.05, shares: 50_000 });
  });
});

describe("shock precedence and resolution", () => {
  const issuerGov = rule("issuer-gov", { kind: "ISSUER", issuerKey: GOV.key }, "YIELD_BPS", 250, "Government of Ghana");
  const secLong = rule("sec-long", { kind: "SECURITY", instrument: "BOND", instrumentId: "b-govlong" }, "YIELD_BPS", 400, "GoG Jul-34");

  it("security > issuer > asset class, with no stacking", () => {
    const r = run([govLong(), govShort()], [govClass(200), issuerGov, secLong]);
    const long = part(r, "p-govlong");
    const short = part(r, "p-govshort");
    expect(long.resolution.winner?.id).toBe("sec-long");
    expect(long.resolution.precedence).toBe("SECURITY");
    expect(long.resolution.matchedRules.map((m) => m.id)).toEqual(["sec-long", "issuer-gov", "gov"]);
    expect(long.detail.assetClass === "BOND" && long.detail.appliedShockBps).toBe(400);
    expect(short.resolution.winner?.id).toBe("issuer-gov");
    expect(short.detail.assetClass === "BOND" && short.detail.appliedShockBps).toBe(250);
    // The result equals a scenario with ONLY the winning rule — i.e. nothing else leaked in.
    const only = run([govLong()], [secLong]);
    expect(long.scenarioValueGhs).toBe(part(only, "p-govlong").scenarioValueGhs);
  });

  it("another government issuer falls back to the asset-class rule", () => {
    const other = govShort({ issuer: { key: "name:other sovereign", name: "Other" } });
    const r = run([other], [govClass(200), issuerGov]);
    expect(part(r, "p-govshort").resolution.winner?.id).toBe("gov");
    expect(part(r, "p-govshort").resolution.precedence).toBe("ASSET_CLASS");
  });

  it("an explicit 0 at a higher level overrides a non-zero wider rule", () => {
    const zeroSec = rule("sec-zero", { kind: "SECURITY", instrument: "BOND", instrumentId: "b-govlong" }, "YIELD_BPS", 0, "GoG Jul-34");
    const p = part(run([govLong()], [govClass(500), zeroSec]), "p-govlong");
    expect(p.impactGhs).toBe(0);
    expect(p.outcome).toBe("SHOCKED");
  });

  it("issuer cross-asset safety: a bond-yield issuer shock never touches the issuer's equity, and vice versa", () => {
    const kasaBonds = rule("kasa-bonds", { kind: "ISSUER", issuerKey: KASA.key }, "YIELD_BPS", 500, "Kasapreko");
    const r1 = run([corp(), kasa()], [kasaBonds]);
    expect(part(r1, "p-corp").resolution.winner?.id).toBe("kasa-bonds");
    expect(part(r1, "p-kasa").outcome).toBe("UNCHANGED");
    const kasaEq = rule("kasa-eq", { kind: "ISSUER", issuerKey: KASA.key }, "PRICE_PCT", -20, "Kasapreko");
    const r2 = run([corp(), kasa()], [kasaEq]);
    expect(part(r2, "p-corp").outcome).toBe("UNCHANGED");
    expect(part(r2, "p-kasa").resolution.winner?.id).toBe("kasa-eq");
    // Both together: each applies only to its own domain, no stacking.
    const r3 = run([corp(), kasa()], [kasaBonds, kasaEq]);
    expect(part(r3, "p-corp").resolution.matchedRules).toHaveLength(1);
    expect(part(r3, "p-kasa").resolution.matchedRules).toHaveLength(1);
  });

  it("a security selector for a bond id never matches an equity with the same id string", () => {
    const clash = rule("clash", { kind: "SECURITY", instrument: "BOND", instrumentId: "same" }, "YIELD_BPS", 100, "x");
    const eqSame = kasa({ instrumentId: "same" });
    expect(part(run([eqSame], [clash]), "p-kasa").outcome).toBe("UNCHANGED");
  });

  it("only a government shock leaves equities and corporates unchanged", () => {
    const r = run(ALL(), [govClass(200)]);
    expect(r.portfolio.shockedPositionCount).toBe(2);
    expect(part(r, "p-corp").impactGhs).toBe(0);
    expect(part(r, "p-kasa").impactGhs).toBe(0);
  });
});

describe("validation of scenario definitions", () => {
  const bad = (rules: ScenarioShockRule[]) => {
    const r = runScenario({ valuationDate: VAL, positions: ALL(), rules });
    if (r.ok) throw new Error("expected rejection");
    return r.errors;
  };
  it("rejects incompatible shock types explicitly", () => {
    expect(bad([rule("a", { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, "PRICE_PCT", -5)])[0].code).toBe("INCOMPATIBLE");
    expect(bad([rule("a", { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, "PRICE_PCT", -5)])[0].code).toBe("INCOMPATIBLE");
    expect(bad([rule("a", { kind: "ASSET_CLASS", assetClass: "EQUITY" }, "YIELD_BPS", 50)])[0].code).toBe("INCOMPATIBLE");
    expect(bad([rule("a", { kind: "SECURITY", instrument: "EQUITY", instrumentId: "s" }, "YIELD_BPS", 50)])[0].code).toBe("INCOMPATIBLE");
    expect(bad([rule("a", { kind: "SECURITY", instrument: "BOND", instrumentId: "b" }, "PRICE_PCT", 5)])[0].code).toBe("INCOMPATIBLE");
  });
  it("rejects equity shocks below −100% and out-of-bound yield shocks — never clamps", () => {
    expect(bad([eqClass(-100.01)])[0].code).toBe("OUT_OF_BOUNDS");
    expect(bad([eqClass(1000.01)])[0].code).toBe("OUT_OF_BOUNDS");
    expect(bad([govClass(2000.01)])[0].code).toBe("OUT_OF_BOUNDS");
    expect(bad([govClass(-2001)])[0].code).toBe("OUT_OF_BOUNDS");
    expect(bad([govClass(Number.NaN)])[0].code).toBe("BAD_VALUE");
    expect(bad([govClass(Number.POSITIVE_INFINITY)])[0].code).toBe("BAD_VALUE");
    expect(() => run(ALL(), [govClass(2000), corpClass(-2000), eqClass(-100)])).not.toThrow();
  });
  it("rejects ambiguous same-level duplicates instead of choosing one", () => {
    const e1 = bad([govClass(100), { ...govClass(300), id: "gov2" }]);
    expect(e1.map((e) => e.code)).toEqual(["DUPLICATE"]);
    const s = (id: string, v: number) => rule(id, { kind: "SECURITY", instrument: "BOND", instrumentId: "b-govlong" }, "YIELD_BPS", v);
    expect(bad([s("s1", 1), s("s2", 2)])[0].code).toBe("DUPLICATE");
    const i = (id: string, v: number) => rule(id, { kind: "ISSUER", issuerKey: KASA.key }, "PRICE_PCT", v);
    expect(bad([i("i1", 1), i("i2", 2)])[0].code).toBe("DUPLICATE");
  });
  it("allows an issuer bond shock and an issuer equity shock for the same issuer (different domains)", () => {
    const r = run(ALL(), [rule("ib", { kind: "ISSUER", issuerKey: KASA.key }, "YIELD_BPS", 10), rule("ie", { kind: "ISSUER", issuerKey: KASA.key }, "PRICE_PCT", -5)]);
    expect(r.ok).toBe(true);
  });
});

describe("unvalued, stale and unavailable semantics", () => {
  it("an unvalued position gets no scenario value or P/L and is listed with the M8.1 reason", () => {
    const r = run([govLong({}, 0, 1, UNV), govShort()], [govClass(200)]);
    const u = r.positions[0];
    expect(u).toMatchObject({ status: "UNAVAILABLE", code: "UNVALUED_REFERENCE", upstreamCode: "NO_OBSERVATION", reason: "No usable observation." });
    expect("scenarioValueGhs" in u).toBe(false);
    expect("impactGhs" in u).toBe(false);
    expect(r.portfolio).toMatchObject({ unvaluedCount: 1, valuedCount: 1, participatingCount: 1 });
  });

  it("all unvalued / empty portfolio: no basis, null (not zero) totals and percentages", () => {
    for (const positions of [[] as ScenarioPosition[], [govLong({}, 0, 1, UNV)]]) {
      const r = run(positions, [govClass(200)]);
      expect(r.portfolio.referenceBasisGhs).toBeNull();
      expect(r.portfolio.scenarioValueGhs).toBeNull();
      expect(r.portfolio.impactGhs).toBeNull();
      expect(r.portfolio.impactPct).toBeNull();
      expect(r.portfolio.staleBasisPct).toBeNull();
      expect(r.portfolio.reconciles).toBe(true);
    }
  });

  it("a stale valued position participates and stays marked stale; stale basis is tracked", () => {
    const r = run(ALL(), [govClass(200), corpClass(300)]);
    const c = part(r, "p-corp");
    expect(c.recency).toBe("STALE");
    expect(c.inputAgeDays).toBe(20);
    expect(r.portfolio.staleBasis.count).toBe(1);
    expect(r.portfolio.staleBasis.referenceValueGhs).toBe(c.referenceValueGhs);
    expect(r.portfolio.staleBasis.impactGhs).toBe(c.impactGhs);
    expect(r.portfolio.recentBasis.count).toBe(4);
    expect(r.portfolio.staleBasisPct).toBeCloseTo((c.referenceValueGhs / (r.portfolio.referenceBasisGhs as number)) * 100, 8);
    expect(r.explanations.join(" ")).toMatch(/stale market inputs/);
  });

  it("an equity with no price stays unavailable (no invented baseline)", () => {
    const r = run([kasa({ valuation: valueEquityPosition(100, UNV) })], [eqClass(-10)]);
    expect(r.positions[0]).toMatchObject({ status: "UNAVAILABLE", code: "UNVALUED_REFERENCE" });
  });
});

describe("portfolio aggregation and contributions", () => {
  const rules = [govClass(200), corpClass(300), eqClass(-10)];
  it("Σ position impacts == Σ class impacts == portfolio impact, exactly (cents)", () => {
    const r = run(ALL(), rules);
    const cents = (n: number) => Math.round(n * 100);
    const parts = r.positions.filter((p): p is ParticipatingPositionResult => p.status === "PARTICIPATING");
    const posSum = parts.reduce((s, p) => s + cents(p.impactGhs), 0);
    const classSum = r.portfolio.byAssetClass.reduce((s, c) => s + cents(c.impactGhs), 0);
    expect(posSum).toBe(cents(r.portfolio.impactGhs as number));
    expect(classSum).toBe(cents(r.portfolio.impactGhs as number));
    expect(cents(r.portfolio.scenarioValueGhs as number) - cents(r.portfolio.referenceBasisGhs as number)).toBe(cents(r.portfolio.impactGhs as number));
    expect(r.portfolio.reconciles).toBe(true);
    expect(r.portfolio.impactGhs).toBeLessThan(0);
  });

  it("basis = Σ participating reference values; percentages use the stated denominators", () => {
    const r = run([...ALL(), govLong({ positionId: "p-unv", instrumentId: "b-unv", label: "Unv" }, 0, 1, UNV)], rules);
    const parts = r.positions.filter((p): p is ParticipatingPositionResult => p.status === "PARTICIPATING");
    const basis = parts.reduce((s, p) => s + Math.round(p.referenceValueGhs * 100), 0) / 100;
    expect(r.portfolio.referenceBasisGhs).toBe(basis);
    for (const p of parts) {
      expect(p.impactPct).toBeCloseTo((p.impactGhs / p.referenceValueGhs) * 100, 8);
      expect(p.contributionPct).toBeCloseTo((p.impactGhs / basis) * 100, 8);
    }
    expect(r.portfolio.impactPct).toBeCloseTo(parts.reduce((s, p) => s + (p.contributionPct as number), 0), 6);
    expect(r.portfolio).toMatchObject({ positionCount: 6, valuedCount: 5, participatingCount: 5, unvaluedCount: 1, shockedPositionCount: 5 });
  });

  it("class rows exist for all three classes and equity-only / bond-only portfolios work", () => {
    const eqOnly = run([kasa(), gcb()], rules);
    expect(eqOnly.portfolio.byAssetClass.map((c) => c.assetClass)).toEqual(["TREASURY_BILL", "GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"]);
    expect(eqOnly.portfolio.byAssetClass[1]).toMatchObject({ participatingCount: 0, impactGhs: 0, impactPct: null });
    expect(eqOnly.portfolio.impactPct).toBeCloseTo(-10, 8);
    const bondOnly = run([govLong(), corp()], rules);
    expect(bondOnly.portfolio.byAssetClass[3]).toMatchObject({ participatingCount: 0, referenceValueGhs: 0 });
  });

  it("largest contributors are ordered, exclude zero impacts, and carry no 'winner/loser' vocabulary", () => {
    const r = run(ALL(), [govClass(200), eqClass(0)]);
    const neg = r.portfolio.largestNegative;
    expect(neg.map((p) => p.positionId)).toEqual([...neg].sort((a, b) => a.impactGhs - b.impactGhs).map((p) => p.positionId));
    expect(neg.every((p) => p.impactGhs < 0)).toBe(true);
    expect(r.portfolio.largestPositive).toEqual([]);
    const up = run(ALL(), [govClass(-200), eqClass(0)]);
    expect(up.portfolio.largestNegative).toEqual([]);
    expect(up.portfolio.largestPositive.length).toBe(2);
  });

  it("ties on impact are ordered deterministically by label", () => {
    const a = kasa({ positionId: "pa", label: "AAA", instrumentId: "sa" });
    const b = kasa({ positionId: "pb", label: "BBB", instrumentId: "sb" });
    const r = run([b, a], [eqClass(-10)]);
    expect(r.portfolio.largestNegative.map((p) => p.label)).toEqual(["AAA", "BBB"]);
  });

  it("is deterministic: identical input gives identical output", () => {
    expect(JSON.stringify(run(ALL(), rules))).toBe(JSON.stringify(run(ALL(), rules)));
  });
});

describe("explanations", () => {
  it("are factual, include overrides, and avoid forecast vocabulary", () => {
    const r = run(ALL(), [govClass(200), rule("sec", { kind: "SECURITY", instrument: "BOND", instrumentId: "b-govlong" }, "YIELD_BPS", 400, "GoG Jul-34"), corpClass(300), eqClass(-10)]);
    const text = r.explanations.join("\n");
    expect(text).toContain("Government bond yields were increased by 200 bps.");
    expect(text).toContain("GoG Jul-34 used the security-specific +400bps assumption instead of Government bonds +200bps.");
    expect(text).toMatch(/account for GHS/);
    expect(text.toLowerCase()).not.toMatch(/predict|forecast|expected|likely|projected|winner|loser|best|worst|recommend/);
  });
});
