import { describe, it, expect } from "vitest";
import {
  requireString,
  parseDate,
  parseDecimal,
  validateRows,
} from "../validation/index";

describe("requireString", () => {
  it("returns null for valid strings", () => {
    expect(requireString("hello", "field")).toBeNull();
    expect(requireString("  x  ", "field")).toBeNull();
  });

  it("returns error for null/undefined/empty", () => {
    expect(requireString(null, "field")).not.toBeNull();
    expect(requireString(undefined, "field")).not.toBeNull();
    expect(requireString("", "field")).not.toBeNull();
    expect(requireString("   ", "field")).not.toBeNull();
  });
});

describe("parseDate", () => {
  it("parses valid date strings", () => {
    const result = parseDate("2026-01-15", "field");
    expect(result.error).toBeNull();
    expect(result.date).toBeInstanceOf(Date);
  });

  it("rejects invalid dates", () => {
    const result = parseDate("invalid", "field");
    expect(result.date).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("rejects empty strings", () => {
    const result = parseDate("", "field");
    expect(result.date).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("rejects null/undefined", () => {
    expect(parseDate(null, "field").error).not.toBeNull();
    expect(parseDate(undefined, "field").error).not.toBeNull();
  });
});

describe("parseDecimal", () => {
  it("parses valid numbers", () => {
    expect(parseDecimal("10.5", "field").value).toBe("10.5");
    expect(parseDecimal("0", "field").value).toBe("0");
    expect(parseDecimal("-3.14", "field").value).toBe("-3.14");
  });

  it("strips thousands separators", () => {
    expect(parseDecimal("1,000.50", "field").value).toBe("1000.50");
  });

  it("rejects non-numeric strings", () => {
    expect(parseDecimal("abc", "field").error).not.toBeNull();
    expect(parseDecimal("invalid", "field").error).not.toBeNull();
  });

  it("rejects empty/null", () => {
    expect(parseDecimal("", "field").error).not.toBeNull();
    expect(parseDecimal(null, "field").error).not.toBeNull();
  });
});

describe("validateRows", () => {
  it("partitions valid and invalid rows", () => {
    const rows = [
      { date: "2026-01-01", value: "10" },
      { date: "bad", value: "10" },
      { date: "2026-02-01", value: "abc" },
    ];

    const result = validateRows(
      rows,
      (row) => ({ date: row.date, value: row.value }),
      (row) => {
        const errors: { field: string; message: string }[] = [];
        const d = parseDate(row.date, "date");
        if (d.error) errors.push(d.error);
        const v = parseDecimal(row.value, "value");
        if (v.error) errors.push(v.error);
        return errors;
      },
    );

    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(2);
  });
});
