import { describe, it, expect } from "vitest";
import {
  parseCsvLines,
  validateMacroRows,
} from "../ingestion/macro-provider";

describe("parseCsvLines", () => {
  it("parses valid CSV with header and rows", () => {
    const csv = "observation_date,value\n2026-01-01,10.5\n2026-02-01,11.1";
    const rows = parseCsvLines(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].observation_date).toBe("2026-01-01");
    expect(rows[0].value).toBe("10.5");
  });

  it("returns empty array for header-only CSV", () => {
    const csv = "observation_date,value";
    expect(parseCsvLines(csv)).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsvLines("")).toHaveLength(0);
  });

  it("handles trailing whitespace", () => {
    const csv = "observation_date,value\n  2026-01-01 , 10.5 \n";
    const rows = parseCsvLines(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].observation_date).toBe("2026-01-01");
    expect(rows[0].value).toBe("10.5");
  });
});

describe("validateMacroRows", () => {
  it("accepts valid rows and rejects invalid ones", () => {
    const rows = [
      { observation_date: "2026-01-01", value: "10.5" },
      { observation_date: "2026-02-01", value: "11.1" },
      { observation_date: "invalid", value: "10" },
    ];

    const result = validateMacroRows(rows);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.length).toBeGreaterThan(0);
  });

  it("rejects rows with non-numeric values", () => {
    const rows = [{ observation_date: "2026-01-01", value: "abc" }];
    const result = validateMacroRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects rows with empty dates", () => {
    const rows = [{ observation_date: "", value: "10" }];
    const result = validateMacroRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it("normalises parsed dates to Date objects", () => {
    const rows = [{ observation_date: "2026-03-15", value: "42.0" }];
    const result = validateMacroRows(rows);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].observationDate).toBeInstanceOf(Date);
    expect(result.valid[0].value).toBe("42.0");
  });
});
