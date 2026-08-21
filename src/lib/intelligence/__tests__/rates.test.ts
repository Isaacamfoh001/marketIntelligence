import { describe, it, expect } from "vitest";
import { evaluateMonetaryPolicyCondition, evaluateShortTermRatesCondition } from "../rates";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("evaluateMonetaryPolicyCondition", () => {
  it("is UNAVAILABLE with no decision on record", () => {
    expect(evaluateMonetaryPolicyCondition({ latestDecision: null }).state).toBe("UNAVAILABLE");
  });

  it("is HOLDING on a HOLD decision", () => {
    const result = evaluateMonetaryPolicyCondition({
      latestDecision: { decisionDate: d("2026-07-22"), resultingRate: 14.0, decisionType: "HOLD" },
    });
    expect(result.state).toBe("HOLDING");
    expect(result.sentiment).toBe("neutral");
    expect(result.freshness).toBe("CURRENT"); // AD_HOC never goes stale by elapsed time
  });

  it("is TIGHTENING on a HIKE decision", () => {
    const result = evaluateMonetaryPolicyCondition({
      latestDecision: { decisionDate: d("2026-07-22"), resultingRate: 15.0, decisionType: "HIKE" },
    });
    expect(result.state).toBe("TIGHTENING");
    expect(result.direction).toBe("up");
  });

  it("is EASING on a CUT decision", () => {
    const result = evaluateMonetaryPolicyCondition({
      latestDecision: { decisionDate: d("2026-07-22"), resultingRate: 13.0, decisionType: "CUT" },
    });
    expect(result.state).toBe("EASING");
    expect(result.direction).toBe("down");
  });

  it("includes the bps magnitude in the explanation when provided, without changing the classification", () => {
    const result = evaluateMonetaryPolicyCondition({
      latestDecision: { decisionDate: d("2026-07-22"), resultingRate: 14.0, decisionType: "CUT", changeBps: -150 },
    });
    expect(result.state).toBe("EASING");
    expect(result.explanation).toContain("150 bps");
  });
});

describe("evaluateShortTermRatesCondition", () => {
  it("is UNAVAILABLE with no data", () => {
    expect(evaluateShortTermRatesCondition([{ label: "91-Day", latest: null, previous: null }]).state).toBe("UNAVAILABLE");
  });

  it("is FALLING when a majority of tenors ease beyond the noise band", () => {
    const result = evaluateShortTermRatesCondition([
      { label: "91-Day", latest: { observationDate: d("2026-08-17"), interestRate: 5.47 }, previous: { observationDate: d("2026-08-10"), interestRate: 5.63 } },
      { label: "182-Day", latest: { observationDate: d("2026-08-17"), interestRate: 7.27 }, previous: { observationDate: d("2026-08-10"), interestRate: 7.53 } },
      { label: "364-Day", latest: { observationDate: d("2026-08-17"), interestRate: 12.5 }, previous: { observationDate: d("2026-08-10"), interestRate: 12.5 } },
    ]);
    expect(result.state).toBe("FALLING");
    expect(result.sentiment).toBe("neutral");
  });

  it("is RISING when a majority of tenors rise beyond the noise band", () => {
    const result = evaluateShortTermRatesCondition([
      { label: "91-Day", latest: { observationDate: d("2026-08-17"), interestRate: 5.8 }, previous: { observationDate: d("2026-08-10"), interestRate: 5.47 } },
      { label: "182-Day", latest: { observationDate: d("2026-08-17"), interestRate: 7.6 }, previous: { observationDate: d("2026-08-10"), interestRate: 7.27 } },
      { label: "364-Day", latest: { observationDate: d("2026-08-17"), interestRate: 12.5 }, previous: { observationDate: d("2026-08-10"), interestRate: 12.5 } },
    ]);
    expect(result.state).toBe("RISING");
  });

  it("is MIXED when tenors disagree", () => {
    const result = evaluateShortTermRatesCondition([
      { label: "91-Day", latest: { observationDate: d("2026-08-17"), interestRate: 5.8 }, previous: { observationDate: d("2026-08-10"), interestRate: 5.47 } },
      { label: "182-Day", latest: { observationDate: d("2026-08-17"), interestRate: 7.0 }, previous: { observationDate: d("2026-08-10"), interestRate: 7.27 } },
      { label: "364-Day", latest: { observationDate: d("2026-08-17"), interestRate: 12.5 }, previous: { observationDate: d("2026-08-10"), interestRate: 12.5 } },
    ]);
    expect(result.state).toBe("MIXED");
  });
});
