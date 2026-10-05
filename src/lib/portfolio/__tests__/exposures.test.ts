import { describe, expect, it } from "vitest";
import {
  approximateDv01FromModifiedDuration,
  computeDuration,
  priceFromYield,
  type BondTerms,
} from "../../fixed-income";
import {
  checkCouponEligibility,
  checkMaturityEligibility,
  computeExposures,
  maturityBucketOf,
  resolveIssuerRef,
  summarizePortfolio,
  valueBondPosition,
  valueEquityPosition,
  type BondContractFacts,
  type BondValuationInput,
  type EquityValuationInput,
  type ExposureAssetClass,
  type ExposurePosition,
  type PositionValuation,
  type Unvalued,
} from "..";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VAL = d("2026-10-05");

const terms = (maturity: string, over: Partial<BondTerms> = {}): BondTerms => ({
  issueDate: d("2022-01-15"),
  maturityDate: d(maturity),
  couponType: "FIXED",
  couponRatePct: 20,
  couponFrequency: "SEMI_ANNUAL",
  faceValue: 100,
  ...over,
});

const bondInput = (ytm: number, over: Partial<BondValuationInput> = {}): BondValuationInput => ({
  available: true,
  assetClass: "BOND",
  observedYtmPct: ytm,
  observationDate: "2026-10-01",
  ageDays: 4,
  recency: "RECENT",
  observedCleanPrice: null,
  yieldFromSourceQuote: true,
  pendingReview: null,
  ...over,
});

const eqInput = (price: number, over: Partial<EquityValuationInput> = {}): EquityValuationInput => ({
  available: true,
  assetClass: "EQUITY",
  priceGhs: price,
  priceDate: "2026-10-02",
  ageDays: 3,
  recency: "RECENT",
  volume: 1000,
  valueTradedGhs: null,
  isActualTrade: true,
  latestReportDate: "2026-10-02",
  skippedNoTradeRows: 0,
  ...over,
});

const GOG = { companyId: null, issuerName: "Government of Ghana" };
const NO_INPUT: Unvalued = { available: false, code: "NO_OBSERVATION", reason: "No market observation has been imported for this bond." };

interface BondOpts {
  id: string;
  label?: string;
  cls?: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  nominal: number;
  maturity: string;
  coupon?: number;
  freq?: BondTerms["couponFrequency"];
  ytm?: number | null; // null → unvalued
  recency?: "RECENT" | "STALE";
  facts?: Partial<BondContractFacts>;
  termsOver?: Partial<BondTerms>;
}

function bond(o: BondOpts): ExposurePosition {
  const t = terms(o.maturity, { couponRatePct: o.coupon ?? 20, couponFrequency: o.freq ?? "SEMI_ANNUAL", ...o.termsOver });
  const cls = o.cls ?? "GOVERNMENT_BOND";
  const valuation: PositionValuation =
    o.ytm === null || o.ytm === undefined
      ? valueBondPosition(o.nominal, t, NO_INPUT, VAL)
      : valueBondPosition(o.nominal, t, bondInput(o.ytm, { recency: o.recency ?? "RECENT" }), VAL);
  return {
    positionId: o.id,
    label: o.label ?? o.id,
    assetClass: cls,
    issuer: resolveIssuerRef(GOG),
    valuation,
    bond: { nominalGhs: o.nominal, currency: "GHS", status: "ACTIVE", terms: t, maturityConflict: false, couponConflict: false, ...o.facts },
  };
}

const KAS = { companyId: "co-kas", issuerName: "Kasapreko Company PLC" };
const withIssuer = (p: ExposurePosition, issuer: { companyId: string | null; issuerName: string }): ExposurePosition => ({ ...p, issuer: resolveIssuerRef(issuer) });

function equity(id: string, shares: number, price: number | null, issuer = { companyId: "co-eq", issuerName: "Equity Co" }, recency: "RECENT" | "STALE" = "RECENT"): ExposurePosition {
  return {
    positionId: id,
    label: id,
    assetClass: "EQUITY" as ExposureAssetClass,
    issuer: resolveIssuerRef(issuer),
    valuation: price === null ? valueEquityPosition(shares, { available: false, code: "NO_TRADE", reason: "No trade" }) : valueEquityPosition(shares, eqInput(price, { recency })),
    bond: null,
  };
}

