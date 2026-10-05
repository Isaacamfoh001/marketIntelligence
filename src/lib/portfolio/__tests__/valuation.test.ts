import { describe, expect, it } from "vitest";
import { resolveBondValuationInput, resolveEquityValuationInput, summarizePortfolio, valueBondPosition, valueEquityPosition, type BondValuationInput, type PositionValuation, type ValuedPosition } from "..";
import { computeAccruedInterest, priceFromYield, solveObservedYtm, type BondTerms } from "../../fixed-income";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VALUATION = d("2026-10-05");
/** 20% semi-annual (coupons 1 Mar / 1 Sep), matures 1 Mar 2028. */
const TERMS: BondTerms = { issueDate: d("2024-03-01"), maturityDate: d("2028-03-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };

function bondInput(over: Partial<BondValuationInput> = {}): BondValuationInput {
  return { available: true, assetClass: "BOND", observedYtmPct: 20.49, observationDate: "2026-09-30", ageDays: 5, recency: "RECENT", observedCleanPrice: 97.5, yieldFromSourceQuote: false, pendingReview: null, ...over };
}

const valued = (p: PositionValuation): ValuedPosition => {
  if (p.status !== "VALUED") throw new Error(`expected valued, got ${p.code}`);
  return p;
};

describe("bond reference value (yield-rolled, M7 engine)", () => {
  it("value = nominal × dirty / face, where dirty = priceFromYield(terms, valuationDate, observed yield)", () => {
    const p = valued(valueBondPosition(2_000_000, TERMS, bondInput(), VALUATION));
    const dirty = (priceFromYield(TERMS, VALUATION, 20.49) as { dirtyPrice: number }).dirtyPrice;
    expect(p.detail).toMatchObject({ assetClass: "BOND", referenceDirtyPrice: dirty, observedYtmPct: 20.49, observationDate: "2026-09-30", valuationDate: "2026-10-05" });
    expect(p.referenceValueGhs).toBeCloseTo((2_000_000 * dirty) / 100, 2);
    expect(p.inputDate).toBe("2026-09-30");
    expect(p.inputAgeDays).toBe(5);
  });

  it("accrued interest is included: dirty = clean + accrued, accrued matches an independent hand calculation", () => {
    const p = valued(valueBondPosition(1_000_000, TERMS, bondInput(), VALUATION));
    const detail = p.detail as { accruedInterest: number; referenceCleanPrice: number; referenceDirtyPrice: number };
    // 34 days since the 1 Sep 2026 coupon in a 181-day period (1 Sep 2026 → 1 Mar 2027): 10 × 34/181.
    expect(detail.accruedInterest).toBeCloseTo((10 * 34) / 181, 10);
    expect(detail.referenceCleanPrice + detail.accruedInterest).toBeCloseTo(detail.referenceDirtyPrice, 10);
    expect(detail.accruedInterest).toBe((computeAccruedInterest(TERMS, VALUATION) as { accruedInterest: number }).accruedInterest);
  });

  it("an observation dated on the valuation date reproduces the observed clean price", () => {
    const solved = solveObservedYtm(TERMS, VALUATION, 97.5);
    if (!solved.ok) throw new Error("solve failed");
    const p = valued(valueBondPosition(500_000, TERMS, bondInput({ observedYtmPct: solved.ytmPct, observationDate: "2026-10-05", ageDays: 0, observedCleanPrice: 97.5 }), VALUATION));
    const detail = p.detail as { referenceCleanPrice: number; observedCleanPrice: number };
    expect(detail.referenceCleanPrice).toBeCloseTo(97.5, 6);
    expect(p.referenceValueGhs).toBeCloseTo((500_000 * (97.5 + solved.accruedInterest)) / 100, 1);
  });

  it("the rolled reference price is kept distinct from the observed historical price", () => {
    const solved = solveObservedYtm(TERMS, d("2026-09-30"), 97.5);
    if (!solved.ok) throw new Error("solve failed");
    const detail = valued(valueBondPosition(1_000_000, TERMS, bondInput({ observedYtmPct: solved.ytmPct }), VALUATION)).detail as { referenceCleanPrice: number; observedCleanPrice: number };
    expect(detail.observedCleanPrice).toBe(97.5);
    expect(detail.referenceCleanPrice).not.toBe(97.5);
    // Five days of pull-to-par at ~20% yield on a discount bond moves clean price up, but only slightly.
    expect(detail.referenceCleanPrice).toBeGreaterThan(97.5);
    expect(detail.referenceCleanPrice).toBeLessThan(97.7);
  });

  it("scales linearly with nominal", () => {
    const one = valued(valueBondPosition(1_000_000, TERMS, bondInput(), VALUATION)).referenceValueGhs;
    const three = valued(valueBondPosition(3_000_000, TERMS, bondInput(), VALUATION)).referenceValueGhs;
    expect(three).toBeCloseTo(3 * one, 1);
    const tiny = valued(valueBondPosition(1234.56, TERMS, bondInput(), VALUATION)).referenceValueGhs;
    expect(tiny).toBe(Math.round(tiny * 100) / 100);
  });

  it("scales by face value (a GHS 1,000 face bond)", () => {
    const terms1000 = { ...TERMS, faceValue: 1000 };
    const p100 = valued(valueBondPosition(1_000_000, TERMS, bondInput(), VALUATION)).referenceValueGhs;
    const p1000 = valued(valueBondPosition(1_000_000, terms1000, bondInput(), VALUATION)).referenceValueGhs;
    expect(p1000).toBeCloseTo(p100, 1); // same % price, same nominal → same value
  });

  it("a stale yield stays labelled stale and keeps its own date and age", () => {
    const p = valued(valueBondPosition(1_000_000, TERMS, bondInput({ recency: "STALE", observationDate: "2026-08-01", ageDays: 65 }), VALUATION));
    expect(p.recency).toBe("STALE");
    expect(p.inputDate).toBe("2026-08-01");
    expect(p.inputAgeDays).toBe(65);
  });

  it("a pending review is carried through to the valuation detail", () => {
    const pending = { date: "2026-10-02", status: "REVIEW" as const, issues: ["x"] };
    expect((valued(valueBondPosition(1_000_000, TERMS, bondInput({ pendingReview: pending }), VALUATION)).detail as { pendingReview: unknown }).pendingReview).toEqual(pending);
  });

  it("supports a zero-coupon bond via the unchanged M7 engine (accrued 0, dirty = clean)", () => {
    const zc: BondTerms = { issueDate: d("2026-04-01"), maturityDate: d("2027-04-01"), couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null, faceValue: 100 };
    const detail = valued(valueBondPosition(1_000_000, zc, bondInput({ observedYtmPct: 25 }), VALUATION)).detail as { accruedInterest: number; referenceCleanPrice: number; referenceDirtyPrice: number };
    expect(detail.accruedInterest).toBe(0);
    expect(detail.referenceCleanPrice).toBe(detail.referenceDirtyPrice);
  });

  it("an unavailable input becomes an UNVALUED position carrying the reason — never a zero value", () => {
    const input = resolveBondValuationInput({ currency: "GHS", status: "ACTIVE", lifecycle: "ACTIVE", terms: TERMS, termsConflicts: [], latestReliableTrade: null, marketObservation: null, carriedOnly: false }, VALUATION);
    const p = valueBondPosition(1_000_000, TERMS, input, VALUATION);
    expect(p).toMatchObject({ status: "UNVALUED", code: "NO_OBSERVATION" });
    expect(p).not.toHaveProperty("referenceValueGhs");
  });

  it("a pricing failure is reported as CALCULATION_FAILED, not a number", () => {
    const matured = { ...TERMS, maturityDate: d("2026-10-01") };
    expect(valueBondPosition(1_000_000, matured, bondInput(), VALUATION)).toMatchObject({ status: "UNVALUED", code: "CALCULATION_FAILED" });
  });
});

describe("equity reference value", () => {
  it("value = shares × last-trade closing VWAP, carrying the trade date, age and recency", () => {
    const input = resolveEquityValuationInput({ currency: "GHS", active: true, prices: [{ tradingDate: "2026-10-01", closeVwap: 31.25, volume: 900, valueTradedGhs: 28125 }] }, VALUATION);
    const p = valued(valueEquityPosition(100_000, input));
    expect(p.referenceValueGhs).toBe(3_125_000);
    expect(p).toMatchObject({ recency: "RECENT", inputDate: "2026-10-01", inputAgeDays: 4 });
    expect(p.detail).toMatchObject({ assetClass: "EQUITY", shares: 100_000, priceGhs: 31.25, priceDate: "2026-10-01" });
  });

  it("rounds to whole pesewas without float drift (0.1 × 3)", () => {
    const input = resolveEquityValuationInput({ currency: "GHS", active: true, prices: [{ tradingDate: "2026-10-01", closeVwap: 0.1, volume: 5, valueTradedGhs: null }] }, VALUATION);
    expect(valued(valueEquityPosition(3, input)).referenceValueGhs).toBe(0.3);
  });

  it("no actual trade → UNVALUED, not zero", () => {
    const input = resolveEquityValuationInput({ currency: "GHS", active: true, prices: [{ tradingDate: "2026-10-01", closeVwap: 0.02, volume: 0, valueTradedGhs: 0 }] }, VALUATION);
    expect(valueEquityPosition(1000, input)).toMatchObject({ status: "UNVALUED", assetClass: "EQUITY", code: "NO_TRADE" });
  });
});

describe("portfolio summary", () => {
  const equity = (shares: number, price: number, date: string) => valueEquityPosition(shares, resolveEquityValuationInput({ currency: "GHS", active: true, prices: [{ tradingDate: date, closeVwap: price, volume: 10, valueTradedGhs: null }] }, VALUATION));
  const unvalued = valueEquityPosition(5000, resolveEquityValuationInput({ currency: "GHS", active: true, prices: [] }, VALUATION));
  const recentEq = equity(1000, 10, "2026-10-02"); // 10,000 recent
  const staleEq = equity(3000, 10, "2026-08-24"); // 30,000 stale (42 days)
  const recentBond = valueBondPosition(1_000_000, TERMS, bondInput(), VALUATION);

  it("total = exact sum of the valued positions' reference values", () => {
    const s = summarizePortfolio([recentEq, staleEq, recentBond], VALUATION);
    const expected = valued(recentEq).referenceValueGhs + valued(staleEq).referenceValueGhs + valued(recentBond).referenceValueGhs;
    expect(s.referenceValueGhs).toBeCloseTo(expected, 2);
    expect(s.valuedCount).toBe(3);
    expect(s.positionCount).toBe(3);
  });

  it("an unvalued position never contributes zero: it is counted separately and the total is unchanged", () => {
    const withUnvalued = summarizePortfolio([recentEq, staleEq, unvalued], VALUATION);
    const without = summarizePortfolio([recentEq, staleEq], VALUATION);
    expect(withUnvalued.referenceValueGhs).toBe(without.referenceValueGhs);
    expect(withUnvalued).toMatchObject({ positionCount: 3, valuedCount: 2, unvaluedCount: 1, isComplete: false });
  });

  it("recent/stale percentages are over the VALUED value only", () => {
    const s = summarizePortfolio([recentEq, staleEq, unvalued], VALUATION);
    expect(s.referenceValueGhs).toBe(40_000);
    expect(s.recentValueGhs).toBe(10_000);
    expect(s.staleValueGhs).toBe(30_000);
    expect(s.recentPct).toBeCloseTo(25, 10);
    expect(s.stalePct).toBeCloseTo(75, 10);
    expect(s.recentCount).toBe(1);
    expect(s.staleCount).toBe(1);
  });

  it("exposes the span of input dates and ages — positions are not observed on one date", () => {
    const s = summarizePortfolio([recentEq, staleEq, recentBond], VALUATION);
    expect(s.inputDateRange).toEqual({ from: "2026-08-24", to: "2026-10-02" });
    expect(s.inputAgeRangeDays).toEqual({ min: 3, max: 42 });
    expect(s.valuationDate).toBe("2026-10-05");
  });

  it("fully valued → complete", () => {
    expect(summarizePortfolio([recentEq, staleEq], VALUATION).isComplete).toBe(true);
  });

  it("all positions unavailable → null value (not 0), null percentages, no input range", () => {
    const s = summarizePortfolio([unvalued, unvalued], VALUATION);
    expect(s).toMatchObject({ referenceValueGhs: null, recentPct: null, stalePct: null, valuedCount: 0, unvaluedCount: 2, isComplete: false, inputDateRange: null, inputAgeRangeDays: null });
  });

  it("empty portfolio → no value, zero counts, not 'complete'", () => {
    expect(summarizePortfolio([], VALUATION)).toMatchObject({ referenceValueGhs: null, positionCount: 0, valuedCount: 0, unvaluedCount: 0, isComplete: false, recentPct: null });
  });

  it("mixed bond + equity portfolio with one stale and one recent input", () => {
    const s = summarizePortfolio([recentBond, staleEq], VALUATION);
    expect(s.recentCount).toBe(1);
    expect(s.staleCount).toBe(1);
    expect((s.recentPct ?? 0) + (s.stalePct ?? 0)).toBeCloseTo(100, 10);
  });
});

describe("M7 engine contract the portfolio relies on (regression)", () => {
  it("pricing at a yield then solving the yield back at the same date round-trips", () => {
    const dirty = (priceFromYield(TERMS, d("2026-09-30"), 21.5) as { dirtyPrice: number }).dirtyPrice;
    const accrued = (computeAccruedInterest(TERMS, d("2026-09-30")) as { accruedInterest: number }).accruedInterest;
    const solved = solveObservedYtm(TERMS, d("2026-09-30"), dirty - accrued);
    expect(solved.ok && solved.ytmPct).toBeCloseTo(21.5, 6);
  });

  it("a bond priced at its own coupon rate on a coupon date is worth par", () => {
    const dirty = (priceFromYield(TERMS, d("2026-09-01"), 20) as { dirtyPrice: number }).dirtyPrice;
    expect(dirty).toBeCloseTo(100, 6);
  });
});
