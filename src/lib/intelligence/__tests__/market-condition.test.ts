import { describe, it, expect } from "vitest";
import { buildMarketConditionSummary, type DimensionKey } from "../market-condition";
import { unavailableResult, type IntelligenceResult } from "../types";

function current(state: string, explanation: string, sentiment: "positive" | "negative" | "neutral" = "neutral"): IntelligenceResult<string> {
  return { state, direction: null, sentiment, headline: state, explanation, historicalNote: null, currentValue: 1, previousValue: 0, observationDate: "2026-08-19", freshness: "CURRENT" };
}

function stale(state: string): IntelligenceResult<string> {
  return { ...current(state, "stale"), freshness: "STALE" };
}

const ALL_UNAVAILABLE: Record<DimensionKey, IntelligenceResult<string>> = {
  inflation: unavailableResult("UNAVAILABLE", "Unavailable", "no data"),
  currency: unavailableResult("UNAVAILABLE", "Unavailable", "no data"),
  monetaryPolicy: unavailableResult("UNAVAILABLE", "Unavailable", "no data"),
  shortTermRates: unavailableResult("UNAVAILABLE", "Unavailable", "no data"),
  equityMomentum: unavailableResult("UNAVAILABLE", "Unavailable", "no data"),
};

describe("buildMarketConditionSummary", () => {
  it("reports insufficient data when nothing is eligible", () => {
    const summary = buildMarketConditionSummary(ALL_UNAVAILABLE);
    expect(summary.label).toBe("Insufficient current data");
    expect(summary.eligibleCount).toBe(0);
    expect(summary.totalCount).toBe(5);
  });

  it("is deterministic — same inputs always produce the same output", () => {
    const inputs = {
      ...ALL_UNAVAILABLE,
      inflation: current("EASING", "Headline inflation declined 0.7pp to 4.6% in the latest month.", "positive"),
      currency: current("STABLE", "USD/GHS was broadly stable.", "neutral"),
      monetaryPolicy: current("HOLDING", "The Bank of Ghana held its policy rate at 14.00%.", "neutral"),
      shortTermRates: current("FALLING", "Treasury yields eased across 3 of 3 tracked tenors.", "neutral"),
      equityMomentum: current("POSITIVE", "GSE-CI rose 4.00% over the past month.", "positive"),
    };
    const a = buildMarketConditionSummary(inputs, new Date("2026-08-19T00:00:00.000Z"));
    const b = buildMarketConditionSummary(inputs, new Date("2026-08-19T00:00:00.000Z"));
    expect(a).toEqual(b);
  });

  it("labels a broadly positive combination as an improving macro backdrop", () => {
    const summary = buildMarketConditionSummary({
      ...ALL_UNAVAILABLE,
      inflation: current("EASING", "inflation easing sentence"),
      currency: current("STRENGTHENING", "currency strengthening sentence"),
      monetaryPolicy: current("EASING", "policy easing sentence"),
      shortTermRates: current("FALLING", "yields falling sentence"),
      equityMomentum: current("POSITIVE", "equities positive sentence"),
    });
    expect(summary.label).toBe("Improving macro backdrop");
    expect(summary.eligibleCount).toBe(5);
  });

  it("labels a broadly negative combination as tight financial conditions", () => {
    const summary = buildMarketConditionSummary({
      ...ALL_UNAVAILABLE,
      inflation: current("RISING", "inflation rising sentence"),
      currency: current("WEAKENING", "currency weakening sentence"),
      monetaryPolicy: current("TIGHTENING", "policy tightening sentence"),
      shortTermRates: current("RISING", "yields rising sentence"),
      equityMomentum: current("NEGATIVE", "equities negative sentence"),
    });
    expect(summary.label).toBe("Tight financial conditions");
  });

  it("produces a specific divergent label when inflation eases but currency is under pressure and other dimensions are neutral", () => {
    const summary = buildMarketConditionSummary({
      ...ALL_UNAVAILABLE,
      inflation: current("EASING", "inflation easing sentence"),
      currency: current("WEAKENING", "currency weakening sentence"),
      monetaryPolicy: current("HOLDING", "policy holding sentence"),
      shortTermRates: current("MIXED", "yields mixed sentence"),
    });
    expect(summary.label).toBe("Inflation easing, currency pressure elevated");
  });

  it("excludes stale dimensions from the score but still reports them", () => {
    const summary = buildMarketConditionSummary({
      ...ALL_UNAVAILABLE,
      inflation: current("EASING", "inflation easing sentence"),
      currency: stale("WEAKENING"),
    });
    expect(summary.eligibleCount).toBe(1);
    expect(summary.totalCount).toBe(5);
    const currencyDim = summary.dimensions.find((d) => d.key === "currency")!;
    expect(currencyDim.eligible).toBe(false);
    expect(currencyDim.score).toBe(0);
  });
});
