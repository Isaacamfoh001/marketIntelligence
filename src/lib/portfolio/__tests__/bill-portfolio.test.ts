import { describe, expect, it } from "vitest";
import { observationFreshness } from "../../freshness";
import { selectLatestCompleteCurve, type AuctionCurve, type AuctionRateRow } from "../../treasury-bills";
import {
  BILL_RECENT_WINDOW_DAYS,
  BOND_RECENT_WINDOW_DAYS,
  checkBillAddable,
  computeExposures,
  EXPOSURE_ASSET_CLASS_ORDER,
  findExistingPosition,
  resolveBillValuationInput,
  resolveIssuerRef,
  summarizePortfolio,
  validatePositionDraft,
  valueBillPosition,
  valueBondPosition,
  type BillValuationInput,
  type ExposurePosition,
  type PositionHolding,
  type PositionValuation,
} from "..";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VAL = d("2026-10-05");
const row = (tenorDays: number, observationDate: string, interestRatePct: number): AuctionRateRow => ({ tenorDays, observationDate, interestRatePct, discountRatePct: 0, tenderNumber: "2026" });
const CURVE: AuctionCurve = selectLatestCompleteCurve([row(91, "2026-09-28", 4.6785), row(182, "2026-09-28", 6.37), row(364, "2026-09-28", 9.8339)], "2026-10-05")!;
const OLD_CURVE: AuctionCurve = selectLatestCompleteCurve([row(91, "2026-08-10", 4.6785), row(182, "2026-08-10", 6.37), row(364, "2026-08-10", 9.8339)], "2026-10-05")!;

const src = (maturity: string, tenorDays: number, over: Partial<Parameters<typeof resolveBillValuationInput>[0]> = {}) => ({
  currency: "GHS",
  tenorDays,
  issueDate: new Date(d(maturity).getTime() - tenorDays * 86_400_000),
  maturityDate: d(maturity),
  curve: CURVE as AuctionCurve | null,
  ...over,
});
const billIn = (maturity: string, tenor: number, over = {}): BillValuationInput => {
  const r = resolveBillValuationInput(src(maturity, tenor, over), VAL);
  if (!r.available) throw new Error(r.reason);
  return r;
};
const valued = (v: PositionValuation) => {
  if (v.status !== "VALUED") throw new Error(`unvalued: ${v.reason}`);
  return v;
};

describe("resolveBillValuationInput", () => {
  it("values a 364-day bill with 245 days left from the interpolated auction rate", () => {
    const i = billIn("2027-06-07", 364);
    expect(i).toMatchObject({ daysToMaturity: 245, method: "INTERPOLATED", observationDate: "2026-09-28", ageDays: 7, recency: "RECENT" });
    expect(i.referenceRatePct).toBeCloseTo(7.569042307692308, 10);
  });
  it("valid 182-day bill", () => expect(billIn("2027-01-11", 182)).toMatchObject({ daysToMaturity: 98, method: "INTERPOLATED" }));
  it("valid 91-day bill (63 days left → 91-day rate held flat, disclosed)", () => {
    const i = billIn("2026-12-07", 91);
    expect(i).toMatchObject({ daysToMaturity: 63, method: "SHORT_END_FLAT", referenceRatePct: 4.6785 });
    expect(i.methodDescription).toMatch(/extrapolation/);
  });
  it("stale auction curve is still used but labelled STALE with its age", () => {
    const i = billIn("2027-06-07", 364, { curve: OLD_CURVE });
    expect(i).toMatchObject({ recency: "STALE", ageDays: 56, observationDate: "2026-08-10" });
  });
  it("missing rate evidence → unavailable (never zero)", () => {
    const r = resolveBillValuationInput(src("2027-06-07", 364, { curve: null }), VAL);
    expect(r).toMatchObject({ available: false, code: "NO_REFERENCE_RATE" });
  });
  it("matured bill → unavailable MATURED, with the contractual-payment explanation and no reinvestment", () => {
    const r = resolveBillValuationInput(src("2026-10-01", 91), VAL);
    expect(r).toMatchObject({ available: false, code: "MATURED" });
    expect(!r.available && r.reason).toMatch(/face value/);
    expect(!r.available && r.reason).toMatch(/reinvestment/);
  });
  it("valuation exactly ON the maturity date is matured (zero days remain)", () => {
    expect(resolveBillValuationInput(src("2026-10-05", 91), VAL)).toMatchObject({ available: false, code: "MATURED" });
  });
  it("one day to maturity is still live (negative/zero days are the only matured states)", () => {
    expect(resolveBillValuationInput(src("2026-10-06", 91), VAL)).toMatchObject({ available: true, daysToMaturity: 1 });
  });
  it("non-GHS bill is not valued", () => {
    expect(resolveBillValuationInput(src("2027-06-07", 364, { currency: "USD" }), VAL)).toMatchObject({ available: false, code: "NOT_GHS" });
  });
  it("the bill recency window equals the weekly-auction freshness rule used by the platform", () => {
    expect(BILL_RECENT_WINDOW_DAYS).toBe(BOND_RECENT_WINDOW_DAYS);
    const at = (days: number) => observationFreshness("WEEKLY", new Date(VAL.getTime() - days * 86_400_000), VAL);
    expect(at(BILL_RECENT_WINDOW_DAYS)).toBe("CURRENT");
    expect(at(BILL_RECENT_WINDOW_DAYS + 1)).toBe("STALE");
  });
});

