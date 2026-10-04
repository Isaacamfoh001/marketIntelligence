import { describe, it, expect } from "vitest";
import { computeDuration, approximateDv01FromModifiedDuration } from "../duration";
import { priceFromYield } from "../pricing";
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

const SETTLEMENT = d("2024-06-15"); // 4 years (8 semi-annual periods) remain

describe("computeDuration", () => {
  it("Macaulay duration is less than the remaining tenor for a coupon-paying bond", () => {
    const result = computeDuration(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.macaulayDurationYears).toBeGreaterThan(0);
    expect(result.macaulayDurationYears).toBeLessThan(4); // < remaining tenor, since coupons are paid before maturity
  });

  it("modified duration is Macaulay duration discounted by one period's yield", () => {
    const result = computeDuration(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modifiedDurationYears).toBeCloseTo(result.macaulayDurationYears / (1 + 0.2 / 2), 6);
  });

  it("a zero-coupon instrument's Macaulay duration equals its remaining tenor exactly", () => {
    const zero: BondTerms = { ...SEMI_ANNUAL_BOND, couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null };
    const result = computeDuration(zero, SETTLEMENT, 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const remainingYears = (zero.maturityDate.getTime() - SETTLEMENT.getTime()) / (365 * 24 * 60 * 60 * 1000);
    expect(result.macaulayDurationYears).toBeCloseTo(remainingYears, 4);
  });

  it("a longer-maturity bond with the same coupon has longer duration", () => {
    const longer: BondTerms = { ...SEMI_ANNUAL_BOND, maturityDate: d("2033-06-15") };
    const shortResult = computeDuration(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
    const longResult = computeDuration(longer, SETTLEMENT, 20);
    expect(shortResult.ok && longResult.ok).toBe(true);
    if (shortResult.ok && longResult.ok) {
      expect(longResult.macaulayDurationYears).toBeGreaterThan(shortResult.macaulayDurationYears);
    }
  });

  describe("DV01 — repricing vs. the independent duration-based approximation (M7 §21)", () => {
    it("direct-repricing DV01 is close to the modified-duration linear approximation", () => {
      const result = computeDuration(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const priced = priceFromYield(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
      expect(priced.ok).toBe(true);
      if (!priced.ok) return;
      const approx = approximateDv01FromModifiedDuration(result.modifiedDurationYears, priced.dirtyPrice);
      // The two methods should agree to within ~1% relative — any larger gap would indicate a sign or scale error in one of the two implementations.
      expect(result.dv01).toBeGreaterThan(0);
      expect(Math.abs(result.dv01 - approx) / result.dv01).toBeLessThan(0.01);
    });

    it("DV01 is positive (price always falls when yield rises) for a conventional bond", () => {
      const result = computeDuration(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.dv01).toBeGreaterThan(0);
    });
  });

  it("convexity is positive for a conventional fixed-coupon bond", () => {
    const result = computeDuration(SEMI_ANNUAL_BOND, SETTLEMENT, 20);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.convexityYears2).toBeGreaterThan(0);
  });

  it("is unavailable once the bond has matured", () => {
    const result = computeDuration(SEMI_ANNUAL_BOND, d("2028-06-15"), 20);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MATURED");
  });
});

describe("computeDuration — final coupon period", () => {
  it("Macaulay duration equals the time to the single remaining payment", () => {
    const settle = d("2028-05-15");
    const result = computeDuration(SEMI_ANNUAL_BOND, settle, 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = 31 / (183 * 2);
    expect(result.macaulayDurationYears).toBeCloseTo(t, 10);
    expect(result.modifiedDurationYears).toBeCloseTo(t / (1 + 0.2 * t), 10);
    expect(result.dv01).toBeGreaterThan(0);
  });
});
