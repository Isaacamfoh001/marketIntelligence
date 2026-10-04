import { describe, it, expect } from "vitest";
import { extractFixedIncomeSecurityRows, validateFixedIncomeSecurityRows } from "../ingestion/fixed-income-securities-parser";
import { parseCsv } from "../ingestion/file-parse";

function parseCsvRows(csv: string) {
  const parsedFile = parseCsv(csv);
  return extractFixedIncomeSecurityRows(parsedFile);
}

const HEADER =
  "Instrument Code,Instrument Name,Issuer Name,Ticker,Instrument Type,Currency,Issue Date,Maturity Date,Coupon Type,Coupon Rate,Coupon Frequency,Face Value,Status";

describe("validateFixedIncomeSecurityRows — corporate fixed-rate bond", () => {
  it("accepts a well-formed corporate bond row", () => {
    const csv = `${HEADER}\nKASA-BND-2027,Kasapreko 2027 Corporate Bond,Kasapreko Company PLC,KASA,CORPORATE_BOND,GHS,2024-06-15,2027-06-15,FIXED,22.5,SEMI_ANNUAL,100,ACTIVE`;
    const rows = parseCsvRows(csv);
    const result = validateFixedIncomeSecurityRows(rows);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      instrumentCode: "KASA-BND-2027",
      issuerName: "Kasapreko Company PLC",
      ticker: "KASA",
      instrumentType: "CORPORATE_BOND",
      couponType: "FIXED",
      couponFrequency: "SEMI_ANNUAL",
      faceValue: "100",
      status: "ACTIVE",
    });
  });

  it("accepts an unlisted issuer with no ticker", () => {
    const csv = `${HEADER}\nBAYP-BND-2026,Bayport 2026 Bond,Bayport Savings and Loans PLC,,CORPORATE_BOND,GHS,2023-03-01,2026-03-01,FIXED,24,QUARTERLY,100,ACTIVE`;
    const rows = parseCsvRows(csv);
    const result = validateFixedIncomeSecurityRows(rows);
    expect(result.invalid).toEqual([]);
    expect(result.valid[0].ticker).toBeNull();
  });

  it("defaults face_value to 100 when blank", () => {
    const csv = `${HEADER}\nX1,X Bond,X Co,,CORPORATE_BOND,GHS,2024-01-01,2027-01-01,FIXED,20,ANNUAL,,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.valid[0].faceValue).toBe("100");
  });

  it("rejects a missing instrument_code", () => {
    const csv = `${HEADER}\n,X Bond,X Co,,CORPORATE_BOND,GHS,2024-01-01,2027-01-01,FIXED,20,ANNUAL,100,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.join(" ")).toMatch(/instrument_code is required/);
  });

  it("rejects maturity_date on or before issue_date", () => {
    const csv = `${HEADER}\nX1,X Bond,X Co,,CORPORATE_BOND,GHS,2027-01-01,2024-01-01,FIXED,20,ANNUAL,100,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.join(" ")).toMatch(/maturity_date/);
  });

  it("requires coupon_rate and coupon_frequency for FIXED", () => {
    const csv = `${HEADER}\nX1,X Bond,X Co,,CORPORATE_BOND,GHS,2024-01-01,2027-01-01,FIXED,,,100,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining("coupon_rate is required"), expect.stringContaining("coupon_frequency is required")]),
    );
  });

  it("rejects a non-blank coupon_rate/coupon_frequency for ZERO_COUPON", () => {
    const csv = `${HEADER}\nX1,X Bond,X Co,,GOVERNMENT_BOND,GHS,2024-01-01,2027-01-01,ZERO_COUPON,5,ANNUAL,100,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.join(" ")).toMatch(/coupon_rate must be blank/);
  });

  it("accepts GOVERNMENT alias for instrument_type and GOG issuer", () => {
    const csv = `${HEADER}\nGOG-BND-2030,GoG 2030 Bond,Government of Ghana,,GOVERNMENT,GHS,2025-01-01,2030-01-01,FIXED,19,SEMI_ANNUAL,100,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.invalid).toEqual([]);
    expect(result.valid[0].instrumentType).toBe("GOVERNMENT_BOND");
  });

  it("rejects an unrecognised instrument_type", () => {
    const csv = `${HEADER}\nX1,X Bond,X Co,,MUNICIPAL,GHS,2024-01-01,2027-01-01,FIXED,20,ANNUAL,100,ACTIVE`;
    const result = validateFixedIncomeSecurityRows(parseCsvRows(csv));
    expect(result.invalid).toHaveLength(1);
  });
});