describe("valueBillPosition — hand calculation (face 1,000,000; 245 days; 7.569042%)", () => {
  const v = valued(valueBillPosition(1_000_000, billIn("2027-06-07", 364), VAL));
  it("Reference value = 951,650.54", () => expect(v.referenceValueGhs).toBe(951_650.54));
  it("exposes every field needed to reproduce it", () => {
    if (v.detail.assetClass !== "TREASURY_BILL") throw new Error("detail");
    expect(v.detail).toMatchObject({ faceValueGhs: 1_000_000, daysToMaturity: 245, rateObservationDate: "2026-09-28", valuationDate: "2026-10-05", method: "INTERPOLATED", convention: "Simple interest, Actual/365" });
    expect(v.detail.referenceRatePct).toBeCloseTo(7.569042307692308, 10);
    expect(v.detail.referencePricePer100).toBeCloseTo(95.165054, 5);
    expect(v.detail.remainingDiscountGhs).toBe(48_349.46);
    expect(v.detail.dv01Ghs).toBeCloseTo(60.7895, 3);
    expect(v.detail.modifiedDurationYears).toBeCloseTo(0.638779, 6);
    expect(v.detail.formula).toMatch(/365/);
    expect(v.detail.nodes.map((n) => n.tenorDays)).toEqual([182, 364]);
  });
  it("carries the auction date and age as the input date/age and the recency", () => {
    expect(v).toMatchObject({ inputDate: "2026-09-28", inputAgeDays: 7, recency: "RECENT" });
  });
  it("182- and 91-day examples match independent calculations", () => {
    expect(valued(valueBillPosition(1_000_000, billIn("2027-01-11", 182), VAL)).referenceValueGhs).toBe(987_253.76);
    expect(valued(valueBillPosition(1_000_000, billIn("2026-12-07", 91), VAL)).referenceValueGhs).toBe(991_989.47);
  });
  it("reference value is always below face for a live bill at a positive rate (face value handled separately)", () => {
    expect(v.referenceValueGhs).toBeLessThan(1_000_000);
  });
  it("face value scales the value linearly; the rate does not depend on size", () => {
    const double = valued(valueBillPosition(2_000_000, billIn("2027-06-07", 364), VAL));
    expect(double.referenceValueGhs).toBeCloseTo(2 * 951_650.54, 1);
  });
  it("unvalued input passes through as UNVALUED with its reason (not a zero)", () => {
    const u = valueBillPosition(1_000_000, resolveBillValuationInput(src("2027-06-07", 364, { curve: null }), VAL), VAL);
    expect(u).toMatchObject({ status: "UNVALUED", assetClass: "TREASURY_BILL", code: "NO_REFERENCE_RATE" });
  });
});

describe("disclosure wording (methodology review)", () => {
  it("labels the basis as interpolated and indicative, and the assumption says what is NOT observed", async () => {
    const { BILL_BASIS_LABEL, BILL_ASSUMPTION } = await import("..");
    expect(BILL_BASIS_LABEL).toBe("Interpolated BoG auction rate (indicative)");
    const text = BILL_ASSUMPTION("28 Sept 2026", "5 Oct 2026");
    expect(text).toMatch(/only for NEW 91-, 182- and 364-day bills/);
    expect(text).toMatch(/no secondary-market quote/);
    expect(text).toMatch(/indicative, not a market price/);
    expect(text).not.toMatch(/comparable/i);
  });
});

