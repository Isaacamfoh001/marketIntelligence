import { describe, it, expect } from "vitest";
import { buildSecurityInsights, type InsightInput } from "../insights";
import type { PriceScenario } from "../price-scenarios";

function scenario(cleanPrice: number, returnPct: number): PriceScenario {
  return {
    cleanPrice,
    accruedInterest: 0,
    dirtyPrice: cleanPrice,
    regulatoryLevy: 0,
    dealerFee: 0,
    allInCost: cleanPrice,
    ytmPct: returnPct,
    returnPct,
    effectiveAnnualReturnPct: returnPct,
    remainingCashPer100: 0,
    nominalProfitPer100: 0,
  };
}

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    maturityDateIso: "2028-09-12",
    tenorDays: 709,
    lifecycle: "ACTIVE",
    observation: { dateIso: "2026-10-02", ageDays: 2, kind: "SECONDARY_MARKET", freshness: "CURRENT", cleanPrice: 99.81 },
    ytmPct: 23.58,
    ytmSource: "SOLVED_FROM_PRICE",
    sourceQuotedYieldPct: null,
    isCorporate: true,
    benchmark: { label: "GoG Jun-28", yieldPct: 20.06, tenorGapDays: 92, isWideGap: false },
    spreadBps: 352,
    scenarios: [scenario(100, 23.4), scenario(105, 20.2), scenario(110, 17.2)],
    breakEvenCleanPrice: 145.56,
    sensitivityBpsPerPoint: 66,
    ...overrides,
  };
}

const ids = (i: InsightInput) => buildSecurityInsights(i).map((x) => x.id);
const textOf = (i: InsightInput, id: string) => buildSecurityInsights(i).find((x) => x.id === id)?.text ?? "";

describe("buildSecurityInsights (M7.3 §20)", () => {
  it("states maturity, observation age, price vs par, spread and the 105 scenario factually", () => {
    const i = input();
    expect(textOf(i, "maturity")).toContain("Matures in 709 days");
    expect(textOf(i, "observation-age")).toContain("2 days old");
    expect(textOf(i, "price-vs-par")).toContain("below par by 0.19");
    expect(textOf(i, "spread")).toContain("+352 bps");
    expect(textOf(i, "scenario-105")).toContain("falls to 20.20%");
  });

  it("flags a near-maturity bond whose return turns negative at a premium", () => {
    const i = input({
      tenorDays: 13,
      lifecycle: "MATURING_SOON",
      maturityDateIso: "2026-10-17",
      scenarios: [scenario(100, 20.9), scenario(105, -101.4), scenario(110, -213.7)],
      breakEvenCleanPrice: 100.82,
      sensitivityBpsPerPoint: 2534,
    });
    const all = buildSecurityInsights(i);
    expect(all.find((x) => x.id === "maturity")!.tone).toBe("caution");
    expect(textOf(i, "scenario-105")).toContain("becomes negative");
    expect(textOf(i, "high-sensitivity")).toContain("close to maturity");
    expect(textOf(i, "break-even")).toContain("100.82");
  });

  it("names the first negative price when it is not 105", () => {
    const i = input({ scenarios: [scenario(100, 5), scenario(105, 1), scenario(110, -3)] });
    expect(textOf(i, "first-negative")).toContain("110.00");
  });

  it("says scenarios are hypothetical when there is no market observation", () => {
    const i = input({ observation: null, ytmPct: null, ytmSource: null, spreadBps: null });
    expect(ids(i)).toContain("no-observation");
    expect(textOf(i, "no-observation")).toContain("hypothetical");
    expect(textOf(i, "no-spread")).toContain("GoG Jun-28");
    expect(ids(i)).not.toContain("spread");
  });

  it("marks a stale observation as stale", () => {
    const i = input({ observation: { dateIso: "2026-08-01", ageDays: 64, kind: "SECONDARY_MARKET", freshness: "STALE", cleanPrice: 101 } });
    const obs = buildSecurityInsights(i).find((x) => x.id === "observation-age")!;
    expect(obs.tone).toBe("caution");
    expect(obs.text).toContain("stale");
  });

  it("flags a wide benchmark tenor gap and a missing benchmark", () => {
    expect(ids(input({ benchmark: { label: "GoG 2039", yieldPct: 20.2, tenorGapDays: 4000, isWideGap: true } }))).toContain("benchmark-gap");
    expect(ids(input({ benchmark: null, spreadBps: null }))).toContain("no-benchmark");
  });

  it("states when an observation is withheld from analytics, with the quality evidence", () => {
    const issue = { code: "YIELD_MISMATCH" as const, severity: "REVIEW" as const, label: "Yield mismatch", detail: "The source quotes 46.56%, but the quoted price implies 25.31%." };
    expect(textOf(input({ observationIssues: [issue] }), "withheld")).toContain("46.56%");
    expect(ids(input({ observationIssues: [{ ...issue, severity: "INFO" }] }))).not.toContain("withheld");
  });

  it("explains a carried price with no recorded trade instead of treating it as a quote", () => {
    const i = input({ observation: null, ytmPct: null, ytmSource: null, spreadBps: null, noTradeRecordedSince: "2025-07-21", carried: { cleanPrice: 40.9633, asOf: "2026-10-02" } });
    const t = textOf(i, "no-trade");
    expect(t).toContain("21 Jul 2025");
    expect(t).toContain("40.96");
    expect(t).toContain("not a market price");
  });

  it("surfaces securities-master terms conflicts as caution facts", () => {
    const conflict = { code: "COUPON_CONFLICT" as const, severity: "REVIEW" as const, label: "Coupon conflict", detail: "The source's description indicates 23.5%, but the master holds 24.5%." };
    const fact = buildSecurityInsights(input({ termsIssues: [conflict] })).find((x) => x.id === "terms-COUPON_CONFLICT")!;
    expect(fact.tone).toBe("caution");
    expect(fact.text).toContain("Coupon conflict");
  });

  it("still surfaces a terms conflict for a matured security — the maturity itself may be disputed", () => {
    const conflict = { code: "MATURITY_CONFLICT" as const, severity: "REVIEW" as const, label: "Maturity conflict", detail: "The source states maturity 2027-04-08, but the Securities Master holds 2026-04-08." };
    expect(ids(input({ lifecycle: "MATURED", tenorDays: 0, termsIssues: [conflict] }))).toEqual(["matured", "terms-MATURITY_CONFLICT"]);
  });

  it("reports only the matured fact for a matured security", () => {
    expect(ids(input({ lifecycle: "MATURED", tenorDays: 0 }))).toEqual(["matured"]);
  });

  it("never uses subjective recommendation language", () => {
    const text = buildSecurityInsights(input()).map((x) => x.text).join(" ").toLowerCase();
    for (const banned of ["attractive", "buy", "sell", "undervalued", "overvalued", "good investment", "recommend"]) {
      expect(text).not.toContain(banned);
    }
  });
});
