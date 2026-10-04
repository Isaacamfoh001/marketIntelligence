import { describe, it, expect } from "vitest";
import { buildSecurityAnalytics } from "../security-analytics";
import type { BondTerms } from "../types";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const BOND: BondTerms = {
  issueDate: d("2024-06-15"),
  maturityDate: d("2028-06-15"),
  couponType: "FIXED",
  couponRatePct: 20,
  couponFrequency: "SEMI_ANNUAL",
  faceValue: 100,
};

describe("buildSecurityAnalytics", () => {
  const settlement = d("2025-06-15");

  it("solves YTM from a clean price observation", () => {
    const result = buildSecurityAnalytics(BOND, { observationDate: settlement, cleanPrice: 95, sourceYieldPct: null, observationKind: "SECONDARY_MARKET" }, settlement);
    expect(result.ytmSource).toBe("SOLVED_FROM_PRICE");
    expect(result.ytmPct).not.toBeNull();
    expect(result.ytmPct!).toBeGreaterThan(20); // below par -> YTM above coupon
    expect(result.currentYieldPct).not.toBeNull();
    expect(result.macaulayDurationYears).not.toBeNull();
    expect(result.dv01).not.toBeNull();
    expect(result.observationKind).toBe("SECONDARY_MARKET");
  });

  it("uses a source-quoted yield directly when no price is given, without computing current yield", () => {
    const result = buildSecurityAnalytics(BOND, { observationDate: settlement, cleanPrice: null, sourceYieldPct: 23.5, observationKind: "AUCTION_PRIMARY" }, settlement);
    expect(result.ytmSource).toBe("SOURCE_QUOTED");
    expect(result.ytmPct).toBe(23.5);
    expect(result.currentYieldPct).toBeNull();
    expect(result.dirtyPrice).toBeNull();
    expect(result.macaulayDurationYears).not.toBeNull(); // duration still computable from yield alone
    expect(result.observationKind).toBe("AUCTION_PRIMARY");
  });

  it("is MATURED once past maturity, regardless of observation presence", () => {
    const result = buildSecurityAnalytics(BOND, { observationDate: settlement, cleanPrice: 95, sourceYieldPct: null, observationKind: "SECONDARY_MARKET" }, d("2028-06-15"));
    expect(result.isMatured).toBe(true);
    expect(result.unavailableReason).toBe("MATURED");
    expect(result.ytmPct).toBeNull();
  });

  it("is MISSING_MARKET_DATA when there is no observation at all, but still reports tenorDays", () => {
    const result = buildSecurityAnalytics(BOND, null, settlement);
    expect(result.unavailableReason).toBe("MISSING_MARKET_DATA");
    expect(result.tenorDays).toBeGreaterThan(0);
    expect(result.ytmPct).toBeNull();
  });
});
