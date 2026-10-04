import { describe, it, expect } from "vitest";
import { generateCashFlows, fullCouponSchedule, shiftMonths } from "../cashflow";
import type { BondTerms } from "../types";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("shiftMonths", () => {
  it("clamps day-of-month at a shorter target month (end-of-month rule)", () => {
    // 31 Mar - 1 month -> 28 Feb (2027 is not a leap year)
    expect(shiftMonths(d("2027-03-31"), -1).toISOString().slice(0, 10)).toBe("2027-02-28");
  });

  it("handles a leap-year February correctly", () => {
    expect(shiftMonths(d("2028-03-31"), -1).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("steps across a year boundary", () => {
    expect(shiftMonths(d("2027-01-15"), -2).toISOString().slice(0, 10)).toBe("2026-11-15");
  });
});

describe("fullCouponSchedule", () => {
  it("anchors every coupon date to the maturity date, stepping back by the period length", () => {
    const schedule = fullCouponSchedule(d("2024-06-15"), d("2027-06-15"), 2); // semi-annual, 3 years
    expect(schedule).toHaveLength(6);
    expect(schedule[schedule.length - 1].toISOString().slice(0, 10)).toBe("2027-06-15");
    expect(schedule[0].toISOString().slice(0, 10)).toBe("2024-12-15");
  });
});

const FIXED_SEMI_ANNUAL: BondTerms = {
  issueDate: d("2024-06-15"),
  maturityDate: d("2027-06-15"),
  couponType: "FIXED",
  couponRatePct: 20,
  couponFrequency: "SEMI_ANNUAL",
  faceValue: 100,
};

describe("generateCashFlows — fixed coupon", () => {
  it("produces one coupon-only flow per remaining period, plus principal on the final flow", () => {
    const result = generateCashFlows(FIXED_SEMI_ANNUAL, d("2026-06-15"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flows).toHaveLength(2); // 2026-12-15, 2027-06-15
    expect(result.flows[0].coupon).toBeCloseTo(10, 6); // 100 * 20% / 2
    expect(result.flows[0].principal).toBe(0);
    expect(result.flows[1].coupon).toBeCloseTo(10, 6);
    expect(result.flows[1].principal).toBe(100);
    expect(result.flows[1].total).toBeCloseTo(110, 6);
  });

  it("returns MATURED when settlement is on or after the maturity date", () => {
    const result = generateCashFlows(FIXED_SEMI_ANNUAL, d("2027-06-15"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("MATURED");
  });

  it("returns FLOATING_RATE_UNSUPPORTED for a floating coupon", () => {
    const floating: BondTerms = { ...FIXED_SEMI_ANNUAL, couponType: "FLOATING", couponRatePct: null };
    const result = generateCashFlows(floating, d("2026-01-01"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("FLOATING_RATE_UNSUPPORTED");
  });
});

describe("generateCashFlows — zero coupon", () => {
  it("produces a single bullet cash flow at maturity equal to face value", () => {
    const zero: BondTerms = { ...FIXED_SEMI_ANNUAL, couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null };
    const result = generateCashFlows(zero, d("2026-01-01"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0].total).toBe(100);
    expect(result.flows[0].date.toISOString().slice(0, 10)).toBe("2027-06-15");
  });
});
