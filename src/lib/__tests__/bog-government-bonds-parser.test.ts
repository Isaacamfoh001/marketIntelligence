import { describe, it, expect } from "vitest";
import { filterGovBondCandidateRows, isRecentEnough, validateGovBondRows } from "../ingestion/bog-government-bonds-parser";
import type { RawTreasuryRow } from "../ingestion/bog-treasury-parser";

function row(dateText: string, tenderNumber: string, securityType: string, discountText: string, interestText: string): RawTreasuryRow {
  return { dateText, tenderNumber, securityType, discountText, interestText };
}

describe("filterGovBondCandidateRows", () => {
  it("keeps N YR FXR BOND/NOTE rows and excludes bills", () => {
    const rows = [
      row("07 Sep 2026", "2023", "4 YR FXR BOND", "12.00", "12.00"),
      row("28 Sep 2026", "2026", "91 DAY BILL", "4.6244", "4.6785"),
      row("09 May 2022", "1797", "2 YR FXR NOTE", "21.50", "21.50"),
    ];
    const result = filterGovBondCandidateRows(rows);
    expect(result.map((r) => r.securityType)).toEqual(["4 YR FXR BOND", "2 YR FXR NOTE"]);
  });
});

describe("isRecentEnough", () => {
  const now = new Date("2026-10-04T00:00:00.000Z");

  it("accepts a recent auction within the cutoff", () => {
    expect(isRecentEnough(new Date("2026-09-07T00:00:00.000Z"), now, 400)).toBe(true);
  });

  it("rejects a stale pre-restructuring auction beyond the cutoff", () => {
    expect(isRecentEnough(new Date("2022-05-09T00:00:00.000Z"), now, 400)).toBe(false);
  });

  it("rejects a future-dated row (data error, not a real auction yet)", () => {
    expect(isRecentEnough(new Date("2027-01-01T00:00:00.000Z"), now, 400)).toBe(false);
  });
});

describe("validateGovBondRows", () => {
  it("accepts a well-formed fixed-rate bond auction row and uses the published rate as both discount and interest agree", () => {
    const result = validateGovBondRows([row("07 Sep 2026", "2023", "4 YR FXR BOND", "12.0000", "12.0000")]);
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]).toMatchObject({ tenorYears: 4, ratePct: "12.0000", tenderNumber: "2023" });
  });

  it("rejects a row where discount and interest rates disagree (not a recognised fixed-coupon auction quote)", () => {
    const result = validateGovBondRows([row("07 Sep 2026", "2023", "4 YR FXR BOND", "11.0000", "12.0000")]);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a row whose security type isn't a government bond/note", () => {
    const result = validateGovBondRows([row("07 Sep 2026", "2023", "91 DAY BILL", "12.0000", "12.0000")]);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects an unparseable date", () => {
    const result = validateGovBondRows([row("not a date", "2023", "4 YR FXR BOND", "12.0000", "12.0000")]);
    expect(result.invalid).toHaveLength(1);
  });
});
