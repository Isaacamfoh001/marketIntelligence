import { describe, it, expect } from "vitest";
import { parseCsv } from "../ingestion/file-parse";
import { extractGseSecurityRows, validateGseSecurityRows } from "../ingestion/gse-security-parser";

function csv(rows: string[][], headers: string[]): string {
  const lines = [headers.join(","), ...rows.map((r) => r.join(","))];
  return lines.join("\n");
}

const CANONICAL_HEADERS = [
  "Trading Date",
  "Share Code",
  "Previous Closing Price - VWAP",
  "Opening Price",
  "Last Transaction Price",
  "Closing Price - VWAP",
  "Price Change",
  "Closing Bid",
  "Closing Offer",
  "Total Shares Traded",
  "Total Value Traded",
  "Year High",
  "Year Low",
];

describe("extractGseSecurityRows + validateGseSecurityRows", () => {
  it("accepts a fully-populated row using GSE's real published column labels", () => {
    const text = csv(
      [["2026-08-17", "MTNGH", "2.45", "2.45", "2.50", "2.50", "0.05", "2.48", "2.52", "150000", "375000", "2.60", "1.90"]],
      CANONICAL_HEADERS,
    );
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);

    expect(result.invalid).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      ticker: "MTNGH",
      closeVwap: "2.50",
      previousCloseVwap: "2.45",
      priceChange: "0.05",
      closingBid: "2.48",
      closingOffer: "2.52",
      sharesTraded: "150000",
      valueTraded: "375000",
      yearHigh: "2.60",
      yearLow: "1.90",
    });
    expect(result.valid[0].tradingDate.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("accepts Korbly's own documented snake_case template headers equally", () => {
    const text = csv(
      [["2026-08-17", "MTNGH", "", "", "", "2.50", "", "", "", "", "", "", ""]],
      ["trading_date", "share_code", "previous_close_vwap", "open_price", "last_transaction_price", "close_vwap", "price_change", "closing_bid", "closing_offer", "shares_traded", "value_traded", "year_high", "year_low"],
    );
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].closeVwap).toBe("2.50");
  });

  it("requires trading_date, share_code, and close_vwap; rejects a row missing close_vwap", () => {
    const text = csv([["2026-08-17", "MTNGH", "", "", "", "", "", "", "", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.join(" ")).toContain("close_vwap");
  });

  it("distinguishes a blank shares_traded/value_traded cell (missing) from an explicit 0 (real no-trade day)", () => {
    const text = csv(
      [
        ["2026-08-17", "MTNGH", "", "", "", "2.50", "", "", "", "0", "0", "", ""],
        ["2026-08-18", "MTNGH", "", "", "", "2.50", "", "", "", "", "", "", ""],
      ],
      CANONICAL_HEADERS,
    );
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0].sharesTraded).toBe("0");
    expect(result.valid[0].valueTraded).toBe("0");
    expect(result.valid[1].sharesTraded).toBeNull();
    expect(result.valid[1].valueTraded).toBeNull();
  });

  it("rejects a malformed trading date without persisting a fabricated one", () => {
    const text = csv([["17th August 2026", "MTNGH", "", "", "", "2.50", "", "", "", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("trading_date");
  });

  it("rejects a non-numeric price without persisting it", () => {
    const text = csv([["2026-08-17", "MTNGH", "", "", "", "n/a", "", "", "", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("close_vwap");
  });

  it("rejects a malformed volume without persisting it", () => {
    const text = csv([["2026-08-17", "MTNGH", "", "", "", "2.50", "", "", "", "not-a-number", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("shares_traded");
  });

  it("rejects a bid greater than the offer as an out-of-order quote", () => {
    const text = csv([["2026-08-17", "MTNGH", "", "", "", "2.50", "", "2.60", "2.40", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("closing_bid");
  });

  it("rejects an implausible ticker shape", () => {
    const text = csv([["2026-08-17", "not a ticker!", "", "", "", "2.50", "", "", "", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid).toHaveLength(0);
  });

  it("uppercases the ticker regardless of input case", () => {
    const text = csv([["2026-08-17", "mtngh", "", "", "", "2.50", "", "", "", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid[0].ticker).toBe("MTNGH");
  });

  it("accepts a negative price_change (a down day)", () => {
    const text = csv([["2026-08-17", "GCB", "", "", "", "5.05", "-0.05", "", "", "", "", "", ""]], CANONICAL_HEADERS);
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid[0].priceChange).toBe("-0.05");
  });

  it("reports a 1-based rowNumber accounting for the header row, so 'row 2' is the first data row", () => {
    const text = csv(
      [
        ["2026-08-17", "MTNGH", "", "", "", "2.50", "", "", "", "", "", "", ""],
        ["2026-08-17", "GCB", "", "", "", "not-a-price", "", "", "", "", "", "", ""],
      ],
      CANONICAL_HEADERS,
    );
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.invalid[0].rowNumber).toBe(3);
  });

  it("classifies an ETF row from an explicit security_type column", () => {
    const text = csv(
      [["2026-08-17", "GLD", "", "", "", "10.00", "", "", "", "", "", "", "ETF"]],
      ["trading_date", "share_code", "previous_close_vwap", "open_price", "last_transaction_price", "close_vwap", "price_change", "closing_bid", "closing_offer", "shares_traded", "value_traded", "year_high", "security_type"],
    );
    const rows = extractGseSecurityRows(parseCsv(text));
    const result = validateGseSecurityRows(rows);
    expect(result.valid[0].securityType).toBe("ETF");
  });
});
