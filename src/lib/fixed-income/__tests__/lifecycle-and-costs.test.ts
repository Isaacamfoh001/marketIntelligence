import { describe, it, expect } from "vitest";
import { classifyLifecycle, isOutstanding, observationAgeDays, toValuationDate, MATURING_SOON_DAYS } from "../lifecycle";
import { computeAcquisitionCost, validateCharges, GFIM_BOND_TRANSACTION_LEVY, DEFAULT_PURCHASE_CHARGES } from "../transaction-costs";
import { issuerShortName, securityShortLabel, formatTimeRemaining, formatTenorDiff } from "../format";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const V = d("2026-10-04");

describe("classifyLifecycle (M7.3 §4)", () => {
  it("is ACTIVE beyond the maturing-soon window", () => {
    expect(classifyLifecycle(d("2027-07-26"), V)).toBe("ACTIVE");
  });

  it("is MATURING_SOON within the documented threshold, inclusive", () => {
    expect(classifyLifecycle(d("2026-10-17"), V)).toBe("MATURING_SOON");
    const edge = new Date(V.getTime() + MATURING_SOON_DAYS * 86_400_000);
    expect(classifyLifecycle(edge, V)).toBe("MATURING_SOON");
    expect(classifyLifecycle(new Date(edge.getTime() + 86_400_000), V)).toBe("ACTIVE");
  });

  it("is MATURED on and after the maturity date, regardless of any stored status", () => {
    expect(classifyLifecycle(V, V)).toBe("MATURED");
    expect(classifyLifecycle(d("2025-06-04"), V)).toBe("MATURED");
  });

  it("treats both ACTIVE and MATURING_SOON as outstanding", () => {
    expect(isOutstanding("ACTIVE")).toBe(true);
    expect(isOutstanding("MATURING_SOON")).toBe(true);
    expect(isOutstanding("MATURED")).toBe(false);
  });

  it("normalises the valuation date to the UTC calendar day", () => {
    expect(toValuationDate(new Date("2026-10-04T17:45:12.000Z")).toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("computes observation age in whole days, null when never observed", () => {
    expect(observationAgeDays("2026-10-02", V)).toBe(2);
    expect(observationAgeDays("2026-10-04", V)).toBe(0);
    expect(observationAgeDays(null, V)).toBeNull();
  });
});

describe("transaction costs (M7.3 §14/§28)", () => {
  it("the verified regulatory levy is 0.01% of trade value", () => {
    expect(GFIM_BOND_TRANSACTION_LEVY.ratePct).toBe(0.01);
    expect(DEFAULT_PURCHASE_CHARGES).toEqual({ regulatoryLevyPct: 0.01, dealerFeePct: 0 });
  });

  it("builds acquisition cost = clean + accrued + levy + dealer fee", () => {
    const c = computeAcquisitionCost(105, 4.5, { regulatoryLevyPct: 0.01, dealerFeePct: 0.25 });
    expect(c.settlementConsideration).toBeCloseTo(109.5, 10);
    expect(c.regulatoryLevy).toBeCloseTo(0.01095, 10);
    expect(c.dealerFee).toBeCloseTo(0.27375, 10);
    expect(c.totalAcquisitionCost).toBeCloseTo(109.5 + 0.01095 + 0.27375, 10);
  });

  it("a zero dealer fee adds nothing", () => {
    const c = computeAcquisitionCost(100, 0, { regulatoryLevyPct: 0.01, dealerFeePct: 0 });
    expect(c.dealerFee).toBe(0);
    expect(c.totalAcquisitionCost).toBeCloseTo(100.01, 10);
  });

  it("rejects negative or implausibly large charges", () => {
    expect(validateCharges({ regulatoryLevyPct: 0.01, dealerFeePct: 0 })).toBeNull();
    expect(validateCharges({ regulatoryLevyPct: -0.01, dealerFeePct: 0 })).not.toBeNull();
    expect(validateCharges({ regulatoryLevyPct: 0.01, dealerFeePct: 50 })).not.toBeNull();
    expect(validateCharges({ regulatoryLevyPct: Number.NaN, dealerFeePct: 0 })).not.toBeNull();
  });
});

describe("format helpers", () => {
  it("shortens issuer names without losing identity", () => {
    expect(issuerShortName("Bayport Savings and Loans PLC")).toBe("Bayport");
    expect(issuerShortName("Kasapreko Company PLC")).toBe("Kasapreko");
    expect(issuerShortName("Government of Ghana")).toBe("GoG");
    expect(issuerShortName("Ghana Cocoa Board")).toBe("Ghana Cocoa Board");
  });

  it("labels a security by issuer, coupon and maturity", () => {
    expect(securityShortLabel("Kasapreko Company PLC", 23.5, "2028-09-12")).toBe("Kasapreko 23.50% Sep-28");
  });

  it("states time remaining in days, months, or years", () => {
    expect(formatTimeRemaining(0)).toBe("Matured");
    expect(formatTimeRemaining(13)).toBe("13 days");
    expect(formatTimeRemaining(117)).toBe("~4 months");
    expect(formatTimeRemaining(708)).toBe("~23 months");
    expect(formatTimeRemaining(1400)).toBe("~3.8 years");
  });

  it("formats signed tenor differences", () => {
    expect(formatTenorDiff(212)).toBe("+212d");
    expect(formatTenorDiff(-511)).toBe("−1.4y");
    expect(formatTenorDiff(0)).toBe("±0d");
  });
});
