import { describe, it, expect } from "vitest";
import { evaluateFxCondition } from "../fx";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("evaluateFxCondition", () => {
  it("is UNAVAILABLE with no data", () => {
    const result = evaluateFxCondition({ latest: null, previous: null, history: [] });
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("is WEAKENING when the cedi weakens beyond the noise band (1M history available)", () => {
    const history = [
      { date: "2026-07-19", value: 11.0 },
      { date: "2026-08-19", value: 11.08 }, // +0.73% over ~1M
    ];
    const result = evaluateFxCondition({
      latest: { observationDate: d("2026-08-19"), midRate: 11.08 },
      previous: { observationDate: d("2026-08-18"), midRate: 11.05 },
      history,
    });
    expect(result.state).toBe("WEAKENING");
    expect(result.sentiment).toBe("negative");
    expect(result.explanation).toContain("weakened");
  });

  it("is STRENGTHENING when the cedi strengthens beyond the noise band", () => {
    const history = [
      { date: "2026-07-19", value: 11.08 },
      { date: "2026-08-19", value: 11.0 }, // cedi strengthened ~0.72%
    ];
    const result = evaluateFxCondition({
      latest: { observationDate: d("2026-08-19"), midRate: 11.0 },
      previous: { observationDate: d("2026-08-18"), midRate: 11.02 },
      history,
    });
    expect(result.state).toBe("STRENGTHENING");
    expect(result.sentiment).toBe("positive");
  });

  it("is STABLE for a sub-noise-band move", () => {
    const history = [
      { date: "2026-07-19", value: 11.0 },
      { date: "2026-08-19", value: 11.02 }, // +0.18%, under 0.5% band
    ];
    const result = evaluateFxCondition({
      latest: { observationDate: d("2026-08-19"), midRate: 11.02 },
      previous: { observationDate: d("2026-08-18"), midRate: 11.01 },
      history,
    });
    expect(result.state).toBe("STABLE");
  });

  it("falls back to latest-vs-previous when there isn't enough history for a 1M comparison", () => {
    const result = evaluateFxCondition({
      latest: { observationDate: d("2026-08-19"), midRate: 11.08 },
      previous: { observationDate: d("2026-08-18"), midRate: 11.0 },
      history: [{ date: "2026-08-19", value: 11.08 }],
    });
    expect(result.state).toBe("WEAKENING");
    expect(result.explanation).toContain("latest observation");
  });
});
