import { describe, it, expect } from "vitest";
import {
  computePriceScenario,
  computePriceSensitivity,
  computeBreakEvenCleanPrice,
  returnSensitivityBpsPerPoint,
  sensitivityChartPrices,
  toEffectiveAnnualPct,
  DEFAULT_SCENARIO_PRICES,
} from "../price-scenarios";
import { priceFromYield } from "../pricing";
import { DEFAULT_PURCHASE_CHARGES, NO_CHARGES } from "../transaction-costs";
import type { BondTerms } from "../types";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** 24% semi-annual, final coupon period runs 15 Jul 2026 → 15 Jan 2027 (184 days). */
const NEAR_MATURITY: BondTerms = {
  issueDate: d("2025-01-15"),
  maturityDate: d("2027-01-15"),
  couponType: "FIXED",
  couponRatePct: 24,
  couponFrequency: "SEMI_ANNUAL",
  faceValue: 100,
};
/** 30 days before redemption: 154 of 184 days accrued. */
const NEAR_SETTLEMENT = d("2026-12-16");
const HAND_ACCRUED = 12 * (154 / 184);
const HAND_YEARS = 30 / (184 * 2);
const FINAL_CASH = 112; // last coupon 12 + principal 100

/** Hand-computed street-convention (simple interest) yield in the final coupon period. */
function handSimpleYieldPct(allInCost: number): number {
  return (FINAL_CASH / allInCost - 1) / HAND_YEARS * 100;
}

const LONG_BOND: BondTerms = {
  issueDate: d("2024-09-12"),
  maturityDate: d("2028-09-12"),
  couponType: "FIXED",
  couponRatePct: 23.5,
  couponFrequency: "SEMI_ANNUAL",
  faceValue: 100,
};
const LONG_SETTLEMENT = d("2026-10-04");

describe("computePriceScenario — near maturity (M7.3 §26)", () => {
  it("adds accrued interest to the hypothetical clean price", () => {
    const s = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 100, NO_CHARGES);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.accruedInterest).toBeCloseTo(HAND_ACCRUED, 8);
    expect(s.dirtyPrice).toBeCloseTo(100 + HAND_ACCRUED, 8);
    expect(s.remainingCashPer100).toBeCloseTo(FINAL_CASH, 8);
  });

  it("price 100: matches the hand-computed simple-interest final-period yield", () => {
    const s = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 100, NO_CHARGES);
    expect(s.ok && s.returnPct).not.toBeNull();
    if (!s.ok) return;
    expect(s.returnPct!).toBeCloseTo(handSimpleYieldPct(100 + HAND_ACCRUED), 6);
    // Accrued interest materially lowers the return: ignoring it would imply a far higher yield.
    expect(handSimpleYieldPct(100)).toBeGreaterThan(s.returnPct! + 100);
  });

  it("price 105: the 5-point premium cannot be recovered in 30 days — return is negative", () => {
    const s = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 105, NO_CHARGES);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.returnPct!).toBeLessThan(0);
    expect(s.returnPct!).toBeCloseTo(handSimpleYieldPct(105 + HAND_ACCRUED), 6);
    expect(s.nominalProfitPer100).toBeCloseTo(FINAL_CASH - 105 - HAND_ACCRUED, 8);
  });

  it("price 110: more negative still, and still solvable (no silent NON_CONVERGENT)", () => {
    const s105 = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 105, NO_CHARGES);
    const s110 = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 110, NO_CHARGES);
    expect(s105.ok && s110.ok).toBe(true);
    if (!s105.ok || !s110.ok) return;
    expect(s110.returnPct).not.toBeNull();
    expect(s110.returnPct!).toBeLessThan(s105.returnPct!);
  });

  it("includes the regulatory levy in the all-in cost and lowers the return", () => {
    const gross = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 100, NO_CHARGES);
    const net = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, 100, DEFAULT_PURCHASE_CHARGES);
    expect(gross.ok && net.ok).toBe(true);
    if (!gross.ok || !net.ok) return;
    const dirty = 100 + HAND_ACCRUED;
    expect(net.regulatoryLevy).toBeCloseTo(dirty * 0.0001, 10);
    expect(net.allInCost).toBeCloseTo(dirty * 1.0001, 10);
    expect(net.returnPct!).toBeCloseTo(handSimpleYieldPct(dirty * 1.0001), 6);
    expect(net.returnPct!).toBeLessThan(gross.returnPct!);
    // YTM before charges is unaffected by the levy.
    expect(net.ytmPct!).toBeCloseTo(gross.ytmPct!, 10);
  });
});

