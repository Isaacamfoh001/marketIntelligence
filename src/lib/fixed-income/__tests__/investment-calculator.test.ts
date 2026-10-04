import { describe, it, expect } from "vitest";
import { evaluateInvestment } from "../investment-calculator";
import { computeYtm } from "../yield";
import type { BondTerms } from "../types";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const SEMI_ANNUAL_BOND: BondTerms = {
  issueDate: d("2023-06-15"),
  maturityDate: d("2028-06-15"),
  couponType: "FIXED",
  couponRatePct: 20,
  couponFrequency: "SEMI_ANNUAL",
  faceValue: 100,
};

describe("evaluateInvestment", () => {
  it("at par, on a coupon date, acquires face value equal to the investment amount", () => {
    const result = evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), 1_000_000, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.faceValueAcquired).toBeCloseTo(1_000_000, 2);
    expect(result.accruedInterest).toBeCloseTo(0, 6);
    expect(result.principalRedemption).toBeCloseTo(1_000_000, 2);
  });

  it("nominal cash received exceeds the investment amount for a bond priced below the coupon-implied par return", () => {
    const result = evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), 1_000_000, 85);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalNominalCashReceived).toBeGreaterThan(result.investmentAmount);
    expect(result.nominalProfit).toBeGreaterThan(0);
    expect(result.annualisedReturnPct).toBeGreaterThan(20); // bought below par -> YTM > coupon
  });

  it("buying more nominal at a lower price than at a higher price, for the same cash outlay", () => {
    const cheap = evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), 1_000_000, 80);
    const expensive = evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), 1_000_000, 120);
    expect(cheap.ok && expensive.ok).toBe(true);
    if (cheap.ok && expensive.ok) expect(cheap.faceValueAcquired).toBeGreaterThan(expensive.faceValueAcquired);
  });

  it("rejects a non-positive investment amount", () => {
    expect(evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), 0, 100).ok).toBe(false);
    expect(evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), -500, 100).ok).toBe(false);
  });

  it("rejects a non-positive price", () => {
    expect(evaluateInvestment(SEMI_ANNUAL_BOND, d("2024-06-15"), 1_000_000, 0).ok).toBe(false);
  });

  it("is unavailable once the bond has matured", () => {
    expect(evaluateInvestment(SEMI_ANNUAL_BOND, d("2028-06-15"), 1_000_000, 100).ok).toBe(false);
  });

  describe("acquisition costs (M7.3 §13/§14)", () => {
    // Period 15 Dec 2024 -> 15 Jun 2025 is 182 days; 90 accrued at 15 Mar -> accrued = 10 * 90/182 per 100.
    const SETTLE = d("2025-03-15");
    const CHARGES = { regulatoryLevyPct: 0.01, dealerFeePct: 0.25 };

    it("breaks the investment amount into clean + accrued + levy + dealer fee", () => {
      const r = evaluateInvestment(SEMI_ANNUAL_BOND, SETTLE, 1_000_000, 105, CHARGES);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.accruedInterest).toBeCloseTo(10 * (90 / 182), 10);
      expect(r.cleanConsideration + r.accruedInterestPaid).toBeCloseTo(r.settlementConsideration, 6);
      expect(r.regulatoryLevy).toBeCloseTo(r.settlementConsideration * 0.0001, 6);
      expect(r.dealerFee).toBeCloseTo(r.settlementConsideration * 0.0025, 6);
      expect(r.totalAcquisitionCost).toBeCloseTo(1_000_000, 4);
      // Accrued interest paid scales with the position, not the per-100 figure.
      expect(r.accruedInterestPaid).toBeCloseTo((r.faceValueAcquired / 100) * r.accruedInterest, 6);
      expect(r.accruedInterestPaid).toBeGreaterThan(1000);
    });

    it("charges lower the annualised return below the pre-charge YTM, and match a direct solve on all-in cost", () => {
      const r = evaluateInvestment(SEMI_ANNUAL_BOND, SETTLE, 1_000_000, 105, CHARGES);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.annualisedReturnPct).toBeLessThan(r.ytmBeforeChargesPct);
      const direct = computeYtm(SEMI_ANNUAL_BOND, SETTLE, r.dirtyPrice * (1 + 0.26 / 100));
      expect(direct.ok).toBe(true);
      if (direct.ok) expect(r.annualisedReturnPct).toBeCloseTo(direct.ytmPct, 8);
    });

    it("with zero charges, the annualised return equals the pre-charge YTM (original M7 behaviour)", () => {
      const r = evaluateInvestment(SEMI_ANNUAL_BOND, SETTLE, 1_000_000, 105, { regulatoryLevyPct: 0, dealerFeePct: 0 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.dealerFee).toBe(0);
      expect(r.regulatoryLevy).toBe(0);
      expect(r.annualisedReturnPct).toBeCloseTo(r.ytmBeforeChargesPct, 10);
    });

    it("scales the remaining cash-flow schedule to the position and sums to total cash received", () => {
      const r = evaluateInvestment(SEMI_ANNUAL_BOND, SETTLE, 1_000_000, 105, CHARGES);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const sum = r.cashFlows.reduce((s, f) => s + f.total, 0);
      expect(sum).toBeCloseTo(r.totalNominalCashReceived, 6);
      expect(r.cashFlows[r.cashFlows.length - 1].principal).toBeCloseTo(r.faceValueAcquired, 6);
    });

    it("rejects implausible dealer fees", () => {
      expect(evaluateInvestment(SEMI_ANNUAL_BOND, SETTLE, 1_000_000, 105, { regulatoryLevyPct: 0.01, dealerFeePct: 40 }).ok).toBe(false);
    });
  });
});
