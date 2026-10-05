import { describe, expect, it } from "vitest";
import { validateGseSecurityRows, type RawGseSecurityRow } from "../ingestion/gse-security-parser";

const NOW = new Date("2026-10-05T09:00:00Z");
const row = (over: RawGseSecurityRow = {}): RawGseSecurityRow => ({
  trading_date: "02/10/2026", share_code: "GCB", previous_close_vwap: "40.00", close_vwap: "40.00", shares_traded: "290", value_traded: "11600.00", ...over,
});

describe("validateGseSecurityRows — reliability rules", () => {
  it("accepts GSE's own dd/mm/yyyy format and keeps volume as the source stated it", () => {
    const { valid, invalid } = validateGseSecurityRows([row(), row({ share_code: "ALW", shares_traded: "0", value_traded: "0.00" })], { now: NOW });
    expect(invalid).toEqual([]);
    expect(valid.map((v) => [v.ticker, v.sharesTraded])).toEqual([["GCB", "290"], ["ALW", "0"]]); // 0 stays 0
  });
  it("keeps a blank volume as null (unknown), never 0", () => {
    const { valid } = validateGseSecurityRows([row({ shares_traded: "" })], { now: NOW });
    expect(valid[0].sharesTraded).toBeNull();
  });
  it("rejects a report date in the future; tolerates one day of publication/timezone skew", () => {
    expect(validateGseSecurityRows([row({ trading_date: "07/10/2026" })], { now: NOW }).invalid[0].errors[0]).toContain("in the future");
    expect(validateGseSecurityRows([row({ trading_date: "30/12/2026" })], { now: NOW }).valid).toHaveLength(0);
    expect(validateGseSecurityRows([row({ trading_date: "06/10/2026" })], { now: NOW }).valid).toHaveLength(1);
  });
  it("rejects a malformed row without discarding its neighbours, with the file row number", () => {
    const { valid, invalid } = validateGseSecurityRows([row(), row({ share_code: "KASA", close_vwap: "abc" }), row({ share_code: "MTNGH" })], { now: NOW });
    expect(valid.map((v) => v.ticker)).toEqual(["GCB", "MTNGH"]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].rowNumber).toBe(3);
  });
  it("strips GSE's asterisk decoration so one security is never split into two tickers", () => {
    expect(validateGseSecurityRows([row({ share_code: "**ALW**" })], { now: NOW }).valid[0].ticker).toBe("ALW");
  });
  it("drops an identical duplicate row (keeps the first) and records the rejection", () => {
    const { valid, invalid } = validateGseSecurityRows([row(), row()], { now: NOW });
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain("duplicate");
    expect(invalid[0].rowNumber).toBe(3);
  });
  it("rejects EVERY row of a conflicting duplicate — it will not guess which is right", () => {
    const { valid, invalid } = validateGseSecurityRows([row(), row({ close_vwap: "41.00" })], { now: NOW });
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(2);
    expect(invalid[0].errors[0]).toContain("conflicting");
  });
  it("same ticker on different report dates is not a duplicate", () => {
    expect(validateGseSecurityRows([row(), row({ trading_date: "01/10/2026" })], { now: NOW }).valid).toHaveLength(2);
  });
});
