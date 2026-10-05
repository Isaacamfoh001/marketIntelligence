import { describe, expect, it } from "vitest";
import {
  ASSUMPTION_KINDS_BY_CLASS,
  assumptionAvailability,
  resolveValuation,
  summarizePortfolio,
  validateAssumption,
  valueBillPosition,
  valueBillWithAssumption,
  valueBondPosition,
  valueBondWithAssumption,
  valueEquityPosition,
  valueEquityWithAssumption,
  valueTerms,
  type BillValuationInput,
  type BondValuationInput,
  type EquityValuationInput,
  type PositionValuation,
  type StoredAssumption,
  type Unvalued,
  type UnvaluedCode,
  type ValuedPosition,
} from "..";
import { computeAccruedInterest, priceFromYield, type BondTerms } from "../../fixed-income";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VAL = d("2026-10-05");
const TERMS: BondTerms = { issueDate: d("2024-03-01"), maturityDate: d("2028-03-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const accrued = (computeAccruedInterest(TERMS, VAL) as { accruedInterest: number }).accruedInterest;

const bondIn = (ytm = 22, over: Partial<BondValuationInput> = {}): BondValuationInput => ({ available: true, assetClass: "BOND", observedYtmPct: ytm, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: 97, yieldFromSourceQuote: false, pendingReview: null, ...over });
const eqIn = (price = 10, over: Partial<EquityValuationInput> = {}): EquityValuationInput => ({ available: true, assetClass: "EQUITY", priceGhs: price, priceDate: "2026-10-03", ageDays: 2, recency: "RECENT", volume: 1000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-03", skippedNoTradeRows: 0, ...over });
const billIn = (rate = 20, days = 182, over: Partial<BillValuationInput> = {}): BillValuationInput => ({ available: true, assetClass: "TREASURY_BILL", referenceRatePct: rate, observationDate: "2026-10-02", ageDays: 3, recency: "RECENT", daysToMaturity: days, method: "EXACT_TENOR", nodes: [], methodDescription: "test", ...over });
const unv = (code: UnvaluedCode = "NO_OBSERVATION"): Unvalued => ({ available: false, code, reason: `reason ${code}` });
const valued = (p: PositionValuation): ValuedPosition => {
  if (p.status !== "VALUED") throw new Error(`expected valued, got ${p.code}: ${p.reason}`);
  return p;
};
const A = (kind: StoredAssumption["kind"], value: number | null, overridesReference = false): StoredAssumption => ({ kind, value, overridesReference });

describe("valuation basis taxonomy", () => {
  it("a Korbly bond/equity value is REFERENCE; a bill is INDICATIVE; an assumption is ANALYST_ASSUMPTION; none is UNVALUED", () => {
    expect(valued(valueBondPosition(1e6, TERMS, bondIn(), VAL)).basis).toBe("REFERENCE");
    expect(valued(valueEquityPosition(100, eqIn())).basis).toBe("REFERENCE");
    expect(valued(valueBillPosition(1e6, billIn(), VAL)).basis).toBe("INDICATIVE");
    expect(valued(valueBondWithAssumption(1e6, TERMS, A("YIELD_PCT", 28), VAL)).basis).toBe("ANALYST_ASSUMPTION");
    expect(valueBondPosition(1e6, TERMS, unv(), VAL).status).toBe("UNVALUED");
  });

  it("recency is evidence-based: an assumption is NOT_APPLICABLE, never 'recent' (valuation basis ≠ data quality)", () => {
    const a = valued(valueBondWithAssumption(1e6, TERMS, A("YIELD_PCT", 28), VAL));
    expect(a.recency).toBe("NOT_APPLICABLE");
    expect(a.assumption?.provenance).toBe("Analyst assumption");
    // a stale OBSERVED yield is still a Reference value, labelled stale
    const stale = valued(valueBondPosition(1e6, TERMS, bondIn(22, { recency: "STALE", ageDays: 90 }), VAL));
    expect([stale.basis, stale.recency]).toEqual(["REFERENCE", "STALE"]);
  });
});

describe("bond assumptions reuse the M7 engine", () => {
  it("assumed yield → same value as an observed yield of that size (no second pricing implementation)", () => {
    const assumed = valued(valueBondWithAssumption(2_000_000, TERMS, A("YIELD_PCT", 28), VAL));
    const observed = valued(valueBondPosition(2_000_000, TERMS, bondIn(28), VAL));
    expect(assumed.referenceValueGhs).toBe(observed.referenceValueGhs);
    const dirty = (priceFromYield(TERMS, VAL, 28) as { dirtyPrice: number }).dirtyPrice;
    expect(assumed.detail).toMatchObject({ observedYtmPct: 28, referenceDirtyPrice: dirty, yieldIsAssumed: true, observedCleanPrice: null, observationDate: "2026-10-05", ageDays: 0 });
  });

  it("assumed clean price: dirty = clean + accrued, value = nominal × dirty / face, implied yield recovered by M7", () => {
    const p = valued(valueBondWithAssumption(2_000_000, TERMS, A("PRICE_PER_100", 85), VAL));
    expect(p.referenceValueGhs).toBe(Math.round((2_000_000 * (85 + accrued)) / 100 * 100) / 100);
    const detail = p.detail as { observedYtmPct: number; referenceCleanPrice: number };
    expect(detail.referenceCleanPrice).toBeCloseTo(85, 9);
    expect((priceFromYield(TERMS, VAL, detail.observedYtmPct) as { dirtyPrice: number }).dirtyPrice).toBeCloseTo(85 + accrued, 6);
    expect(detail.observedYtmPct).toBeGreaterThan(20); // a discount bond yields more than its coupon
  });

  it("par is an EXPLICIT assumption: clean price = face, accrued added, stored value null, labelled as an assumption", () => {
    const p = valued(valueBondWithAssumption(1_000_000, TERMS, A("PAR", null), VAL));
    expect(p.referenceValueGhs).toBe(Math.round(((1_000_000 * (100 + accrued)) / 100) * 100) / 100);
    expect(p.assumption).toMatchObject({ kind: "PAR", value: null, summary: "par (clean price = face value)", provenance: "Analyst assumption" });
    expect(p.assumption!.calculation.join(" ")).toContain("par");
    const same = valued(valueBondWithAssumption(1_000_000, TERMS, A("PRICE_PER_100", 100), VAL));
    expect(p.referenceValueGhs).toBe(same.referenceValueGhs);
  });

  it("rejects impossible inputs with a reason — never NaN, never a silent fallback", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 100.01]) {
      const r = valueBondWithAssumption(1e6, TERMS, A("YIELD_PCT", bad), VAL);
      expect(r.status).toBe("UNVALUED");
      if (r.status === "UNVALUED") expect(r.reason).toMatch(/could not be applied/);
    }
    for (const bad of [0, -5, 1000.5, Number.NaN]) expect(valueBondWithAssumption(1e6, TERMS, A("PRICE_PER_100", bad), VAL).status).toBe("UNVALUED");
  });

  it("a zero yield is valid (zero is a number, not 'missing')", () => {
    expect(valued(valueBondWithAssumption(1e6, TERMS, A("YIELD_PCT", 0), VAL)).referenceValueGhs).toBeGreaterThan(1e6);
  });
});

describe("equity and Treasury-bill assumptions", () => {
  it("equity: value = shares × assumed price, no yield or fair-value model", () => {
    const p = valued(valueEquityWithAssumption(1_500, A("SHARE_PRICE_GHS", 12.345), VAL));
    expect(p.referenceValueGhs).toBe(Math.round(1_500 * 12.345 * 100) / 100);
    expect(p.detail).toMatchObject({ priceIsAssumed: true, priceGhs: 12.345 });
    for (const bad of [0, -1, Number.NaN, 2_000_000]) expect(valueEquityWithAssumption(10, A("SHARE_PRICE_GHS", bad), VAL).status).toBe("UNVALUED");
  });

  it("bill: assumed rate uses the M8.5 formula and equals the BoG-derived value at the same rate", () => {
    const a = valued(valueBillWithAssumption(1_000_000, 182, A("RATE_PCT", 20), VAL));
    const k = valued(valueBillPosition(1_000_000, billIn(20, 182), VAL));
    expect(a.referenceValueGhs).toBe(k.referenceValueGhs);
    expect(a.detail).toMatchObject({ method: "ANALYST_ASSUMPTION", referenceRatePct: 20, daysToMaturity: 182 });
    expect((a.detail as { dv01Ghs: number }).dv01Ghs).toBeCloseTo((k.detail as { dv01Ghs: number }).dv01Ghs, 10);
  });

  it("bill: assumed price per 100 gives value = face × price / 100 and the implied rate; a price above 100 is refused", () => {
    const p = valued(valueBillWithAssumption(2_000_000, 182, A("PRICE_PER_100", 90), VAL));
    expect(p.referenceValueGhs).toBe(1_800_000);
    expect((p.detail as { referenceRatePct: number }).referenceRatePct).toBeCloseTo(((100 / 90 - 1) / (182 / 365)) * 100, 9);
    expect(valueBillWithAssumption(2_000_000, 182, A("PRICE_PER_100", 101), VAL).status).toBe("UNVALUED");
  });

  it("bill: par is not offered (before maturity it would imply a 0% rate)", () => {
    expect(validateAssumption("TREASURY_BILL", "PAR", null).ok).toBe(false);
    expect(valueBillWithAssumption(1e6, 182, A("PAR", null), VAL).status).toBe("UNVALUED");
  });
});

describe("what may be assumed (by asset class) and what must stay unvalued", () => {
  it("kinds are asset-class specific; mismatches are rejected", () => {
    expect(ASSUMPTION_KINDS_BY_CLASS.BOND).toEqual(["YIELD_PCT", "PRICE_PER_100", "PAR"]);
    expect(ASSUMPTION_KINDS_BY_CLASS.EQUITY).toEqual(["SHARE_PRICE_GHS"]);
    expect(validateAssumption("EQUITY", "YIELD_PCT", 20).ok).toBe(false);
    expect(validateAssumption("BOND", "SHARE_PRICE_GHS", 20).ok).toBe(false);
    expect(validateAssumption("BOND", "PAR", 100).ok).toBe(false);
    expect(validateAssumption("EQUITY", "PAR", null).ok).toBe(false);
  });

  it("only MARKET-EVIDENCE gaps accept an assumption; missing contractual terms stay unavailable", () => {
    const assumable: UnvaluedCode[] = ["NO_OBSERVATION", "NO_REFERENCE_RATE", "NO_TRADE", "UNDER_REVIEW", "OBSERVATION_EXCLUDED", "NO_PRICE", "CALCULATION_FAILED"];
    const blocked: UnvaluedCode[] = ["NOT_GHS", "MATURED", "FLOATING_RATE", "NOT_OUTSTANDING", "TERMS_UNSUPPORTED", "TERMS_CONFLICT", "INACTIVE"];
    for (const c of assumable) expect(assumptionAvailability("BOND", c).assumable).toBe(true);
    for (const c of blocked) {
      const r = assumptionAvailability("BOND", c);
      expect(r.assumable).toBe(false);
      if (!r.assumable) expect(r.reason.length).toBeGreaterThan(10);
    }
    expect(assumable.length + blocked.length).toBe(14); // every UnvaluedCode is classified
  });

  it("terms-incomplete is explained as 'Korbly does not invent contract terms'", () => {
    const r = assumptionAvailability("BOND", "TERMS_UNSUPPORTED");
    expect(!r.assumable && r.reason).toMatch(/does not invent/);
  });
});

describe("hierarchy and precedence", () => {
  const korblyValued = () => valueBondPosition(1e6, TERMS, bondIn(25), VAL);
  const assumedAt = (y: number) => () => valueBondWithAssumption(1e6, TERMS, A("YIELD_PCT", y), VAL);

  it("no assumption → Korbly's own result, and the assumption engine is never invoked (no silent fallback, no silent par)", () => {
    let called = false;
    const u = valueBondPosition(1e6, TERMS, unv(), VAL);
    expect(resolveValuation(u, null, () => { called = true; return u; })).toBe(u);
    expect(called).toBe(false);
    expect(u.status).toBe("UNVALUED");
  });

  it("gap-filling assumption on an unvalued assumable bond → ANALYST_ASSUMPTION", () => {
    const r = valued(resolveValuation(valueBondPosition(1e6, TERMS, unv("NO_TRADE"), VAL), A("YIELD_PCT", 28), assumedAt(28)));
    expect(r.basis).toBe("ANALYST_ASSUMPTION");
    expect(r.korblyBasis).toBeNull();
  });

  it("an assumption on a NOT-assumable position is ignored — still unvalued with the original reason", () => {
    const u = valueBondPosition(1e6, TERMS, unv("TERMS_UNSUPPORTED"), VAL);
    const r = resolveValuation(u, A("YIELD_PCT", 28), assumedAt(28));
    expect(r.status).toBe("UNVALUED");
    if (r.status === "UNVALUED") expect(r.code).toBe("TERMS_UNSUPPORTED");
  });

  it("an EXPLICIT override keeps Korbly's value beside the assumption and never overwrites it", () => {
    const k = valued(korblyValued());
    const r = valued(resolveValuation(k, A("YIELD_PCT", 28, true), assumedAt(28)));
    expect(r.basis).toBe("ANALYST_ASSUMPTION");
    expect(r.korblyBasis).toMatchObject({ basis: "REFERENCE", valueGhs: k.referenceValueGhs });
    expect(r.referenceValueGhs).not.toBe(k.referenceValueGhs);
    expect(k.basis).toBe("REFERENCE"); // the Korbly valuation object itself is untouched
    expect(k.referenceValueGhs).toBe(valued(korblyValued()).referenceValueGhs);
  });

  it("a gap-filling assumption never silently replaces a Reference value that has appeared since", () => {
    const k = valued(korblyValued());
    const r = valued(resolveValuation(k, A("YIELD_PCT", 28, false), assumedAt(28)));
    expect(r.basis).toBe("REFERENCE");
    expect(r.referenceValueGhs).toBe(k.referenceValueGhs);
    expect(r.ignoredAssumption).toMatchObject({ kind: "YIELD_PCT", value: 28 });
  });

  it("an override is NOT superseded when Korbly's value changes — the analyst chose it; Korbly's new value stays beside it", () => {
    const k1 = valued(korblyValued());
    const k2 = valued(resolveValuation(valueBondPosition(1e6, TERMS, bondIn(19), VAL), null, assumedAt(28)));
    expect(k2.referenceValueGhs).not.toBe(k1.referenceValueGhs);
    const r = valued(resolveValuation(k2, A("YIELD_PCT", 28, true), assumedAt(28)));
    expect(r.basis).toBe("ANALYST_ASSUMPTION");
    expect(r.korblyBasis?.valueGhs).toBe(k2.referenceValueGhs);
    expect(r.ignoredAssumption).toBeNull();
  });

  it("fallback vs override are distinguishable from the stored flag, and the assumed value differs from the Reference Value", () => {
    const fallback = valued(resolveValuation(valueBondPosition(1e6, TERMS, unv(), VAL), A("YIELD_PCT", 28, false), assumedAt(28)));
    expect(fallback.korblyBasis).toBeNull();
    const k = valued(korblyValued());
    const override = valued(resolveValuation(k, A("YIELD_PCT", 28, true), assumedAt(28)));
    expect(override.korblyBasis).not.toBeNull();
    expect(override.referenceValueGhs).not.toBe(override.korblyBasis!.valueGhs);
  });

  it("an inactive (superseded) fallback is retained, described, and not deleted", () => {
    const r = valued(resolveValuation(valued(korblyValued()), A("YIELD_PCT", 28, false), assumedAt(28)));
    expect(r.ignoredAssumption?.summary).toBe("28.00% yield");
  });

  it("removing the assumption restores Korbly's value, or unvalued when Korbly has none", () => {
    const k = valueBondPosition(1e6, TERMS, bondIn(25), VAL);
    expect(resolveValuation(k, null, assumedAt(28))).toBe(k);
    const u = valueBondPosition(1e6, TERMS, unv(), VAL);
    expect(resolveValuation(u, null, assumedAt(28)).status).toBe("UNVALUED");
  });

  it("an assumption that cannot be applied leaves the position unvalued with the reason, not valued", () => {
    const u = valueBondPosition(1e6, TERMS, unv(), VAL);
    const r = resolveValuation(u, A("YIELD_PCT", 500), () => valueBondWithAssumption(1e6, TERMS, A("YIELD_PCT", 500), VAL));
    expect(r.status).toBe("UNVALUED");
    if (r.status === "UNVALUED") expect(r.assumptionProblem?.reason).toBeTruthy();
  });
});

describe("mixed-basis summary and Analytical Starting Value", () => {
  const korblyBond = valueBondPosition(2_000_000, TERMS, bondIn(25), VAL);
  const bill = valueBillPosition(1_000_000, billIn(), VAL);
  const equity = valueEquityPosition(100_000, eqIn(10), );
  const assumedBond = valueBondWithAssumption(1_000_000, TERMS, A("YIELD_PCT", 28), VAL);
  const unvaluedBond = valueBondPosition(500_000, TERMS, unv(), VAL);

  it("reference + indicative + assumption === total, to the pesewa; unvalued is excluded, not zero", () => {
    const s = summarizePortfolio([korblyBond, bill, equity, assumedBond, unvaluedBond], VAL);
    const sum = Math.round((s.basis.reference.valueGhs + s.basis.indicative.valueGhs + s.basis.assumption.valueGhs) * 100) / 100;
    expect(sum).toBe(s.referenceValueGhs);
    expect(s.basis.supported.valueGhs).toBe(Math.round((s.basis.reference.valueGhs + s.basis.indicative.valueGhs) * 100) / 100);
    expect(s.basis.reference.count).toBe(2);
    expect(s.basis.indicative.count).toBe(1);
    expect(s.basis.assumption.count).toBe(1);
    expect(s.unvaluedCount).toBe(1);
    expect(s.assumptionCount).toBe(1);
    const pcts = (s.basis.reference.pct ?? 0) + (s.basis.indicative.pct ?? 0) + (s.basis.assumption.pct ?? 0);
    expect(pcts).toBeCloseTo(100, 9);
    expect(s.assumptionPct).toBeCloseTo(s.basis.assumption.pct!, 12);
  });

  it("evidence recency and assumption share together make up 100% — an assumption is neither recent nor stale", () => {
    const s = summarizePortfolio([korblyBond, bill, assumedBond, valueBondPosition(1e6, TERMS, bondIn(25, { recency: "STALE" }), VAL)], VAL);
    expect(s.recentPct! + s.stalePct! + s.assumptionPct!).toBeCloseTo(100, 9);
    expect(s.recentCount + s.staleCount + s.assumptionCount).toBe(s.valuedCount);
  });

  it("assumption dates do not pollute the observation date range", () => {
    const s = summarizePortfolio([korblyBond, assumedBond], VAL);
    expect(s.inputDateRange).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("nothing valued → null total (never 0) and no percentages", () => {
    const s = summarizePortfolio([unvaluedBond], VAL);
    expect(s.referenceValueGhs).toBeNull();
    expect(s.assumptionPct).toBeNull();
    expect(s.basis.reference.pct).toBeNull();
  });

  it("terminology: 'Reference Value' only while no position rests on an assumption; never 'Market value'", () => {
    const refOnly = summarizePortfolio([korblyBond, bill], VAL);
    const mixed = summarizePortfolio([korblyBond, assumedBond], VAL);
    expect(valueTerms(refOnly)).toMatchObject({ label: "Reference Value", analytical: false });
    expect(valueTerms(mixed)).toMatchObject({ label: "Analytical Starting Value", analytical: true });
    expect(valueTerms(mixed).label).not.toMatch(/market value|reference/i);
    expect(valueTerms(mixed).shareOf).toBe("valued Analytical Starting Value");
  });
});