const gov = (o: BondOpts) => withIssuer(bond({ ...o, cls: "GOVERNMENT_BOND" }), GOG);
const corp = (o: BondOpts, issuer = KAS) => withIssuer(bond({ ...o, cls: "CORPORATE_BOND" }), issuer);

const run = (ps: ExposurePosition[]) => computeExposures(ps, summarizePortfolio(ps.map((p) => p.valuation), VAL), VAL);

const valueOf = (p: ExposurePosition) => (p.valuation.status === "VALUED" ? p.valuation.referenceValueGhs : 0);

// ---------------------------------------------------------------------------

describe("issuer resolution", () => {
  it("uses the Company entity when linked, so a company's bond and equity share one key", () => {
    expect(resolveIssuerRef({ companyId: "c1", issuerName: "Kasapreko Company PLC" }).key).toBe(resolveIssuerRef({ companyId: "c1", issuerName: "KAS" }).key);
  });
  it("falls back to the normalised name (Government of Ghana is one issuer however it is spaced/cased)", () => {
    expect(resolveIssuerRef({ companyId: null, issuerName: "Government of Ghana" }).key).toBe(resolveIssuerRef({ companyId: null, issuerName: "  government  of ghana " }).key);
  });
  it("uses an explicit Unknown issuer bucket rather than losing value", () => {
    expect(resolveIssuerRef({ companyId: null, issuerName: "  " })).toEqual({ key: "unknown", name: "Unknown issuer" });
  });
});

