import { describe, it, expect } from "vitest";
import { rankByMateriality } from "../materiality";

describe("rankByMateriality", () => {
  it("ranks by multiples of each candidate's own noise band, not raw magnitude", () => {
    // inflation moved 2x its own 0.2pp band; GSE-CI moved only 1x its own 1% band —
    // inflation should rank first despite a smaller raw number (0.4 < 4.0).
    const order = rankByMateriality([
      { key: "gse-ci", absChange: 4.0, noiseBand: 4.0 },
      { key: "inflation", absChange: 0.4, noiseBand: 0.2 },
    ]);
    expect(order).toEqual(["inflation", "gse-ci"]);
  });

  it("breaks ties by input order for determinism", () => {
    const order = rankByMateriality([
      { key: "a", absChange: 1, noiseBand: 1 },
      { key: "b", absChange: 2, noiseBand: 2 },
    ]);
    expect(order).toEqual(["a", "b"]);
  });

  it("treats a non-positive noise band as maximally material rather than dividing by zero", () => {
    const order = rankByMateriality([
      { key: "normal", absChange: 100, noiseBand: 1 },
      { key: "zero-band", absChange: 0.01, noiseBand: 0 },
    ]);
    expect(order[0]).toBe("zero-band");
  });
});
