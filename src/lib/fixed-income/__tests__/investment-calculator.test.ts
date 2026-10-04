import { describe, it, expect } from "vitest";
import { evaluateInvestment } from "../investment-calculator";
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
});
