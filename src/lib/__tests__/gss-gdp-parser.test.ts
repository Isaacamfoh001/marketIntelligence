import { describe, it, expect } from "vitest";
import { extractGdpRows, validateGdpRows } from "../ingestion/gss-gdp-parser";

describe("extractGdpRows", () => {
  it("extracts rows along the Quarter dimension", () => {
    const data = { dimension: { Quarter: { category: { index: { "2026Q1": 0 } } } }, value: [6.4] };
    expect(extractGdpRows(data)).toEqual([{ periodKey: "2026Q1", value: 6.4 }]);
  });
});

describe("validateGdpRows", () => {
  it("accepts a valid quarter, matching GSS's own headline figure", () => {
    const result = validateGdpRows([{ periodKey: "2026Q1", value: 6.4 }]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].value).toBe("6.4");
    expect(result.valid[0].observationDate.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("rejects a malformed quarter", () => {
    const result = validateGdpRows([{ periodKey: "Q1 2026", value: 6.4 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a non-finite growth value", () => {
    const result = validateGdpRows([{ periodKey: "2026Q1", value: NaN }]);
    expect(result.valid).toHaveLength(0);
  });

  it("treats a missing (null) value as rejected, never stored as zero", () => {
    const result = validateGdpRows([{ periodKey: "2006Q1", value: null }]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors[0]).toContain("missing");
  });

  it("does not reject a genuine large contraction (e.g. COVID-era) as implausible", () => {
    const result = validateGdpRows([{ periodKey: "2020Q2", value: -5.6 }]);
    expect(result.valid).toHaveLength(1);
  });
});
