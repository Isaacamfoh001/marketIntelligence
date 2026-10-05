import { describe, expect, it } from "vitest";
import { BOND_RECENT_WINDOW_DAYS, resolveBondValuationInput, type BondValuationSource } from "..";
import { observationFreshness } from "../../freshness";
import type { BondTerms } from "../../fixed-income";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const VALUATION = d("2026-10-05");

const TERMS: BondTerms = { issueDate: d("2024-03-01"), maturityDate: d("2028-03-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };

function source(overrides: Partial<BondValuationSource> = {}): BondValuationSource {
  return {
    currency: "GHS",
    status: "ACTIVE",
    lifecycle: "ACTIVE",
    terms: TERMS,
    termsConflicts: [],
    latestReliableTrade: { date: "2026-09-30", cleanPrice: 97.5, ytmPct: 20.49 },
    marketObservation: { date: "2026-09-30", status: "VALID", issues: [] },
    carriedOnly: false,
    ...overrides,
  };
}

const unavailable = (s: BondValuationSource) => {
  const r = resolveBondValuationInput(s, VALUATION);
  if (r.available) throw new Error("expected unavailable");
  return r;
};

describe("resolveBondValuationInput — M7 quality semantics preserved", () => {
  it("VALID + recent → usable, recent, with the observation's own date and age", () => {
    const r = resolveBondValuationInput(source(), VALUATION);
    expect(r).toMatchObject({ available: true, observedYtmPct: 20.49, observationDate: "2026-09-30", ageDays: 5, recency: "RECENT", observedCleanPrice: 97.5, pendingReview: null });
  });

  it("VALID + stale → usable but labelled stale (never promoted to recent)", () => {
    const r = resolveBondValuationInput(source({ latestReliableTrade: { date: "2026-08-01", cleanPrice: 95, ytmPct: 22 }, marketObservation: { date: "2026-08-01", status: "VALID", issues: [] } }), VALUATION);
    expect(r).toMatchObject({ available: true, ageDays: 65, recency: "STALE", observationDate: "2026-08-01" });
  });

  it("newer REVIEW + older VALID → uses the older VALID, keeps its true age, discloses the pending review", () => {
    const r = resolveBondValuationInput(
      source({
        latestReliableTrade: { date: "2026-09-20", cleanPrice: 96, ytmPct: 21 },
        marketObservation: { date: "2026-10-02", status: "REVIEW", issues: ["Yield mismatch: source 18% vs price-implied 25%."] },
      }),
      VALUATION,
    );
    expect(r).toMatchObject({ available: true, observationDate: "2026-09-20", ageDays: 15, recency: "STALE" });
    expect((r as { pendingReview: unknown }).pendingReview).toEqual({ date: "2026-10-02", status: "REVIEW", issues: ["Yield mismatch: source 18% vs price-implied 25%."] });
  });

  it("REVIEW with no older VALID → unavailable (UNDER_REVIEW) with the evidence", () => {
    const r = unavailable(source({ latestReliableTrade: null, marketObservation: { date: "2026-10-02", status: "REVIEW", issues: ["Coupon conflict."] } }));
    expect(r.code).toBe("UNDER_REVIEW");
    expect(r.reason).toContain("Coupon conflict.");
  });

  it("EXCLUDED observation with no reliable trade → unavailable, never used automatically", () => {
    expect(unavailable(source({ latestReliableTrade: null, marketObservation: { date: "2026-10-02", status: "EXCLUDED", issues: ["After maturity."] } })).code).toBe("OBSERVATION_EXCLUDED");
  });

  it("an EXCLUDED newer observation never replaces an older reliable trade, but is disclosed", () => {
    const r = resolveBondValuationInput(source({ latestReliableTrade: { date: "2026-09-20", cleanPrice: 96, ytmPct: 21 }, marketObservation: { date: "2026-10-01", status: "EXCLUDED", issues: ["No price or yield."] } }), VALUATION);
    expect(r).toMatchObject({ available: true, observationDate: "2026-09-20" });
    expect((r as { pendingReview: { status: string } }).pendingReview.status).toBe("EXCLUDED");
  });

  it("carried (NOT_TRADED) price only → unavailable (NO_TRADE)", () => {
    expect(unavailable(source({ latestReliableTrade: null, marketObservation: null, carriedOnly: true })).code).toBe("NO_TRADE");
  });

  it("no observation at all → unavailable (NO_OBSERVATION)", () => {
    expect(unavailable(source({ latestReliableTrade: null, marketObservation: null })).code).toBe("NO_OBSERVATION");
  });

  it("matured → unavailable (MATURED), explicitly not zero — by lifecycle or by date", () => {
    const byLifecycle = unavailable(source({ lifecycle: "MATURED" }));
    expect(byLifecycle.code).toBe("MATURED");
    expect(byLifecycle.reason).toMatch(/not zero/);
    expect(unavailable(source({ terms: { ...TERMS, maturityDate: d("2026-10-05") } })).code).toBe("MATURED");
  });

  it("floating-rate, called/defaulted and non-GHS are unavailable with reasons", () => {
    expect(unavailable(source({ terms: { ...TERMS, couponType: "FLOATING" } })).code).toBe("FLOATING_RATE");
    expect(unavailable(source({ status: "DEFAULTED" })).code).toBe("NOT_OUTSTANDING");
    expect(unavailable(source({ status: "CALLED" })).code).toBe("NOT_OUTSTANDING");
    expect(unavailable(source({ currency: "USD" })).code).toBe("NOT_GHS");
  });

  it("missing coupon terms on a fixed bond → unavailable (TERMS_UNSUPPORTED)", () => {
    expect(unavailable(source({ terms: { ...TERMS, couponRatePct: null } })).code).toBe("TERMS_UNSUPPORTED");
    expect(unavailable(source({ terms: { ...TERMS, couponFrequency: null } })).code).toBe("TERMS_UNSUPPORTED");
  });

  it("source-vs-master terms conflict → unavailable (TERMS_CONFLICT) even with a reliable trade", () => {
    const r = unavailable(source({ termsConflicts: ["The source states maturity 2028-08-01, but the Securities Master holds 2028-03-01."] }));
    expect(r.code).toBe("TERMS_CONFLICT");
    expect(r.reason).toContain("2028-08-01");
  });

  it("a zero-coupon bond with a reliable trade is usable (M7 supports it)", () => {
    const zc: BondTerms = { ...TERMS, couponType: "ZERO_COUPON", couponRatePct: null, couponFrequency: null };
    expect(resolveBondValuationInput(source({ terms: zc }), VALUATION)).toMatchObject({ available: true });
  });

  it("flags a yield taken from the source quote when there is no clean price", () => {
    expect(resolveBondValuationInput(source({ latestReliableTrade: { date: "2026-09-30", cleanPrice: null, ytmPct: 19 } }), VALUATION)).toMatchObject({ yieldFromSourceQuote: true, observedCleanPrice: null });
  });

  it("an observation dated on the valuation date has age 0 and is recent", () => {
    expect(resolveBondValuationInput(source({ latestReliableTrade: { date: "2026-10-05", cleanPrice: 97.5, ytmPct: 20 } }), VALUATION)).toMatchObject({ ageDays: 0, recency: "RECENT" });
  });
});

describe("bond recency window stays in step with M7's weekly freshness tolerance", () => {
  it("recent at exactly the window, stale one day later", () => {
    const at = (age: number) => new Date(VALUATION.getTime() - age * 86_400_000);
    expect(observationFreshness("WEEKLY", at(BOND_RECENT_WINDOW_DAYS), VALUATION)).toBe("CURRENT");
    expect(observationFreshness("WEEKLY", at(BOND_RECENT_WINDOW_DAYS + 1), VALUATION)).toBe("STALE");
    const iso = (age: number) => at(age).toISOString().slice(0, 10);
    const recencyAt = (age: number) => (resolveBondValuationInput(source({ latestReliableTrade: { date: iso(age), cleanPrice: 97, ytmPct: 20 } }), VALUATION) as { recency: string }).recency;
    expect(recencyAt(BOND_RECENT_WINDOW_DAYS)).toBe("RECENT");
    expect(recencyAt(BOND_RECENT_WINDOW_DAYS + 1)).toBe("STALE");
  });
});
