import { describe, it, expect } from "vitest";
import { assessObservationQuality, parseSourceDescription, YIELD_MISMATCH_THRESHOLD_BPS, type QualityInput } from "../observation-quality";
import { buildSecurityAnalytics } from "../security-analytics";
import type { BondTerms } from "../types";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Real terms of GoG GHGGOG062373 (19.25%, matures 18 Jan 2027). */
const GOG_JAN27: BondTerms = { issueDate: d("2021-01-25"), maturityDate: d("2027-01-18"), couponType: "FIXED", couponRatePct: 19.25, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
/** Real terms of GoG GHGGOG065921 (20.75%, matures 8 Mar 2027). */
const GOG_MAR27: BondTerms = { issueDate: d("2022-03-14"), maturityDate: d("2027-03-08"), couponType: "FIXED", couponRatePct: 20.75, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
/** Izwe GHCILL070481 as held in the Securities Master (GFIM Active Corporate Bonds page). */
const IZWE_MASTER: BondTerms = { issueDate: d("2023-04-12"), maturityDate: d("2026-04-08"), couponType: "FIXED", couponRatePct: 22.5, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };

function input(overrides: Partial<QualityInput>): QualityInput {
  return {
    terms: GOG_JAN27,
    observationDate: d("2026-09-09"),
    tradeStatus: "TRADED",
    cleanPrice: 101.3117,
    sourceYieldPct: 15.16,
    sourceMaturityDate: d("2027-01-18"),
    sourceSecurityDescription: "GOG-BD-18/01/27-A5531-1730-19.25",
    ...overrides,
  };
}

const codes = (i: QualityInput) => assessObservationQuality(i).issues.map((x) => x.code);

describe("assessObservationQuality (M7.3.1)", () => {
  it("a genuine trade whose price reproduces the source yield is VALID and analytics-eligible", () => {
    const q = assessObservationQuality(input({}));
    expect(q.status).toBe("VALID");
    expect(q.analyticsEligible).toBe(true);
    expect(q.issues).toEqual([]);
  });

  it("does NOT reject a genuinely unusual yield — GoG Jan-27 traded at 55.71% on 8 Jul 2026", () => {
    const q = assessObservationQuality(input({ observationDate: d("2026-07-08"), cleanPrice: 84.8449, sourceYieldPct: 55.71 }));
    expect(q.status).toBe("VALID");
  });

  it("flags a material source-yield vs solved-YTM disagreement for REVIEW (GoG Aug-27, 28 Apr 2026: GFIM 46.56% vs price-implied ~25%)", () => {
    const aug27: BondTerms = { issueDate: d("2020-08-17"), maturityDate: d("2027-08-09"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
    const q = assessObservationQuality(input({ terms: aug27, observationDate: d("2026-04-28"), cleanPrice: 94.3214, sourceYieldPct: 46.56, sourceMaturityDate: d("2027-08-09"), sourceSecurityDescription: "GOG-BD-09/08/27-A5394-1707-20.00" }));
    expect(q.status).toBe("REVIEW");
    expect(q.analyticsEligible).toBe(false);
    const issue = q.issues.find((i) => i.code === "YIELD_MISMATCH")!;
    expect(issue.detail).toContain("46.56%");
    expect(issue.detail).toContain(`${YIELD_MISMATCH_THRESHOLD_BPS} bps`);
  });

  it("solves at the OBSERVATION date: GoG Mar-27's 2 Feb 2026 trade (91.62 / 30.15%) is consistent, not a 47% anomaly", () => {
    const q = assessObservationQuality(input({ terms: GOG_MAR27, observationDate: d("2026-02-02"), cleanPrice: 91.6202, sourceYieldPct: 30.1454, sourceMaturityDate: d("2027-03-08"), sourceSecurityDescription: "GOG-BD-08/03/27-A5859-1789-20.75" }));
    expect(q.status).toBe("VALID");
  });

  it("EXCLUDES a carried closing price (no trade on the date)", () => {
    const q = assessObservationQuality(input({ tradeStatus: "NOT_TRADED", observationDate: d("2026-10-02") }));
    expect(q.status).toBe("EXCLUDED");
    expect(codes(input({ tradeStatus: "NOT_TRADED" }))).toContain("NOT_TRADED");
  });

  it("EXCLUDES an observation dated on/after maturity, and flags the Izwe maturity conflict", () => {
    const q = assessObservationQuality(
      input({ terms: IZWE_MASTER, observationDate: d("2026-10-02"), tradeStatus: "NOT_TRADED", cleanPrice: 99.9382, sourceYieldPct: null, sourceMaturityDate: d("2027-04-08"), sourceSecurityDescription: "ILL-BD-8/04/27-C0830-22.25" }),
    );
    expect(q.status).toBe("EXCLUDED");
    const c = q.issues.map((i) => i.code);
    expect(c).toContain("POST_MATURITY");
    expect(c).toContain("MATURITY_CONFLICT");
    expect(c).toContain("COUPON_CONFLICT"); // description 22.25 vs master 22.5
  });

  it("puts a real pre-maturity trade with conflicting terms under REVIEW (Izwe, 19 Mar 2026)", () => {
    const q = assessObservationQuality(
      input({ terms: IZWE_MASTER, observationDate: d("2026-03-19"), cleanPrice: 99.9382, sourceYieldPct: null, sourceMaturityDate: d("2027-04-08"), sourceSecurityDescription: "ILL-BD-8/04/27-C0830-22.25" }),
    );
    expect(q.status).toBe("REVIEW");
    expect(q.analyticsEligible).toBe(false);
  });

  it("treats a maturity difference within 7 days as a business-day adjustment (INFO), not a conflict", () => {
    const may28: BondTerms = { ...GOG_JAN27, issueDate: d("2018-06-11"), maturityDate: d("2028-05-28"), couponRatePct: 17.5 };
    const q = assessObservationQuality(input({ terms: may28, observationDate: d("2026-09-30"), cleanPrice: 90.5927, sourceYieldPct: 24.5, sourceMaturityDate: d("2028-05-29"), sourceSecurityDescription: "GOG-BD-29/05/28-A4753-1593-17.50" }));
    expect(q.status).toBe("VALID");
    expect(q.issues.map((i) => [i.code, i.severity])).toEqual([["MATURITY_DATE_ADJUSTMENT", "INFO"]]);
  });

  it("flags a coupon in the source description that disagrees with the master (Bayport Nov-27: 23.5 vs 24.5)", () => {
    const bfs: BondTerms = { issueDate: d("2024-11-04"), maturityDate: d("2027-11-01"), couponType: "FIXED", couponRatePct: 24.5, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
    const q = assessObservationQuality(input({ terms: bfs, cleanPrice: 103.1308, sourceYieldPct: null, sourceMaturityDate: d("2027-11-01"), sourceSecurityDescription: "BFS-BD-01/11/27-C0937-23.5" }));
    expect(q.issues.find((i) => i.code === "COUPON_CONFLICT")?.detail).toContain("23.5%");
    expect(q.status).toBe("REVIEW");
  });

  it("EXCLUDES an observation with neither price nor yield", () => {
    expect(assessObservationQuality(input({ cleanPrice: null, sourceYieldPct: null })).status).toBe("EXCLUDED");
  });
});

describe("parseSourceDescription", () => {
  it("reads maturity and coupon from GFIM's description conventions", () => {
    expect(parseSourceDescription("KCP-NT-12/09/28-C0933-23.50")).toEqual({ maturityDate: d("2028-09-12"), couponPct: 23.5 });
    expect(parseSourceDescription("GOG-BD-02/11/26-A4338-1511-19.00")).toEqual({ maturityDate: d("2026-11-02"), couponPct: 19 });
  });

  it("never invents a coupon from an ambiguous trailing number or a description without one", () => {
    expect(parseSourceDescription("BFS-BD-24/07/28-C0932").couponPct).toBeNull();
    expect(parseSourceDescription("ILL-BD-09/04/2027-C0906-27").couponPct).toBeNull(); // "27" may be a series suffix
    expect(parseSourceDescription("not a gfim description")).toEqual({ maturityDate: null, couponPct: null });
    expect(parseSourceDescription(null)).toEqual({ maturityDate: null, couponPct: null });
  });
});

describe("buildSecurityAnalytics — observation-date solving (M7.3.1)", () => {
  it("solves a stale trade's YTM at its own date, not the valuation date", () => {
    const valuation = d("2026-10-04");
    const a = buildSecurityAnalytics(GOG_MAR27, { observationDate: d("2026-02-02"), cleanPrice: 91.6202, sourceYieldPct: 30.1454, observationKind: "SECONDARY_MARKET", tradeStatus: "TRADED" }, valuation);
    expect(Math.abs(a.ytmPct! - 30.15)).toBeLessThan(0.3); // ≈ GFIM's own 30.15%, not the ~47% a valuation-date solve implies
    expect(a.quality?.status).toBe("VALID");
    expect(a.tenorDays).toBe(155); // remaining life is still measured from the valuation date
  });

  it("implies no yield from a carried (NOT_TRADED) price", () => {
    const a = buildSecurityAnalytics(GOG_MAR27, { observationDate: d("2026-10-02"), cleanPrice: 91.6202, sourceYieldPct: 30.1454, observationKind: "SECONDARY_MARKET", tradeStatus: "NOT_TRADED" }, d("2026-10-04"));
    expect(a.ytmPct).toBeNull();
    expect(a.quality?.status).toBe("EXCLUDED");
    expect(a.cleanPrice).toBe(91.6202); // still visible for provenance
  });
});
