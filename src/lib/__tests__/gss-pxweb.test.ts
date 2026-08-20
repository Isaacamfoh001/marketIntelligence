import { describe, it, expect } from "vitest";
import { extractPxWebSeries, parseGssMonth, parseGssQuarter, validatePxWebValue } from "../ingestion/gss-pxweb";

describe("extractPxWebSeries", () => {
  it("maps value array positions to period keys via category.index, not insertion order", () => {
    const data = {
      dimension: {
        Month: { category: { index: { "2026M02": 1, "2026M01": 0, "2026M03": 2 } } },
      },
      value: [3.8, 3.3, 4.1],
    };
    expect(extractPxWebSeries(data, "Month")).toEqual([
      { periodKey: "2026M01", value: 3.8 },
      { periodKey: "2026M02", value: 3.3 },
      { periodKey: "2026M03", value: 4.1 },
    ]);
  });

  it("preserves null values rather than coercing them", () => {
    const data = { dimension: { Month: { category: { index: { "2026M01": 0 } } } }, value: [null] };
    expect(extractPxWebSeries(data, "Month")).toEqual([{ periodKey: "2026M01", value: null }]);
  });

  it("returns an empty array when the requested dimension is absent", () => {
    const data = { dimension: {}, value: [] };
    expect(extractPxWebSeries(data, "Month")).toEqual([]);
  });
});

describe("parseGssMonth", () => {
  it("parses a valid month key to the last day of that month", () => {
    const result = parseGssMonth("2026M01");
    expect(result.error).toBeNull();
    expect(result.date?.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("uses the correct last day across month lengths, including leap February", () => {
    expect(parseGssMonth("2024M02").date?.toISOString().slice(0, 10)).toBe("2024-02-29"); // leap year
    expect(parseGssMonth("2026M02").date?.toISOString().slice(0, 10)).toBe("2026-02-28"); // non-leap
    expect(parseGssMonth("2026M04").date?.toISOString().slice(0, 10)).toBe("2026-04-30");
  });

  it("rejects a malformed period", () => {
    expect(parseGssMonth("2026-01").error).not.toBeNull();
    expect(parseGssMonth("not-a-period").error).not.toBeNull();
  });

  it("rejects an out-of-range month", () => {
    expect(parseGssMonth("2026M13").error).not.toBeNull();
    expect(parseGssMonth("2026M00").error).not.toBeNull();
  });
});

describe("parseGssQuarter", () => {
  it("parses each quarter to its last calendar day", () => {
    expect(parseGssQuarter("2026Q1").date?.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(parseGssQuarter("2026Q2").date?.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(parseGssQuarter("2026Q3").date?.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(parseGssQuarter("2026Q4").date?.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("rejects a malformed quarter", () => {
    expect(parseGssQuarter("2026-Q1").error).not.toBeNull();
    expect(parseGssQuarter("2026Q5").error).not.toBeNull();
    expect(parseGssQuarter("not-a-quarter").error).not.toBeNull();
  });
});

describe("validatePxWebValue", () => {
  const bounds = { min: -50, max: 150 };

  it("accepts a value within bounds", () => {
    const result = validatePxWebValue(6.4, "rate", bounds);
    expect(result.error).toBeNull();
    expect(result.value).toBe("6.4");
  });

  it("treats null as missing, not zero", () => {
    const result = validatePxWebValue(null, "rate", bounds);
    expect(result.value).toBeNull();
    expect(result.error?.message).toContain("missing");
  });

  it("rejects non-finite values", () => {
    expect(validatePxWebValue(NaN, "rate", bounds).error).not.toBeNull();
    expect(validatePxWebValue(Infinity, "rate", bounds).error).not.toBeNull();
  });

  it("rejects a value outside the plausible bound", () => {
    expect(validatePxWebValue(500, "rate", bounds).error).not.toBeNull();
    expect(validatePxWebValue(-100, "rate", bounds).error).not.toBeNull();
  });
});
