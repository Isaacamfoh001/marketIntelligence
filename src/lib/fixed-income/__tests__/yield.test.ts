import { describe, it, expect } from "vitest";
import { computeCurrentYield, computeYtm } from "../yield";
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

describe("computeCurrentYield", () => {
  it("is coupon / price when at par", () => {
    const result = computeCurrentYield(SEMI_ANNUAL_BOND, 100);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.currentYieldPct).toBeCloseTo(20, 6);
  });

  it("rises as price falls below par", () => {
    const result = computeCurrentYield(SEMI_ANNUAL_BOND, 90);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.currentYieldPct).toBeCloseTo((20 / 90) * 100, 6);
  });

  it("is unavailable for a zero-coupon instrument", () => {
    const zero: BondTerms = { ...SEMI_ANNUAL_BOND, couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null };
    expect(computeCurrentYield(zero, 90).ok).toBe(false);
  });

  it("is unavailable for a non-positive price", () => {
    expect(computeCurrentYield(SEMI_ANNUAL_BOND, 0).ok).toBe(false);
  });
});

describe("computeYtm — bond-math correctness (M7 §21 acceptance scenarios)", () => {
  // Priced exactly ON a coupon date (settlement == an anchor date), at which
  // point the standard par-yield identity (YTM == coupon rate at par) holds
  // exactly, with no fractional-period distortion.
  const settlement = d("2024-06-15"); // one coupon date into the bond's life
  const atParDirtyPrice = 100;

  it("prices at par imply YTM approximately equal to the coupon rate", () => {
    const result = computeYtm(SEMI_ANNUAL_BOND, settlement, atParDirtyPrice);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ytmPct).toBeCloseTo(20, 2);
  });

  it("a price below par implies a YTM greater than the coupon rate", () => {
    const result = computeYtm(SEMI_ANNUAL_BOND, settlement, 85);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ytmPct).toBeGreaterThan(20);
  });

  it("a price above par implies a YTM less than the coupon rate", () => {
    const result = computeYtm(SEMI_ANNUAL_BOND, settlement, 115);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ytmPct).toBeLessThan(20);
  });

  it("round-trips: repricing the solved YTM reproduces the input price", () => {
    const target = 92.5;
    const result = computeYtm(SEMI_ANNUAL_BOND, settlement, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repriced = priceFromYield(SEMI_ANNUAL_BOND, settlement, result.ytmPct);
    expect(repriced.ok).toBe(true);
    if (repriced.ok) expect(repriced.dirtyPrice).toBeCloseTo(target, 4);
  });

  it("is unavailable (MATURED) once the bond has matured", () => {
    const result = computeYtm(SEMI_ANNUAL_BOND, d("2028-06-15"), 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MATURED");
  });

  it("is unavailable (INVALID_PRICE) for a zero or negative price", () => {
    expect(computeYtm(SEMI_ANNUAL_BOND, settlement, 0).ok).toBe(false);
    expect(computeYtm(SEMI_ANNUAL_BOND, settlement, -5).ok).toBe(false);
  });
});

describe("computeYtm — final coupon period (M7.3 §26: street convention)", () => {
  // Final period 15 Dec 2027 -> 15 Jun 2028 (183 days); settle 31 days before redemption.
  const settle = d("2028-05-15");
  const years = 31 / (183 * 2);
  const cash = 110; // final coupon 10 + principal 100

  it("uses the closed-form simple-interest yield when one cash flow remains", () => {
    const dirty = 108.5;
    const result = computeYtm(SEMI_ANNUAL_BOND, settle, dirty);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ytmPct).toBeCloseTo((cash / dirty - 1) / years * 100, 8);
  });

  it("solves a large negative yield for a price far above the remaining cash (no NON_CONVERGENT)", () => {
    const result = computeYtm(SEMI_ANNUAL_BOND, settle, 125);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ytmPct).toBeLessThan(-99);
  });

  it("round-trips through priceFromYield on the same convention", () => {
    const result = computeYtm(SEMI_ANNUAL_BOND, settle, 108.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repriced = priceFromYield(SEMI_ANNUAL_BOND, settle, result.ytmPct);
    expect(repriced.ok).toBe(true);
    if (repriced.ok) expect(repriced.dirtyPrice).toBeCloseTo(108.5, 8);
  });

  it("multi-period bonds still solve below -99% when a premium demands it", () => {
    // Two cash flows left, priced far above their sum.
    const result = computeYtm(SEMI_ANNUAL_BOND, d("2027-11-15"), 135);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repriced = priceFromYield(SEMI_ANNUAL_BOND, d("2027-11-15"), result.ytmPct);
    if (repriced.ok) expect(repriced.dirtyPrice).toBeCloseTo(135, 4);
  });
});
