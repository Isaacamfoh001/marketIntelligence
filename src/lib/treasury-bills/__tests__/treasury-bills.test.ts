import { describe, expect, it } from "vitest";
import { priceFromYield, type BondTerms } from "../../fixed-income";
import {
  BILL_TENORS,
  billDaysToMaturity,
  billDv01PerUnitFace,
  billInterestRateFromDiscount,
  billModifiedDurationYears,
  billPriceFactor,
  billPricePer100,
  billRateFromPricePer100,
  checkBillIssued,
  interpolateReferenceRate,
  parseIsoDate,
  selectLatestCompleteCurve,
  validateBillTerms,
  type AuctionRateRow,
} from "..";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Real BoG auction of 2026-09-28 (interest rate = return on price paid).
const row = (tenorDays: number, observationDate: string, interestRatePct: number, discountRatePct = 0): AuctionRateRow => ({ tenorDays, observationDate, interestRatePct, discountRatePct, tenderNumber: "2026" });
const CURVE_ROWS = [row(91, "2026-09-28", 4.6785, 4.6244), row(182, "2026-09-28", 6.37, 6.1734), row(364, "2026-09-28", 9.8339, 8.9534)];
const curve = () => selectLatestCompleteCurve(CURVE_ROWS, "2026-10-05")!;

describe("T-bill convention — simple interest, Actual/365", () => {
  it("prices a 364-day bill at its own tenor rate (hand calculation)", () => {
    // 1 / (1 + 0.098339 × 364/365) = 0.910689…
    expect(billPriceFactor(9.8339, 364)).toBeCloseTo(1 / (1 + 0.098339 * (364 / 365)), 12);
    expect(billPricePer100(9.8339, 364)).toBeCloseTo(91.0689, 3);
  });
  it("reproduces the published BoG discount ↔ interest-rate pairs", () => {
    expect(billInterestRateFromDiscount(4.6244, 91)).toBeCloseTo(4.6785, 2);
    expect(billInterestRateFromDiscount(6.1734, 182)).toBeCloseTo(6.37, 2);
    expect(billInterestRateFromDiscount(8.9534, 364)).toBeCloseTo(9.8339, 1);
  });
  it("price from rate and rate from price are inverses", () => {
    const p = billPricePer100(7.25, 120)!;
    expect(billRateFromPricePer100(p, 120)).toBeCloseTo(7.25, 10);
  });
  it("ZERO_COUPON mismatch is real: M7 compounding gives a different price at 91 days (the reason bills do not use it)", () => {
    const zc: BondTerms = { issueDate: d("2026-09-28"), maturityDate: d("2026-12-28"), couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null, faceValue: 100 };
    const compounded = priceFromYield(zc, d("2026-09-28"), 4.6785);
    if (!compounded.ok) throw new Error("expected pricing");
    const simple = billPricePer100(4.6785, 91)!;
    expect(simple).toBeCloseTo(98.8470, 3); // matches BoG's published discount-rate price (98.84707)
    expect(compounded.dirtyPrice - simple).toBeGreaterThan(0.015); // 0.0195 points of face — compounding is not the BoG convention
  });
  it("DV01 is a positive magnitude and matches a central finite difference of the price", () => {
    const face = 1_000_000;
    const analytic = face * billDv01PerUnitFace(7.569042, 245)!;
    const up = face * billPriceFactor(7.569042 + 0.01, 245)!;
    const down = face * billPriceFactor(7.569042 - 0.01, 245)!;
    expect(analytic).toBeGreaterThan(0);
    expect(analytic).toBeCloseTo((down - up) / 2, 3);
    expect(analytic).toBeCloseTo(60.7895, 3); // independent hand calculation
  });
  it("modified duration is t/(1+rt)", () => {
    expect(billModifiedDurationYears(7.569042, 245)).toBeCloseTo(0.638779, 6);
  });
  it("is undefined (null) when the denominator would not be positive, never NaN", () => {
    expect(billPriceFactor(-500, 365)).toBeNull();
    expect(billModifiedDurationYears(-500, 365)).toBeNull();
    expect(billDv01PerUnitFace(-500, 365)).toBeNull();
    expect(billInterestRateFromDiscount(100, 365)).toBeNull();
  });
  it("zero rate prices at par; zero days is not a bill (rate-from-price null)", () => {
    expect(billPricePer100(0, 200)).toBe(100);
    expect(billRateFromPricePer100(99, 0)).toBeNull();
    expect(billRateFromPricePer100(0, 91)).toBeNull();
  });
});

