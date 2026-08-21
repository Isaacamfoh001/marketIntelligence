import { describe, it, expect } from "vitest";
import { evaluateInflationCondition } from "../inflation";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("evaluateInflationCondition", () => {
  it("is UNAVAILABLE with no data", () => {
    const result = evaluateInflationCondition({ latest: null, previous: null, history: [] });
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.freshness).toBe("MISSING");
  });

  it("is EASING when inflation falls beyond the noise band", () => {
    const result = evaluateInflationCondition({
      latest: { observationDate: d("2026-08-01"), value: 4.6 },
      previous: { observationDate: d("2026-07-01"), value: 5.3 },
      history: [],
    });
    expect(result.state).toBe("EASING");
    expect(result.sentiment).toBe("positive");
    expect(result.explanation).toContain("declined");
  });

  it("is RISING when inflation rises beyond the noise band", () => {
    const result = evaluateInflationCondition({
      latest: { observationDate: d("2026-08-01"), value: 5.5 },
      previous: { observationDate: d("2026-07-01"), value: 5.0 },
      history: [],
    });
    expect(result.state).toBe("RISING");
    expect(result.sentiment).toBe("negative");
    expect(result.explanation).toContain("rose");
  });

  it("is STABLE for a sub-noise-band move", () => {
    const result = evaluateInflationCondition({
      latest: { observationDate: d("2026-08-01"), value: 5.02 },
      previous: { observationDate: d("2026-07-01"), value: 5.0 },
      history: [],
    });
    expect(result.state).toBe("STABLE");
    expect(result.sentiment).toBe("neutral");
  });

  it("is STABLE (not RISING/EASING) with only one data point, and says so honestly", () => {
    const result = evaluateInflationCondition({
      latest: { observationDate: d("2026-08-01"), value: 4.6 },
      previous: null,
      history: [],
    });
    expect(result.state).toBe("STABLE");
    expect(result.direction).toBeNull();
    expect(result.explanation).toContain("not enough prior history");
  });

  it("is STALE when the latest observation is beyond the monthly tolerance", () => {
    const result = evaluateInflationCondition({
      latest: { observationDate: d("2024-01-01"), value: 5.0 },
      previous: { observationDate: d("2023-12-01"), value: 5.5 },
      history: [],
    });
    expect(result.freshness).toBe("STALE");
  });
});