describe("position validation (face amount semantics)", () => {
  const ok = (n: number) => validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: n, currency: "GHS" });
  it("accepts a positive GHS face amount with ≤ 2 decimals", () => expect(ok(1_000_000.5)).toEqual({ ok: true, assetClass: "TREASURY_BILL", faceValueGhs: 1_000_000.5 }));
  it("rejects zero face value, negative, NaN, sub-cent, implausible", () => {
    for (const n of [0, -1, Number.NaN, 100.001, 1e16]) expect(ok(n).ok).toBe(false);
  });
  it("rejects shares and non-GHS", () => {
    expect(validatePositionDraft({ assetClass: "TREASURY_BILL", shares: 5, nominalGhs: 100, currency: "GHS" }).ok).toBe(false);
    expect(validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: 100, currency: "USD" }).ok).toBe(false);
  });
  it("requires no purchase information", () => {
    expect(validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: 100, currency: "GHS" }).ok).toBe(true);
  });
  it("one position per bill per portfolio", () => {
    const held: PositionHolding[] = [{ assetClass: "TREASURY_BILL", positionId: "p1", treasuryBillId: "bill-1", faceValueGhs: 10 }];
    expect(findExistingPosition(held, { assetClass: "TREASURY_BILL", treasuryBillId: "bill-1" })?.positionId).toBe("p1");
    expect(findExistingPosition(held, { assetClass: "TREASURY_BILL", treasuryBillId: "bill-2" })).toBeNull();
    expect(findExistingPosition(held, { assetClass: "BOND", fixedIncomeSecurityId: "bill-1" })).toBeNull();
  });
  it("a matured bill cannot be added; a live one can", () => {
    expect(checkBillAddable({ currency: "GHS", maturityDate: d("2026-10-05") }, VAL).addable).toBe(false);
    expect(checkBillAddable({ currency: "GHS", maturityDate: d("2026-10-06") }, VAL).addable).toBe(true);
    expect(checkBillAddable({ currency: "USD", maturityDate: d("2027-01-01") }, VAL).addable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M8.2 exposures with bills
// ---------------------------------------------------------------------------
const GOV = resolveIssuerRef({ companyId: null, issuerName: "Government of Ghana" });
const billPos = (id: string, maturity: string, tenor: number, face: number, over: Partial<ExposurePosition> = {}, curve: AuctionCurve | null = CURVE): ExposurePosition => ({
  positionId: id,
  label: `${tenor}-day T-bill · ${maturity}`,
  assetClass: "TREASURY_BILL",
  issuer: GOV,
  valuation: valueBillPosition(face, resolveBillValuationInput(src(maturity, tenor, { curve }), VAL), VAL),
  bond: null,
  bill: { faceValueGhs: face, currency: "GHS", tenorDays: tenor, issueDate: new Date(d(maturity).getTime() - tenor * 86_400_000), maturityDate: d(maturity) },
  ...over,
});
const bondTerms = { issueDate: d("2024-07-01"), maturityDate: d("2034-07-01"), couponType: "FIXED" as const, couponRatePct: 20, couponFrequency: "SEMI_ANNUAL" as const, faceValue: 100 };
const govBond = (): ExposurePosition => ({
  positionId: "bond",
  label: "GoG Jul-34",
  assetClass: "GOVERNMENT_BOND",
  issuer: GOV,
  valuation: valueBondPosition(2_000_000, bondTerms, { available: true, assetClass: "BOND", observedYtmPct: 28, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: null, yieldFromSourceQuote: true, pendingReview: null }, VAL),
  bond: { nominalGhs: 2_000_000, currency: "GHS", status: "ACTIVE", terms: bondTerms, maturityConflict: false, couponConflict: false },
});
const expo = (ps: ExposurePosition[]) => computeExposures(ps, summarizePortfolio(ps.map((p) => p.valuation), VAL), VAL);

describe("exposures — Treasury bills", () => {
  const ps = [billPos("b364", "2027-06-07", 364, 1_000_000), billPos("b91", "2026-12-07", 91, 500_000), govBond()];
  const e = expo(ps);

  it("Treasury bills are their own asset class, first in order, and not merged into government bonds", () => {
    expect(EXPOSURE_ASSET_CLASS_ORDER[0]).toBe("TREASURY_BILL");
    const row = e.allocation.rows.find((r) => r.assetClass === "TREASURY_BILL")!;
    expect(row.label).toBe("Treasury bills");
    expect(row.valuedCount).toBe(2);
    expect(row.referenceValueGhs).toBeCloseTo(951_650.54 + 495_994.74, 1);
    expect(e.allocation.rows.find((r) => r.assetClass === "GOVERNMENT_BOND")!.valuedCount).toBe(1);
  });
  it("allocation percentages sum to 100 over the valued total", () => {
    expect(e.allocation.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
  });
  it("Government T-bills and Government bonds aggregate under one sovereign issuer", () => {
    const gov = e.issuers.rows.find((r) => r.issuer.key === GOV.key)!;
    expect(gov.pct).toBeCloseTo(100, 9);
    expect(gov.assetClasses).toEqual(["TREASURY_BILL", "GOVERNMENT_BOND"]);
    expect(gov.valuedCount).toBe(3);
  });
  it("maturity ladder uses each bill's actual maturity (face value, one payment)", () => {
    const lt1 = e.maturity.buckets.find((b) => b.key === "LT_1Y")!;
    expect(lt1.nominalGhs).toBe(1_500_000);
    expect(lt1.treasuryBillFaceGhs).toBe(1_500_000);
    expect(lt1.positionCount).toBe(2);
    expect(e.maturity.buckets.find((b) => b.key === "GT_5Y")!.nominalGhs).toBe(2_000_000);
    expect(e.maturity.treasuryBillPositionCount).toBe(2);
    expect(e.maturity.eligibleNominalGhs).toBe(3_500_000);
  });
  it("contractual cash flow: a bill has no coupon (bond coupon total is unchanged by bills)", () => {
    expect(e.coupon.annualCouponGhs).toBe(400_000);
    expect(e.coupon.rows.map((r) => r.positionId)).toEqual(["bond"]);
    expect(e.coupon.bondPositionCount).toBe(1);
  });
  it("upcoming maturities include bills, ordered by maturity date, at face amount", () => {
    expect(e.upcoming.map((u) => [u.positionId, u.assetClass, u.nominalGhs])).toEqual([["b91", "TREASURY_BILL", 500_000], ["b364", "TREASURY_BILL", 1_000_000], ["bond", "GOVERNMENT_BOND", 2_000_000]]);
    expect(e.upcoming[0].daysRemaining).toBe(63);
  });
  it("rate sensitivity: bill DV01 is separate from the bond DV01 and uses the bill formula", () => {
    const b = e.rates.treasuryBills;
    expect(b.billPositionCount).toBe(2);
    expect(b.dv01Ghs).toBeCloseTo(60.79 + 8.49, 2);
    expect(b.contributors.map((c) => c.positionId)).toEqual(["b364", "b91"]);
    expect(b.contributors[0]).toMatchObject({ daysToMaturity: 245 });
    expect(b.contributors[0].modifiedDurationYears).toBeCloseTo(0.638779, 6);
    expect(e.rates.contributors.map((c) => c.positionId)).toEqual(["bond"]); // bills never enter the coupon-bond sleeve
    expect(e.rates.coverage.bondPositionCount).toBe(1);
  });
  it("an unvalued bill is excluded from value analytics but still on the contractual ladder, never counted as zero", () => {
    const unv = billPos("x", "2027-06-07", 364, 1_000_000, {}, null);
    const e2 = expo([unv, govBond()]);
    expect(e2.allocation.rows.some((r) => r.assetClass === "TREASURY_BILL")).toBe(false);
    expect(e2.allocation.unvalued.byClass.find((c) => c.assetClass === "TREASURY_BILL")?.count).toBe(1);
    expect(e2.maturity.buckets.find((b) => b.key === "LT_1Y")!.unvaluedNominalGhs).toBe(1_000_000);
    expect(e2.rates.treasuryBills.dv01Ghs).toBeNull();
    expect(e2.rates.treasuryBills.excluded[0].reason).toMatch(/No complete Bank of Ghana auction curve/);
  });
  it("a matured bill is left off the ladder with a reason, and is unvalued", () => {
    const m = billPos("m", "2026-10-01", 91, 1_000_000);
    const e3 = expo([m]);
    expect(m.valuation.status).toBe("UNVALUED");
    expect(e3.maturity.eligibleCount).toBe(0);
    expect(e3.maturity.excluded[0]).toMatchObject({ positionId: "m", code: "MATURED" });
    expect(e3.upcoming).toHaveLength(0);
  });
  it("stale-input propagation: a stale curve marks the bill and the allocation stale value", () => {
    const stale = billPos("s", "2027-06-07", 364, 1_000_000, {}, OLD_CURVE);
    const e4 = expo([stale]);
    expect(e4.allocation.rows[0].staleValueGhs).toBeCloseTo(e4.allocation.rows[0].referenceValueGhs, 6);
    expect(e4.rates.treasuryBills.contributors[0].recency).toBe("STALE");
  });
  it("callouts mention the Treasury-bill share when bills are not the largest class", () => {
    expect(e.callouts.some((c) => /^Treasury bills are \d+(\.\d)?% of valued reference value\.$/.test(c))).toBe(true);
  });
});