describe("asset allocation (valued reference value)", () => {
  const mixed = () => [gov({ id: "G1", nominal: 6_000_000, maturity: "2034-07-15", ytm: 21 }), corp({ id: "C1", nominal: 2_000_000, maturity: "2028-09-10", ytm: 24 }), equity("EQ1", 10_000, 50)];

  it("splits by class over the valued reference value, in fixed class order", () => {
    const ps = mixed();
    const e = run(ps);
    const total = ps.reduce((s, p) => s + valueOf(p), 0);
    expect(e.allocation.rows.map((r) => r.assetClass)).toEqual(["GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"]);
    expect(e.allocation.rows[0].pct).toBeCloseTo((valueOf(ps[0]) / total) * 100, 9);
    expect(e.allocation.rows[2].referenceValueGhs).toBe(500_000);
    expect(e.allocation.denominatorGhs).toBeCloseTo(total, 2);
  });

  it("INVARIANT: Σ class value == valued portfolio value, and percentages sum to 100", () => {
    const ps = mixed();
    const e = run(ps);
    const summary = summarizePortfolio(ps.map((p) => p.valuation), VAL);
    expect(Math.round(e.allocation.rows.reduce((s, r) => s + r.referenceValueGhs, 0) * 100)).toBe(Math.round((summary.referenceValueGhs as number) * 100));
    expect(e.allocation.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
  });

  it("one class only still produces a sensible 100% row", () => {
    const e = run([equity("EQ1", 100, 10)]);
    expect(e.allocation.rows).toHaveLength(1);
    expect(e.allocation.rows[0].pct).toBeCloseTo(100, 9);
  });

  it("partially valued: the unvalued position is excluded and counted separately, never given a share", () => {
    const ps = [...mixed(), corp({ id: "C2", nominal: 2_000_000, maturity: "2030-01-10", ytm: null })];
    const e = run(ps);
    expect(e.allocation.unvalued).toEqual({ count: 1, byClass: [{ assetClass: "CORPORATE_BOND", label: "Corporate bonds", count: 1 }] });
    const corpRow = e.allocation.rows.find((r) => r.assetClass === "CORPORATE_BOND")!;
    expect(corpRow.valuedCount).toBe(1);
    expect(corpRow.unvaluedCount).toBe(1);
    expect(e.allocation.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
  });

  it("zero valued positions → no rows, null denominator", () => {
    const e = run([corp({ id: "C2", nominal: 1_000_000, maturity: "2030-01-10", ytm: null }), equity("EQ", 10, null)]);
    expect(e.allocation.rows).toEqual([]);
    expect(e.allocation.denominatorGhs).toBeNull();
    expect(e.allocation.unvalued.count).toBe(2);
  });

  it("tracks the stale part of each class", () => {
    const e = run([gov({ id: "G1", nominal: 1_000_000, maturity: "2030-01-15", ytm: 20, recency: "STALE" }), gov({ id: "G2", nominal: 1_000_000, maturity: "2031-01-15", ytm: 20 })]);
    const row = e.allocation.rows[0];
    expect(row.staleValueGhs).toBeGreaterThan(0);
    expect(row.staleValueGhs).toBeLessThan(row.referenceValueGhs);
  });
});

describe("issuer concentration", () => {
  it("aggregates multiple positions of one issuer and ranks descending", () => {
    const ps = [gov({ id: "G1", nominal: 3_000_000, maturity: "2034-07-15", ytm: 21 }), gov({ id: "G2", nominal: 1_000_000, maturity: "2032-03-15", ytm: 21 }), corp({ id: "C1", nominal: 500_000, maturity: "2028-09-10", ytm: 24 })];
    const e = run(ps);
    expect(e.issuers.rows.map((r) => r.issuer.name)).toEqual(["Government of Ghana", "Kasapreko Company PLC"]);
    expect(e.issuers.rows[0].valuedCount).toBe(2);
    expect(e.issuers.rows[0].referenceValueGhs).toBeCloseTo(valueOf(ps[0]) + valueOf(ps[1]), 2);
  });

  it("aggregates one Company across a bond and an equity (same companyId) as ONE issuer", () => {
    const ps = [corp({ id: "C1", nominal: 1_000_000, maturity: "2028-09-10", ytm: 24 }), equity("KAS", 1000, 5, { companyId: "co-kas", issuerName: "KAS" })];
    const e = run(ps);
    expect(e.issuers.rows).toHaveLength(1);
    expect(e.issuers.rows[0].assetClasses).toEqual(["CORPORATE_BOND", "EQUITY"]);
    expect(e.issuers.rows[0].issuer.name).toBe("Kasapreko Company PLC");
    expect(e.issuers.rows[0].pct).toBeCloseTo(100, 9);
  });

  it("INVARIANT: Σ issuer value == valued portfolio value", () => {
    const ps = [gov({ id: "G1", nominal: 3_000_000, maturity: "2034-07-15", ytm: 21 }), corp({ id: "C1", nominal: 500_000, maturity: "2028-09-10", ytm: 24 }), equity("EQ", 100, 7)];
    const e = run(ps);
    const sumCents = e.issuers.rows.reduce((s, r) => s + Math.round(r.referenceValueGhs * 100), 0);
    expect(sumCents).toBe(ps.reduce((s, p) => s + Math.round(valueOf(p) * 100), 0));
    expect(e.issuers.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
  });

  it("an unvalued position adds NO value to its issuer — it is reported as an additional unvalued position", () => {
    const ps = [corp({ id: "C1", nominal: 1_000_000, maturity: "2028-09-10", ytm: 24 }), corp({ id: "C2", nominal: 2_000_000, maturity: "2029-09-10", ytm: null }), gov({ id: "G1", nominal: 1_000_000, maturity: "2030-07-15", ytm: 21 })];
    const e = run(ps);
    const kas = e.issuers.rows.find((r) => r.issuer.name.startsWith("Kasapreko"))!;
    expect(kas.valuedCount).toBe(1);
    expect(kas.unvaluedCount).toBe(1);
    expect(kas.referenceValueGhs).toBeCloseTo(valueOf(ps[0]), 2);
  });

  it("an issuer whose positions are all unvalued has no share, only an unvalued note", () => {
    const e = run([corp({ id: "C2", nominal: 2_000_000, maturity: "2029-09-10", ytm: null }), gov({ id: "G1", nominal: 1_000_000, maturity: "2030-07-15", ytm: 21 })]);
    expect(e.issuers.rows.map((r) => r.issuer.name)).toEqual(["Government of Ghana"]);
    expect(e.issuers.unvaluedOnly).toEqual([{ issuer: expect.objectContaining({ name: "Kasapreko Company PLC" }), unvaluedCount: 1 }]);
  });

  it("missing issuer lands in an Unknown issuer bucket and keeps its value", () => {
    const p = { ...equity("EQ", 100, 10), issuer: resolveIssuerRef({ companyId: null, issuerName: null }) };
    const e = run([p]);
    expect(e.issuers.rows[0].issuer.name).toBe("Unknown issuer");
    expect(e.issuers.rows[0].referenceValueGhs).toBe(1000);
  });

  it("breaks value ties by name for a deterministic order", () => {
    const a = equity("A", 10, 10, { companyId: "a", issuerName: "Bravo" });
    const b = equity("B", 10, 10, { companyId: "b", issuerName: "Alpha" });
    expect(run([a, b]).issuers.rows.map((r) => r.issuer.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("maturity bucket boundaries (calendar-anniversary, V = 2026-10-05)", () => {
  const b = (iso: string) => maturityBucketOf(d(iso), VAL);
  it("the day before the 1y anniversary is <1y; the anniversary itself is 1–3y", () => {
    expect(b("2027-10-04")).toBe("LT_1Y");
    expect(b("2027-10-05")).toBe("Y1_3");
  });
  it("just below / exactly 3y", () => {
    expect(b("2029-10-04")).toBe("Y1_3");
    expect(b("2029-10-05")).toBe("Y3_5");
  });
  it("just below / exactly 5y", () => {
    expect(b("2031-10-04")).toBe("Y3_5");
    expect(b("2031-10-05")).toBe("GT_5Y");
  });
  it("matures tomorrow is <1y; maturing today or earlier is not bucketed", () => {
    expect(b("2026-10-06")).toBe("LT_1Y");
    expect(b("2026-10-05")).toBeNull();
    expect(b("2026-10-04")).toBeNull();
  });
  it("29 Feb valuation date uses clamped anniversaries", () => {
    const leap = d("2028-02-29");
    expect(maturityBucketOf(d("2029-02-27"), leap)).toBe("LT_1Y");
    expect(maturityBucketOf(d("2029-02-28"), leap)).toBe("Y1_3"); // 29 Feb 2028 + 12m clamps to 28 Feb 2029
  });
});

describe("maturity ladder (contractual nominal)", () => {
  const ps = () => [
    gov({ id: "G<1", nominal: 1_000_000, maturity: "2027-06-15", ytm: 20 }),
    gov({ id: "G1-3", nominal: 2_000_000, maturity: "2028-09-15", ytm: 20 }),
    gov({ id: "G3-5", nominal: 3_000_000, maturity: "2030-03-15", ytm: 21 }),
    gov({ id: "G5+", nominal: 4_000_000, maturity: "2034-07-15", ytm: 22 }),
  ];

  it("buckets nominal and INVARIANT Σ bucket nominal == eligible nominal", () => {
    const e = run(ps());
    expect(e.maturity.buckets.map((x) => x.nominalGhs)).toEqual([1_000_000, 2_000_000, 3_000_000, 4_000_000]);
    expect(e.maturity.buckets.reduce((s, x) => s + x.nominalGhs, 0)).toBe(e.maturity.eligibleNominalGhs);
    expect(e.maturity.eligibleNominalGhs).toBe(10_000_000);
    expect(e.maturity.buckets[3].nominalPct).toBeCloseTo(40, 9);
  });

  it("a bond with no market value STILL contributes its nominal (contractual ≠ market)", () => {
    const e = run([...ps(), corp({ id: "UV", nominal: 500_000, maturity: "2029-02-10", ytm: null })]);
    expect(e.maturity.eligibleNominalGhs).toBe(10_500_000);
    const b = e.maturity.buckets[1];
    expect(b.nominalGhs).toBe(2_500_000);
    expect(b.unvaluedNominalGhs).toBe(500_000);
    expect(b.valuedCount).toBe(1);
  });

  it("a stale market input does not remove a bond from the ladder", () => {
    const e = run([gov({ id: "S", nominal: 1_000_000, maturity: "2028-09-15", ytm: 20, recency: "STALE" })]);
    expect(e.maturity.eligibleNominalGhs).toBe(1_000_000);
  });

  it("excludes a conflicting maturity even when its market data is perfect, and lists it", () => {
    const e = run([gov({ id: "X", nominal: 1_000_000, maturity: "2028-09-15", ytm: 20, facts: { maturityConflict: true } }), ...ps()]);
    expect(e.maturity.eligibleNominalGhs).toBe(10_000_000);
    expect(e.maturity.excluded).toEqual([expect.objectContaining({ positionId: "X", code: "MATURITY_CONFLICT" })]);
  });

  it("a coupon conflict does NOT exclude a bond from the maturity ladder", () => {
    const e = run([gov({ id: "X", nominal: 1_000_000, maturity: "2028-09-15", ytm: null, facts: { couponConflict: true } })]);
    expect(e.maturity.eligibleNominalGhs).toBe(1_000_000);
  });

  it("excludes matured and not-outstanding bonds", () => {
    const e = run([gov({ id: "M", nominal: 1_000_000, maturity: "2026-09-01", ytm: null }), gov({ id: "D", nominal: 1_000_000, maturity: "2030-01-01", ytm: null, facts: { status: "DEFAULTED" } })]);
    expect(e.maturity.eligibleNominalGhs).toBe(0);
    expect(e.maturity.excluded.map((x) => x.code).sort()).toEqual(["MATURED", "NOT_OUTSTANDING"]);
  });

  it("equities never appear in the ladder", () => {
    const e = run([equity("EQ", 1000, 10)]);
    expect(e.maturity.eligibleNominalGhs).toBe(0);
    expect(e.maturity.bondPositionCount).toBe(0);
  });

  it("empty ladder reports null percentages, not zero shares", () => {
    expect(run([]).maturity.buckets.every((b) => b.nominalPct === null)).toBe(true);
  });
});

describe("annual contractual coupon", () => {
  it("nominal × coupon / 100 (GHS 2m at 23.5% = GHS 470,000)", () => {
    const e = run([gov({ id: "G", nominal: 2_000_000, maturity: "2030-03-15", coupon: 23.5, ytm: 22 })]);
    expect(e.coupon.annualCouponGhs).toBe(470_000);
    expect(e.coupon.rows[0].couponPerPaymentGhs).toBe(235_000);
  });

  it("semi-annual still reports the ANNUAL total; quarterly/annual per-payment differ", () => {
    const e = run([gov({ id: "S", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, freq: "SEMI_ANNUAL", ytm: 20 }), gov({ id: "Q", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, freq: "QUARTERLY", ytm: 20 }), gov({ id: "A", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, freq: "ANNUAL", ytm: 20 })]);
    expect(e.coupon.rows.map((r) => r.annualCouponGhs)).toEqual([200_000, 200_000, 200_000]);
    expect(Object.fromEntries(e.coupon.rows.map((r) => [r.positionId, r.couponPerPaymentGhs]))).toEqual({ S: 100_000, Q: 50_000, A: 200_000 });
  });

  it("INVARIANT: aggregate == Σ(nominal × coupon / 100), and gov + corp == total", () => {
    const ps = [gov({ id: "G", nominal: 2_000_000, maturity: "2030-03-15", coupon: 23.5, ytm: 22 }), corp({ id: "C", nominal: 750_000, maturity: "2029-03-15", coupon: 26.25, ytm: 27 })];
    const e = run(ps);
    expect(e.coupon.annualCouponGhs).toBeCloseTo((2_000_000 * 23.5) / 100 + (750_000 * 26.25) / 100, 2);
    expect(Math.round((e.coupon.governmentGhs + e.coupon.corporateGhs) * 100)).toBe(Math.round((e.coupon.annualCouponGhs as number) * 100));
  });

  it("an unvalued bond with trusted terms still contributes coupon", () => {
    const e = run([corp({ id: "UV", nominal: 1_000_000, maturity: "2030-03-15", coupon: 25, ytm: null })]);
    expect(e.coupon.annualCouponGhs).toBe(250_000);
  });

  it("a conflicting coupon is excluded and listed; the rest still aggregates", () => {
    const e = run([gov({ id: "OK", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, ytm: 20 }), gov({ id: "BAD", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, ytm: 20, facts: { couponConflict: true } })]);
    expect(e.coupon.annualCouponGhs).toBe(200_000);
    expect(e.coupon.excluded).toEqual([expect.objectContaining({ positionId: "BAD", code: "COUPON_CONFLICT" })]);
  });

  it("a maturity conflict does not suppress the coupon amount", () => {
    expect(run([gov({ id: "X", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, ytm: null, facts: { maturityConflict: true } })]).coupon.annualCouponGhs).toBe(200_000);
  });

  it("zero-coupon bonds are counted as paying no coupon, not as omissions; no coupon → null, never 0", () => {
    const e = run([gov({ id: "Z", nominal: 1_000_000, maturity: "2030-03-15", ytm: null, termsOver: { couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null } })]);
    expect(e.coupon.zeroCouponCount).toBe(1);
    expect(e.coupon.excluded).toEqual([]);
    expect(e.coupon.annualCouponGhs).toBeNull();
  });

  it("incomplete fixed terms are excluded with a reason", () => {
    const bnd = gov({ id: "I", nominal: 1_000_000, maturity: "2030-03-15", ytm: null, termsOver: { couponRatePct: null } });
    expect(checkCouponEligibility(bnd.bond!, VAL)).toMatchObject({ eligible: false, code: "TERMS_INCOMPLETE" });
  });

  it("equities never contribute", () => {
    expect(run([equity("EQ", 100, 10)]).coupon.annualCouponGhs).toBeNull();
  });
});

describe("DV01 and modified duration (M7 engine)", () => {
  const T = terms("2030-03-15");
  const yld = 22;

  it("position DV01 = M7 dv01 × nominal / face, positive, and matches the duration-based cross-check", () => {
    const e = run([gov({ id: "G", nominal: 2_000_000, maturity: "2030-03-15", ytm: yld })]);
    const m7 = computeDuration(T, VAL, yld);
    if (!m7.ok) throw new Error("m7 failed");
    expect(e.rates.contributors[0].dv01Ghs).toBeCloseTo((m7.dv01 * 2_000_000) / 100, 2);
    expect(e.rates.contributors[0].dv01Ghs).toBeGreaterThan(0);
    const dirty = (priceFromYield(T, VAL, yld) as { dirtyPrice: number }).dirtyPrice;
    // Independent first-order check (ModifiedDuration × dirty × 1bp), within the second-order gap.
    expect(e.rates.contributors[0].dv01Ghs).toBeCloseTo((approximateDv01FromModifiedDuration(m7.modifiedDurationYears, dirty) * 2_000_000) / 100, 0);
    expect(e.rates.contributors[0].modifiedDurationYears).toBe(m7.modifiedDurationYears);
  });

  it("DV01 scales linearly with nominal", () => {
    const one = run([gov({ id: "A", nominal: 1_000_000, maturity: "2030-03-15", ytm: yld })]).rates.bondDv01Ghs as number;
    const three = run([gov({ id: "A", nominal: 3_000_000, maturity: "2030-03-15", ytm: yld })]).rates.bondDv01Ghs as number;
    expect(three / one).toBeCloseTo(3, 4);
  });

  const mixed = () => [
    gov({ id: "G1", nominal: 2_000_000, maturity: "2034-07-15", ytm: 21 }),
    gov({ id: "G2", nominal: 1_000_000, maturity: "2028-03-15", ytm: 20 }),
    corp({ id: "C1", nominal: 1_500_000, maturity: "2029-09-10", ytm: 25 }),
    equity("EQ", 10_000, 50),
  ];

  it("INVARIANT: bond DV01 = Σ position DV01 and government + corporate = total", () => {
    const e = run(mixed());
    const sum = e.rates.contributors.reduce((s, c) => s + Math.round(c.dv01Ghs * 100), 0);
    expect(Math.round((e.rates.bondDv01Ghs as number) * 100)).toBe(sum);
    expect(Math.round((e.rates.governmentDv01Ghs + e.rates.corporateDv01Ghs) * 100)).toBe(Math.round((e.rates.bondDv01Ghs as number) * 100));
    expect(e.rates.governmentDv01Ghs).toBeGreaterThan(0);
    expect(e.rates.corporateDv01Ghs).toBeGreaterThan(0);
  });

  it("contributors are ranked by DV01 and shares sum to 100", () => {
    const e = run(mixed());
    const v = e.rates.contributors.map((c) => c.dv01Ghs);
    expect([...v].sort((a, b) => b - a)).toEqual(v);
    expect(e.rates.contributors.reduce((s, c) => s + c.sharePct, 0)).toBeCloseTo(100, 9);
  });

  it("weighted modified duration = Σ(value × MD) / Σ value over contributing bonds only", () => {
    const ps = mixed();
    const e = run(ps);
    const bonds = ps.filter((p) => p.bond);
    let num = 0;
    let den = 0;
    for (const p of bonds) {
      const v = valueOf(p);
      const md = (computeDuration(p.bond!.terms, VAL, (p.valuation as { detail: { observedYtmPct: number } }).detail.observedYtmPct) as { modifiedDurationYears: number }).modifiedDurationYears;
      num += v * md;
      den += v;
    }
    expect(e.rates.weightedModifiedDurationYears).toBeCloseTo(num / den, 10);
    expect(e.rates.durationBasisGhs).toBeCloseTo(den, 2); // INVARIANT: denominator == value of duration-eligible bonds
  });

  it("equities never enter DV01 or duration", () => {
    const e = run([equity("EQ", 10_000, 50)]);
    expect(e.rates.bondDv01Ghs).toBeNull();
    expect(e.rates.weightedModifiedDurationYears).toBeNull();
    expect(e.rates.durationBasisGhs).toBe(0);
  });

  it("an unvalued bond is excluded from DV01 and duration and listed as such", () => {
    const e = run([gov({ id: "G1", nominal: 2_000_000, maturity: "2034-07-15", ytm: 21 }), corp({ id: "UV", nominal: 1_000_000, maturity: "2029-09-10", ytm: null })]);
    expect(e.rates.coverage).toMatchObject({ bondPositionCount: 2, contributingCount: 1 });
    expect(e.rates.coverage.excluded).toEqual([expect.objectContaining({ positionId: "UV" })]);
    expect(e.rates.corporateDv01Ghs).toBe(0);
  });

  it("coverage reports the covered share of valued bond reference value", () => {
    const e = run(mixed());
    expect(e.rates.coverage.coveredReferenceValueGhs).toBeCloseTo(e.rates.coverage.valuedBondReferenceValueGhs, 2);
    expect(e.rates.coverage.contributingCount).toBe(3);
  });

  it("a stale-valued bond still contributes but keeps its stale status and is totalled separately", () => {
    const e = run([gov({ id: "S", nominal: 2_000_000, maturity: "2034-07-15", ytm: 21, recency: "STALE" }), gov({ id: "R", nominal: 1_000_000, maturity: "2028-03-15", ytm: 20 })]);
    expect(e.rates.contributors.find((c) => c.positionId === "S")!.recency).toBe("STALE");
    expect(e.rates.staleCount).toBe(1);
    expect(e.rates.staleDv01Ghs).toBeCloseTo(e.rates.contributors.find((c) => c.positionId === "S")!.dv01Ghs, 2);
    expect(e.rates.staleDv01Ghs).toBeLessThan(e.rates.bondDv01Ghs as number);
  });

  it("DV01 is consistent with M7: repricing at ±1bp around the observed yield", () => {
    const e = run([gov({ id: "G", nominal: 1_000_000, maturity: "2030-03-15", ytm: 22 })]);
    const up = (priceFromYield(T, VAL, 22.01) as { dirtyPrice: number }).dirtyPrice;
    const dn = (priceFromYield(T, VAL, 21.99) as { dirtyPrice: number }).dirtyPrice;
    expect(e.rates.bondDv01Ghs).toBeCloseTo(((dn - up) / 2) * 10_000, 2);
  });
});

describe("general portfolio shapes", () => {
  it("empty portfolio", () => {
    const e = run([]);
    expect(e.positionCount).toBe(0);
    expect(e.allocation.rows).toEqual([]);
    expect(e.issuers.rows).toEqual([]);
    expect(e.rates.bondDv01Ghs).toBeNull();
    expect(e.coupon.annualCouponGhs).toBeNull();
    expect(e.upcoming).toEqual([]);
    expect(e.callouts).toEqual([]);
  });

  it("all unvalued: value analytics are empty but contractual analytics still describe the bonds", () => {
    const e = run([gov({ id: "G", nominal: 1_000_000, maturity: "2030-03-15", coupon: 20, ytm: null }), equity("EQ", 100, null)]);
    expect(e.allocation.rows).toEqual([]);
    expect(e.issuers.rows).toEqual([]);
    expect(e.rates.bondDv01Ghs).toBeNull();
    expect(e.maturity.eligibleNominalGhs).toBe(1_000_000);
    expect(e.coupon.annualCouponGhs).toBe(200_000);
    expect(e.callouts).toContain("2 positions are excluded from value-based analytics because they cannot currently be valued.");
  });

  it("only equities: no fixed-income metrics at all", () => {
    const e = run([equity("EQ", 100, 10)]);
    expect(e.maturity.eligibleCount).toBe(0);
    expect(e.coupon.includedCount).toBe(0);
    expect(e.rates.contributors).toEqual([]);
    expect(e.allocation.rows.map((r) => r.assetClass)).toEqual(["EQUITY"]);
  });

  it("only bonds: no equity row", () => {
    const e = run([gov({ id: "G", nominal: 1_000_000, maturity: "2030-03-15", ytm: 20 })]);
    expect(e.allocation.rows.map((r) => r.assetClass)).toEqual(["GOVERNMENT_BOND"]);
  });

  it("is deterministic regardless of input order", () => {
    const ps = [gov({ id: "G1", nominal: 2_000_000, maturity: "2034-07-15", ytm: 21 }), gov({ id: "G2", nominal: 1_000_000, maturity: "2028-03-15", ytm: 20 }), corp({ id: "C1", nominal: 1_500_000, maturity: "2029-09-10", ytm: 25 }), equity("EQ", 10_000, 50)];
    expect(run([...ps].reverse())).toEqual(run(ps));
  });

  it("does not mutate its inputs", () => {
    const ps = [gov({ id: "G1", nominal: 2_000_000, maturity: "2034-07-15", ytm: 21 })];
    const before = JSON.stringify(ps);
    run(ps);
    expect(JSON.stringify(ps)).toBe(before);
  });
});

describe("upcoming maturities", () => {
  it("lists contractually eligible bonds nearest first, with value status and 12-month flag", () => {
    const e = run([
      gov({ id: "Far", nominal: 1_000_000, maturity: "2034-07-15", ytm: 21 }),
      corp({ id: "Soon", nominal: 500_000, maturity: "2027-01-10", ytm: null }),
      gov({ id: "Mid", nominal: 2_000_000, maturity: "2027-10-04", ytm: 20 }),
      gov({ id: "Out", nominal: 2_000_000, maturity: "2027-10-05", ytm: 20 }),
      gov({ id: "Conflict", nominal: 2_000_000, maturity: "2026-12-01", ytm: 20, facts: { maturityConflict: true } }),
    ]);
    expect(e.upcoming.map((u) => u.positionId)).toEqual(["Soon", "Mid", "Out", "Far"]);
    expect(e.upcoming[0]).toMatchObject({ referenceValueGhs: null, nominalGhs: 500_000, daysRemaining: 97, withinNext12Months: true });
    expect(e.upcoming[0].unvaluedReason).toBeTruthy();
    expect(e.upcoming[1].withinNext12Months).toBe(true);
    expect(e.upcoming[2].withinNext12Months).toBe(false);
  });

  it("is capped", () => {
    const ps = Array.from({ length: 8 }, (_, i) => gov({ id: `B${i}`, nominal: 1_000_000, maturity: `2027-0${i + 1}-15`, ytm: 20 }));
    expect(run(ps).upcoming).toHaveLength(5);
  });
});

describe("contractual eligibility is per-metric", () => {
  const facts = (over: Partial<BondContractFacts> = {}): BondContractFacts => ({ nominalGhs: 1, currency: "GHS", status: "ACTIVE", terms: terms("2030-03-15"), maturityConflict: false, couponConflict: false, ...over });
  it("maturity conflict blocks maturity but not coupon; coupon conflict blocks coupon but not maturity", () => {
    expect(checkMaturityEligibility(facts({ maturityConflict: true }), VAL).eligible).toBe(false);
    expect(checkCouponEligibility(facts({ maturityConflict: true }), VAL).eligible).toBe(true);
    expect(checkCouponEligibility(facts({ couponConflict: true }), VAL).eligible).toBe(false);
    expect(checkMaturityEligibility(facts({ couponConflict: true }), VAL).eligible).toBe(true);
  });
  it("floating-rate: trusted maturity, no fixed coupon", () => {
    const f = facts({ terms: terms("2030-03-15", { couponType: "FLOATING" }) });
    expect(checkMaturityEligibility(f, VAL).eligible).toBe(true);
    expect(checkCouponEligibility(f, VAL)).toMatchObject({ eligible: false, code: "FLOATING_RATE" });
  });
});

describe("analyst callouts", () => {
  it("states only facts from the numbers — no advice or judgement words", () => {
    const e = run([gov({ id: "G1", nominal: 6_000_000, maturity: "2034-07-15", ytm: 21 }), gov({ id: "G2", nominal: 1_000_000, maturity: "2028-03-15", ytm: 20 }), corp({ id: "C1", nominal: 2_000_000, maturity: "2028-09-10", ytm: 24 }), equity("EQ", 100, 10), corp({ id: "UV", nominal: 1, maturity: "2030-01-10", ytm: null })]);
    expect(e.callouts.length).toBeGreaterThanOrEqual(4);
    const text = e.callouts.join(" ").toLowerCase();
    for (const banned of ["overexposed", "risky", "diversif", "should", "reduce", "too ", "safe", "dangerous", "healthy"]) expect(text).not.toContain(banned);
    expect(e.callouts[0]).toMatch(/^Government bonds are the largest asset class: \d+% of valued reference value\.$/);
  });
});