describe("computePriceScenario — multi-period bond", () => {
  it("a discount price yields more than the coupon, a premium less", () => {
    const disc = computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 95, NO_CHARGES);
    const prem = computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 110, NO_CHARGES);
    expect(disc.ok && prem.ok).toBe(true);
    if (!disc.ok || !prem.ok) return;
    expect(disc.returnPct!).toBeGreaterThan(23.5);
    expect(prem.returnPct!).toBeLessThan(23.5);
    expect(prem.returnPct!).toBeGreaterThan(0);
  });

  it("the solved return reprices the remaining cash flows to the all-in cost (round trip)", () => {
    const s = computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 103.37, DEFAULT_PURCHASE_CHARGES);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const repriced = priceFromYield(LONG_BOND, LONG_SETTLEMENT, s.returnPct!);
    expect(repriced.ok).toBe(true);
    if (repriced.ok) expect(repriced.dirtyPrice).toBeCloseTo(s.allInCost, 5);
  });

  it("supports arbitrary user-entered prices, not just 100/105/110", () => {
    const s = computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 99.8057, NO_CHARGES);
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.cleanPrice).toBe(99.8057);
  });

  it("rejects a non-positive price and implausible charges", () => {
    expect(computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 0, NO_CHARGES).ok).toBe(false);
    expect(computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 100, { regulatoryLevyPct: 0.01, dealerFeePct: -1 }).ok).toBe(false);
    expect(computePriceScenario(LONG_BOND, LONG_SETTLEMENT, 100, { regulatoryLevyPct: 0.01, dealerFeePct: 25 }).ok).toBe(false);
  });

  it("is unavailable for a matured security", () => {
    const s = computePriceScenario(LONG_BOND, d("2028-09-12"), 100, NO_CHARGES);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toBe("MATURED");
  });
});

describe("computePriceSensitivity", () => {
  it("returns the 100/105/110 defaults ascending with monotonically falling returns", () => {
    const r = computePriceSensitivity(LONG_BOND, LONG_SETTLEMENT, [110, 100, 105, 100], DEFAULT_PURCHASE_CHARGES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenarios.map((s) => s.cleanPrice)).toEqual([...DEFAULT_SCENARIO_PRICES]);
    expect(r.scenarios[0].returnPct!).toBeGreaterThan(r.scenarios[1].returnPct!);
    expect(r.scenarios[1].returnPct!).toBeGreaterThan(r.scenarios[2].returnPct!);
  });

  it("the near-maturity bond loses far more return per point of premium than the long bond", () => {
    const near = returnSensitivityBpsPerPoint(NEAR_MATURITY, NEAR_SETTLEMENT, NO_CHARGES)!;
    const long = returnSensitivityBpsPerPoint(LONG_BOND, LONG_SETTLEMENT, NO_CHARGES)!;
    expect(near).toBeGreaterThan(1000);
    expect(long).toBeLessThan(100);
    expect(long).toBeGreaterThan(0);
  });
});

describe("computeBreakEvenCleanPrice", () => {
  it("is the clean price at which the all-in cost equals the undiscounted remaining cash", () => {
    const be = computeBreakEvenCleanPrice(NEAR_MATURITY, NEAR_SETTLEMENT, DEFAULT_PURCHASE_CHARGES);
    expect(be.ok).toBe(true);
    if (!be.ok) return;
    expect(be.breakEvenCleanPrice).toBeCloseTo(FINAL_CASH / 1.0001 - HAND_ACCRUED, 8);
    const at = computePriceScenario(NEAR_MATURITY, NEAR_SETTLEMENT, be.breakEvenCleanPrice, DEFAULT_PURCHASE_CHARGES);
    expect(at.ok).toBe(true);
    if (at.ok) expect(at.returnPct!).toBeCloseTo(0, 6);
  });
});

describe("toEffectiveAnnualPct", () => {
  it("converts a semi-annual bond-equivalent yield to annual compounding", () => {
    expect(toEffectiveAnnualPct(LONG_BOND, LONG_SETTLEMENT, 20)!).toBeCloseTo(21, 8); // (1.10)^2 − 1
  });

  it("converts a final-period simple yield by compounding over the remaining fraction of a year", () => {
    const simple = 30;
    const expected = (Math.pow(1 + 0.3 * HAND_YEARS, 1 / HAND_YEARS) - 1) * 100;
    expect(toEffectiveAnnualPct(NEAR_MATURITY, NEAR_SETTLEMENT, simple)!).toBeCloseTo(expected, 8);
  });
});

describe("sensitivityChartPrices", () => {
  it("covers 90–115 by default in 0.5 steps", () => {
    const p = sensitivityChartPrices(null);
    expect(p[0]).toBe(90);
    expect(p[p.length - 1]).toBe(115);
    expect(p).toContain(100);
    expect(p).toContain(105);
  });

  it("extends to cover a deeply discounted observed price", () => {
    const p = sensitivityChartPrices(40.96);
    expect(p[0]).toBeLessThanOrEqual(35.96);
  });
});
