import { describe, it, expect } from "vitest";
import { computeROE, computeROA, computePE, computePB, computeDividendYield } from "../financial-ratios";

describe("computeROE", () => {
  it("computes PAT over average of latest and prior equity", () => {
    const result = computeROE(1000, 5000, 4000);
    expect(result!.value).toBeCloseTo((1000 / 4500) * 100, 5);
  });

  it("is unavailable (not silently switched to ending-equity-only) when prior equity is missing", () => {
    expect(computeROE(1000, 5000, null)).toBeNull();
  });

  it("is unavailable when average equity is zero or negative", () => {
    expect(computeROE(1000, 1000, -1000)).toBeNull();
  });
});

describe("computeROA", () => {
  it("computes PAT over average of latest and prior assets", () => {
    const result = computeROA(1000, 20000, 18000);
    expect(result!.value).toBeCloseTo((1000 / 19000) * 100, 5);
  });

  it("is unavailable when prior assets are missing", () => {
    expect(computeROA(1000, 20000, null)).toBeNull();
  });
});

describe("computePE", () => {
  it("computes price over annual EPS", () => {
    const result = computePE(10, 0.5);
    expect(result!.value).toBe(20);
  });

  it("returns null for negative EPS rather than a misleading negative P/E", () => {
    expect(computePE(10, -0.5)).toBeNull();
  });

  it("returns null for zero EPS", () => {
    expect(computePE(10, 0)).toBeNull();
  });

  it("returns null for a non-positive price", () => {
    expect(computePE(0, 0.5)).toBeNull();
  });
});

describe("computePB", () => {
  it("computes price over book value per share", () => {
    const result = computePB(10, 5000, 1000); // book value/share = 5
    expect(result!.value).toBe(2);
  });

  it("returns null when shares outstanding is zero", () => {
    expect(computePB(10, 5000, 0)).toBeNull();
  });

  it("returns null when equity is negative (negative book value per share)", () => {
    expect(computePB(10, -5000, 1000)).toBeNull();
  });
});

describe("computeDividendYield", () => {
  it("computes DPS over market price", () => {
    const result = computeDividendYield(0.2, 10);
    expect(result!.value).toBeCloseTo(2, 5);
  });

  it("returns exactly 0%, not null, when DPS is legitimately zero (no dividend paid)", () => {
    const result = computeDividendYield(0, 10);
    expect(result!.value).toBe(0);
  });

  it("returns null for a negative DPS", () => {
    expect(computeDividendYield(-0.1, 10)).toBeNull();
  });

  it("returns null for a non-positive price", () => {
    expect(computeDividendYield(0.2, 0)).toBeNull();
  });
});