describe("T-bill terms validation", () => {
  it.each(BILL_TENORS)("accepts a valid %i-day bill and derives its issue date", (tenor) => {
    const mat = d("2027-06-07");
    const r = validateBillTerms({ tenorDays: tenor, maturityDate: mat, currency: "GHS" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.terms.maturityDate.getTime() - r.terms.issueDate.getTime()).toBe(tenor * 86_400_000);
  });
  it("derives the issue date: 364 days before 2027-06-07 is 2026-06-08", () => {
    const r = validateBillTerms({ tenorDays: 364, maturityDate: d("2027-06-07") });
    expect(r.ok && r.terms.issueDate.toISOString().slice(0, 10)).toBe("2026-06-08");
  });
  it("rejects a tenor BoG does not auction", () => {
    expect(validateBillTerms({ tenorDays: 120, maturityDate: d("2027-06-07") }).ok).toBe(false);
    expect(validateBillTerms({ tenorDays: 91.5, maturityDate: d("2027-06-07") }).ok).toBe(false);
  });
  it("rejects malformed instruments: no maturity, invalid date, non-GHS, bad ISIN, inconsistent issue date", () => {
    expect(validateBillTerms({ tenorDays: 91, maturityDate: null }).ok).toBe(false);
    expect(validateBillTerms({ tenorDays: 91, maturityDate: new Date("nope") }).ok).toBe(false);
    expect(validateBillTerms({ tenorDays: 91, maturityDate: d("2027-01-04"), currency: "USD" }).ok).toBe(false);
    expect(validateBillTerms({ tenorDays: 91, maturityDate: d("2027-01-04"), isin: "not-an-isin" }).ok).toBe(false);
    expect(validateBillTerms({ tenorDays: 91, maturityDate: d("2027-01-04"), isin: "GHGOVT000012" }).ok).toBe(true);
    expect(validateBillTerms({ tenorDays: 91, maturityDate: d("2027-01-04"), issueDate: d("2026-10-01") }).ok).toBe(false);
  });
  it("parseIsoDate rejects impossible dates", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("07/06/2027")).toBeNull();
    expect(parseIsoDate("2027-06-07")?.toISOString()).toBe("2027-06-07T00:00:00.000Z");
  });
  it("a bill that would not yet have been issued is rejected", () => {
    const t = validateBillTerms({ tenorDays: 91, maturityDate: d("2027-03-01") });
    if (!t.ok) throw new Error("terms");
    expect(checkBillIssued(t.terms, d("2026-10-05")).ok).toBe(false);
    const ok = validateBillTerms({ tenorDays: 91, maturityDate: d("2026-12-07") });
    if (!ok.ok) throw new Error("terms");
    expect(checkBillIssued(ok.terms, d("2026-10-05")).ok).toBe(true);
  });
  it("day-count: whole calendar days, zero/negative once matured", () => {
    expect(billDaysToMaturity(d("2027-06-07"), d("2026-10-05"))).toBe(245);
    expect(billDaysToMaturity(d("2026-10-05"), d("2026-10-05"))).toBe(0);
    expect(billDaysToMaturity(d("2026-10-01"), d("2026-10-05"))).toBe(-4);
  });
});

describe("reference curve and rate", () => {
  it("selects the latest COMPLETE curve at or before the valuation date", () => {
    const rows = [...CURVE_ROWS, row(91, "2026-10-05", 4.7), row(182, "2026-10-05", 6.4)]; // 364 missing on 10-05
    expect(selectLatestCompleteCurve(rows, "2026-10-05")!.observationDate).toBe("2026-09-28");
    expect(selectLatestCompleteCurve(rows, "2026-09-27")).toBeNull(); // nothing on/before
  });
  it("never uses a row dated after the valuation date", () => {
    expect(selectLatestCompleteCurve(CURVE_ROWS, "2026-09-27")).toBeNull();
  });
  it("returns null (not a partial curve) when no complete curve exists", () => {
    expect(selectLatestCompleteCurve([row(91, "2026-09-28", 4.6785), row(182, "2026-09-28", 6.37)], "2026-10-05")).toBeNull();
    expect(selectLatestCompleteCurve([], "2026-10-05")).toBeNull();
  });
  it("exact tenor uses the node directly", () => {
    const r = interpolateReferenceRate(curve(), 182)!;
    expect(r).toMatchObject({ ratePct: 6.37, method: "EXACT_TENOR" });
  });
  it("interpolates linearly between nodes (hand calculation)", () => {
    const r = interpolateReferenceRate(curve(), 245)!;
    expect(r.method).toBe("INTERPOLATED");
    expect(r.ratePct).toBeCloseTo(7.569042307692308, 12);
    expect(r.nodes.map((n) => n.tenorDays)).toEqual([182, 364]);
    expect(interpolateReferenceRate(curve(), 98)!.ratePct).toBeCloseTo(4.808615384615385, 12);
  });
  it("below the shortest tenor the 91-day rate is held flat and says so", () => {
    const r = interpolateReferenceRate(curve(), 63)!;
    expect(r).toMatchObject({ ratePct: 4.6785, method: "SHORT_END_FLAT" });
    expect(r.description).toMatch(/extrapolation/);
  });
  it("refuses to extrapolate beyond 364 days and rejects non-positive days", () => {
    expect(interpolateReferenceRate(curve(), 365)).toBeNull();
    expect(interpolateReferenceRate(curve(), 0)).toBeNull();
    expect(interpolateReferenceRate(curve(), -3)).toBeNull();
  });
});
