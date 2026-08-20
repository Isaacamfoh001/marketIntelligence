// ---------------------------------------------------------------------------
// GSE Daily Market Summary — manual/semi-automated import parser.
//
// Covers the whole-market summary: GSE-CI, GSE-FSI, market capitalization,
// total volume, and total value traded. Deliberately a single per-day row
// shape (not one file per index) since GSE publishes these together as
// one daily summary — see gse-index-provider.ts for how a row is split
// into MarketIndexObservation (per index) and MarketSummary (whole-market
// facts) rows without deriving either from constituent security prices
// (CLAUDE.md: never reconstruct GSE-CI from constituents).
// ---------------------------------------------------------------------------

import { parseDecimal } from "../validation/index";
import { parseGseFileDate } from "./gse-file-date";
import { findHeader, normalizeHeader, type ParsedFile } from "./file-parse";

const FIELD_ALIASES: Record<string, string[]> = {
  trading_date: ["trading date", "daily date", "date"],
  gse_ci: ["gse ci", "gse composite index", "composite index", "gse-ci"],
  gse_fsi: ["gse fsi", "gse financial stocks index", "financial stocks index", "gse-fsi"],
  market_cap_ghs: ["market capitalization", "market capitalisation", "market cap", "market cap ghs"],
  total_volume: ["total volume", "total market volume", "volume"],
  total_value_traded_ghs: ["total value traded", "value traded", "total turnover", "turnover"],
};

export interface RawGseIndexRow {
  [field: string]: string | undefined;
}

export interface NormalisedGseIndexRow {
  tradingDate: Date;
  gseCi: string | null;
  gseFsi: string | null;
  marketCapGhs: string | null;
  totalVolume: string | null;
  totalValueTradedGhs: string | null;
}

export function mapGseIndexColumns(rawHeaders: string[]): Record<string, string | null> {
  const normalized = rawHeaders.map(normalizeHeader);
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    mapping[field] = findHeader(normalized, aliases);
  }
  return mapping;
}

export function extractGseIndexRows(file: ParsedFile): RawGseIndexRow[] {
  const columnByField = mapGseIndexColumns(file.rawHeaders);
  return file.rows.map((row) => {
    const out: RawGseIndexRow = {};
    for (const [field, headerKey] of Object.entries(columnByField)) {
      out[field] = headerKey ? row[headerKey] : undefined;
    }
    return out;
  });
}

export interface GseIndexValidationResult {
  valid: NormalisedGseIndexRow[];
  invalid: { row: RawGseIndexRow; errors: string[]; rowNumber: number }[];
}

function optionalDecimal(raw: string | undefined, field: string, errors: string[]): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = parseDecimal(trimmed, field);
  if (parsed.error) {
    errors.push(parsed.error.message);
    return null;
  }
  return parsed.value;
}

export function validateGseIndexRows(rows: RawGseIndexRow[]): GseIndexValidationResult {
  const valid: NormalisedGseIndexRow[] = [];
  const invalid: { row: RawGseIndexRow; errors: string[]; rowNumber: number }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];

    const dateResult = parseGseFileDate(row.trading_date ?? "", "trading_date");
    if (dateResult.error) errors.push(dateResult.error.message);

    const gseCi = optionalDecimal(row.gse_ci, "gse_ci", errors);
    const gseFsi = optionalDecimal(row.gse_fsi, "gse_fsi", errors);
    const marketCapGhs = optionalDecimal(row.market_cap_ghs, "market_cap_ghs", errors);
    const totalVolume = optionalDecimal(row.total_volume, "total_volume", errors);
    const totalValueTradedGhs = optionalDecimal(row.total_value_traded_ghs, "total_value_traded_ghs", errors);

    if (errors.length === 0 && gseCi === null && gseFsi === null && marketCapGhs === null && totalVolume === null && totalValueTradedGhs === null) {
      errors.push("row has a trading_date but no index level or market-summary value in any recognised column");
    }

    if (errors.length > 0) {
      invalid.push({ row, errors, rowNumber });
      return;
    }

    valid.push({
      tradingDate: dateResult.date!,
      gseCi,
      gseFsi,
      marketCapGhs,
      totalVolume,
      totalValueTradedGhs,
    });
  });

  return { valid, invalid };
}
