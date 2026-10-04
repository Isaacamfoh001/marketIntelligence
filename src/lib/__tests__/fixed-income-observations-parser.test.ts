import { describe, it, expect } from "vitest";
import { extractFixedIncomeObservationRows, validateFixedIncomeObservationRows } from "../ingestion/fixed-income-observations-parser";
import { parseCsv } from "../ingestion/file-parse";

function parseCsvRows(csv: string) {
  return extractFixedIncomeObservationRows(parseCsv(csv));
}

const HEADER = "Instrument Code,Observation Date,Clean Price,Yield,Volume Traded";

describe("validateFixedIncomeObservationRows", () => {
  it("accepts a row with both price and yield", () => {
    const csv = `${HEADER}\nKASA-BND-2027,2026-01-15,97.5,23.1,500000`;
    const result = validateFixedIncomeObservationRows(parseCsvRows(csv));
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]).toMatchObject({ instrumentCode: "KASA-BND-2027", cleanPrice: "97.5", sourceYieldPct: "23.1", volumeTradedGhs: "500000" });
  });

  it("accepts a row with only price", () => {
    const csv = `${HEADER}\nKASA-BND-2027,2026-01-15,97.5,,`;
    const result = validateFixedIncomeObservationRows(parseCsvRows(csv));
    expect(result.invalid).toEqual([]);
    expect(result.valid[0].sourceYieldPct).toBeNull();
  });

  it("accepts a row with only yield", () => {
    const csv = `${HEADER}\nKASA-BND-2027,2026-01-15,,23.1,`;
    const result = validateFixedIncomeObservationRows(parseCsvRows(csv));
    expect(result.invalid).toEqual([]);
    expect(result.valid[0].cleanPrice).toBeNull();
  });

  it("rejects a row with neither price nor yield", () => {
    const csv = `${HEADER}\nKASA-BND-2027,2026-01-15,,,`;
    const result = validateFixedIncomeObservationRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.join(" ")).toMatch(/at least one of clean_price or source_yield/);
  });

  it("rejects a non-positive clean_price", () => {
    const csv = `${HEADER}\nKASA-BND-2027,2026-01-15,0,,`;
    const result = validateFixedIncomeObservationRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a missing observation_date", () => {
    const csv = `${HEADER}\nKASA-BND-2027,,97.5,,`;
    const result = validateFixedIncomeObservationRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
  });
});
