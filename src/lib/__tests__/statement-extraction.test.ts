import { describe, it, expect } from "vitest";
import {
  parseStatementNumber,
  detectScale,
  convertPesewasToGhs,
  parseColumnYears,
  selectColumnForYear,
  buildExtractionCandidate,
} from "../ingestion/statement-extraction";

describe("parseStatementNumber — parentheses / negative numbers (M7.1 §22)", () => {
  it("parses a plain number with thousands commas", () => {
    expect(parseStatementNumber("12,450")).toBe("12450");
  });

  it("parses a decimal number", () => {
    expect(parseStatementNumber("0.45")).toBe("0.45");
  });

  it("treats a parenthesized figure as negative", () => {
    expect(parseStatementNumber("(125,400)")).toBe("-125400");
  });

  it("treats a leading-minus figure as negative", () => {
    expect(parseStatementNumber("-125,400")).toBe("-125400");
  });

  it("treats a bare dash as MISSING (null), never zero", () => {
    expect(parseStatementNumber("-")).toBeNull();
    expect(parseStatementNumber("—")).toBeNull();
    expect(parseStatementNumber("n/a")).toBeNull();
  });

  it("treats an empty cell as unparsable (undefined), distinct from a dash", () => {
    expect(parseStatementNumber("")).toBeUndefined();
    expect(parseStatementNumber("   ")).toBeUndefined();
  });

  it("returns undefined (not a guess) for garbage text", () => {
    expect(parseStatementNumber("see note 14")).toBeUndefined();
  });
});

describe("detectScale — unit hints (M7.1 §21)", () => {
  it("recognises GH¢'000 / thousand hints", () => {
    expect(detectScale("Amounts in GH¢'000")).toBe("GHS_THOUSANDS");
    expect(detectScale("GHS thousand")).toBe("GHS_THOUSANDS");
  });

  it("recognises GHS million hints", () => {
    expect(detectScale("All figures in GHS million unless stated")).toBe("GHS_MILLIONS");
  });

  it("recognises pesewas", () => {
    expect(detectScale("Earnings per share (Gp)")).toBe("PESEWAS");
    expect(detectScale("stated in pesewas")).toBe("PESEWAS");
  });

  it("falls back to plain GHS when no scale word is present", () => {
    expect(detectScale("GH¢")).toBe("GHS");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(detectScale("Note 12")).toBeNull();
  });
});

describe("convertPesewasToGhs — EPS/DPS sub-unit handling (M7.1 §23)", () => {
  it("divides by 100 (pesewas is a GHS sub-unit, never scaled like GHS_THOUSANDS)", () => {
    expect(convertPesewasToGhs("45")).toBe("0.45");
  });
});

describe("parseColumnYears / selectColumnForYear — current vs comparative column (M7.1 §20)", () => {
  it("extracts years left-to-right from a header line", () => {
    expect(parseColumnYears("Note        2025        2024")).toEqual([2025, 2024]);
  });

  it("selects the value under the CURRENT year's column, not the comparative one", () => {
    const years = parseColumnYears("2025  2024");
    const row = ["12,450", "10,800"];
    expect(selectColumnForYear(years, row, 2025)).toBe("12,450");
    expect(selectColumnForYear(years, row, 2024)).toBe("10,800");
  });

  it("does not accidentally return the comparative figure when asked for the current year", () => {
    // The exact failure mode named in the brief: silently importing 2024's
    // comparative value as though it were 2025's headline figure.
    const years = parseColumnYears("2025 2024");
    const row = ["12,450", "10,800"];
    const selected = selectColumnForYear(years, row, 2025);
    expect(selected).not.toBe("10,800");
    expect(selected).toBe("12,450");
  });

  it("returns null when the target year isn't in the header at all, rather than guessing a position", () => {
    const years = parseColumnYears("2025 2024");
    const row = ["12,450", "10,800"];
    expect(selectColumnForYear(years, row, 2023)).toBeNull();
  });

  it("handles a 3-column header (current, prior, prior-prior)", () => {
    const years = parseColumnYears("2025  2024  2023");
    const row = ["12,450", "10,800", "9,600"];
    expect(selectColumnForYear(years, row, 2023)).toBe("9,600");
  });
});

describe("buildExtractionCandidate — confidence classification (M7.1 §19)", () => {
  it("classifies HIGH_CONFIDENCE when label, year column, and unit all resolve cleanly", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Profit after tax",
      columnYears: [2025, 2024],
      rowValues: ["3,200", "2,800"],
      targetYear: 2025,
      unitHintText: "GH¢'000",
    });
    expect(candidate.confidence).toBe("HIGH_CONFIDENCE");
    expect(candidate.reportedValue).toBe("3200");
    expect(candidate.reportedUnit).toBe("GHS_THOUSANDS");
  });

  it("classifies REVIEW_REQUIRED when the value is real but the label doesn't resolve to a known metric", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Total comprehensive income for the year",
      columnYears: [2025, 2024],
      rowValues: ["3,200", "2,800"],
      targetYear: 2025,
      unitHintText: "GH¢'000",
    });
    expect(candidate.confidence).toBe("REVIEW_REQUIRED");
    expect(candidate.reasons.join(" ")).toContain("did not match a known metric alias");
  });

  it("classifies REVIEW_REQUIRED when the value is real but no unit hint was found", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Revenue",
      columnYears: [2025, 2024],
      rowValues: ["3,200", "2,800"],
      targetYear: 2025,
      unitHintText: "Note 4",
    });
    expect(candidate.confidence).toBe("REVIEW_REQUIRED");
    expect(candidate.reasons.join(" ")).toContain("no unit hint recognised");
  });

  it("classifies REJECTED (not REVIEW_REQUIRED) for a dash — there is no number to review", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Revenue",
      columnYears: [2025, 2024],
      rowValues: ["-", "10,800"],
      targetYear: 2025,
      unitHintText: "GH¢'000",
    });
    expect(candidate.confidence).toBe("REJECTED");
    expect(candidate.reportedValue).toBeNull();
  });

  it("classifies REJECTED when the target year isn't present in the header", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Revenue",
      columnYears: [2025, 2024],
      rowValues: ["12,450", "10,800"],
      targetYear: 2022,
      unitHintText: "GH¢'000",
    });
    expect(candidate.confidence).toBe("REJECTED");
  });

  it("classifies REJECTED for an unparsable cell", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Revenue",
      columnYears: [2025, 2024],
      rowValues: ["see note 4", "10,800"],
      targetYear: 2025,
      unitHintText: "GH¢'000",
    });
    expect(candidate.confidence).toBe("REJECTED");
  });

  it("handles a negative (parenthesized) profit figure end to end", () => {
    const candidate = buildExtractionCandidate({
      reportedLabel: "Profit after tax",
      columnYears: [2025, 2024],
      rowValues: ["(125,400)", "98,200"],
      targetYear: 2025,
      unitHintText: "GH¢'000",
    });
    expect(candidate.confidence).toBe("HIGH_CONFIDENCE");
    expect(candidate.reportedValue).toBe("-125400");
  });
});
