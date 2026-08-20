import { describe, it, expect } from "vitest";
import { extractCpiRows, validateCpiRows } from "../ingestion/gss-cpi-parser";

describe("extractCpiRows", () => {
  it("extracts rows along the Month dimension", () => {
    const data = { dimension: { Month: { category: { index: { "2026M01": 0 } } } }, value: [3.8] };
    expect(extractCpiRows(data)).toEqual([{ periodKey: "2026M01", value: 3.8 }]);
  });
});

describe("validateCpiRows", () => {
  it("accepts a valid observation", () => {
    const result = validateCpiRows([{ periodKey: "2026M01", value: 3.8 }]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].value).toBe("3.8");
    expect(result.valid[0].observationDate.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("rejects a malformed period", () => {
    const result = validateCpiRows([{ periodKey: "January 2026", value: 3.8 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a non-finite value", () => {
    const result = validateCpiRows([{ periodKey: "2026M01", value: NaN }]);
    expect(result.valid).toHaveLength(0);
  });

  it("treats a missing (null) value as rejected, never stored as zero", () => {
    const result = validateCpiRows([{ periodKey: "1998M06", value: null }]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors[0]).toContain("missing");
  });

  it("does not reject a large historical spike as implausible", () => {
    const result = validateCpiRows([{ periodKey: "2001M01", value: 40.5 }]);
    expect(result.valid).toHaveLength(1);
  });
});
