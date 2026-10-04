import { describe, it, expect } from "vitest";
import { computeAccruedInterest, cleanToDirty, dirtyToClean } from "../accrued";
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

describe("computeAccruedInterest", () => {
  it("is zero exactly on a coupon date", () => {
    const result = computeAccruedInterest(SEMI_ANNUAL_BOND, d("2024-06-15"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accruedInterest).toBeCloseTo(0, 6);
  });

  it("is roughly half a coupon period's income at the period's midpoint", () => {
    // 2024-06-15 -> 2024-12-15 is the coupon period; its midpoint accrues ~half the 10.0 semi-annual coupon.
    const result = computeAccruedInterest(SEMI_ANNUAL_BOND, d("2024-09-15"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accruedInterest).toBeGreaterThan(4.5);
    expect(result.accruedInterest).toBeLessThan(5.5);
  });

  it("is zero for a zero-coupon instrument (no periodic coupon to accrue)", () => {
    const zero: BondTerms = { ...SEMI_ANNUAL_BOND, couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null };
    const result = computeAccruedInterest(zero, d("2024-09-15"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accruedInterest).toBe(0);
  });

  it("is unavailable once matured", () => {
    const result = computeAccruedInterest(SEMI_ANNUAL_BOND, d("2028-06-15"));
    expect(result.ok).toBe(false);
  });
});

describe("cleanToDirty / dirtyToClean", () => {
  it("round-trip exactly", () => {
    expect(dirtyToClean(cleanToDirty(95, 3.2), 3.2)).toBeCloseTo(95, 10);
  });
});
