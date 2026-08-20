import { describe, it, expect } from "vitest";
import { parseCsv } from "../ingestion/file-parse";
import { extractGseIndexRows, validateGseIndexRows } from "../ingestion/gse-index-parser";

function csv(rows: string[][], headers: string[]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

const HEADERS = ["Trading Date", "GSE-CI", "GSE-FSI", "Market Capitalization", "Total Volume", "Total Value Traded"];

describe("extractGseIndexRows + validateGseIndexRows", () => {
  it("accepts a fully-populated market-summary row", () => {
    const text = csv([["2026-08-17", "6120.45", "3980.10", "95000000000", "1250000", "3400000"]], HEADERS);
    const rows = extractGseIndexRows(parseCsv(text));
    const result = validateGseIndexRows(rows);

    expect(result.invalid).toHaveLength(0);
    expect(result.valid[0]).toMatchObject({
      gseCi: "6120.45",
      gseFsi: "3980.10",
      marketCapGhs: "95000000000",
      totalVolume: "1250000",
      totalValueTradedGhs: "3400000",
    });
  });

  it("accepts a GSE-CI-only row (GSE-FSI legitimately not always published)", () => {
    const text = csv([["2026-08-17", "6120.45", "", "", "", ""]], HEADERS);
    const rows = extractGseIndexRows(parseCsv(text));
    const result = validateGseIndexRows(rows);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].gseCi).toBe("6120.45");
    expect(result.valid[0].gseFsi).toBeNull();
  });

  it("rejects a row with a valid date but no index or summary value at all", () => {
    const text = csv([["2026-08-17", "", "", "", "", ""]], HEADERS);
    const rows = extractGseIndexRows(parseCsv(text));
    const result = validateGseIndexRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("no index level or market-summary value");
  });

  it("rejects a malformed index level without persisting it", () => {
    const text = csv([["2026-08-17", "not-a-number", "", "", "", ""]], HEADERS);
    const rows = extractGseIndexRows(parseCsv(text));
    const result = validateGseIndexRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.join(" ")).toContain("gse_ci");
  });

  it("rejects a malformed trading date", () => {
    const text = csv([["not a date", "6120.45", "", "", "", ""]], HEADERS);
    const rows = extractGseIndexRows(parseCsv(text));
    const result = validateGseIndexRows(rows);
    expect(result.valid).toHaveLength(0);
  });

  it("accepts DD/MM/YYYY and 'DD MMM YYYY' as well as ISO dates", () => {
    const slash = validateGseIndexRows(extractGseIndexRows(parseCsv(csv([["17/08/2026", "6120.45", "", "", "", ""]], HEADERS))));
    expect(slash.valid[0].tradingDate.toISOString().slice(0, 10)).toBe("2026-08-17");

    const textMonth = validateGseIndexRows(extractGseIndexRows(parseCsv(csv([["17 Aug 2026", "6120.45", "", "", "", ""]], HEADERS))));
    expect(textMonth.valid[0].tradingDate.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("accepts a market-cap/volume-only row with no index level (whole-market facts published independently)", () => {
    const text = csv([["2026-08-17", "", "", "95000000000", "1250000", "3400000"]], HEADERS);
    const rows = extractGseIndexRows(parseCsv(text));
    const result = validateGseIndexRows(rows);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].gseCi).toBeNull();
    expect(result.valid[0].marketCapGhs).toBe("95000000000");
  });
});
