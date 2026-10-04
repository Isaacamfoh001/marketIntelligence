// ---------------------------------------------------------------------------
// Fixed Income Market Observations — manual import parser (M7).
//
// One row = one security's market observation (price and/or yield) for one
// date — separate from the Securities (Master) import exactly the way
// Security/SecurityPrice and TreasuryInstrument/TreasuryRate are split:
// contractual identity rarely changes, market observations arrive
// frequently. A row must supply at least clean_price or source_yield — a
// row with neither is rejected rather than silently stored as a blank
// observation (CLAUDE.md §10: validate required identifiers/values).
// ---------------------------------------------------------------------------

import { parseDecimal } from "../validation/index";
import { parseGseFileDate } from "./gse-file-date";
import { findHeader, normalizeHeader, type ParsedFile } from "./file-parse";

const FIELD_ALIASES: Record<string, string[]> = {
  instrument_code: ["instrument code", "security code", "isin", "code"],
  observation_date: ["observation date", "trading date", "date"],
  clean_price: ["clean price", "price"],
  source_yield: ["yield", "source yield", "yield pct", "quoted yield"],
  volume_traded: ["volume traded", "volume", "value traded"],
};

export interface RawFixedIncomeObservationRow {
  [field: string]: string | undefined;
}

export interface NormalisedFixedIncomeObservationRow {
  instrumentCode: string;
  observationDate: Date;
  cleanPrice: string | null;
  sourceYieldPct: string | null;
  volumeTradedGhs: string | null;
}

export function mapFixedIncomeObservationColumns(rawHeaders: string[]): Record<string, string | null> {
  const normalized = rawHeaders.map(normalizeHeader);
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    mapping[field] = findHeader(normalized, aliases);
  }
  return mapping;
}

export function extractFixedIncomeObservationRows(file: ParsedFile): RawFixedIncomeObservationRow[] {
  const columnByField = mapFixedIncomeObservationColumns(file.rawHeaders);
  return file.rows.map((row) => {
    const out: RawFixedIncomeObservationRow = {};
    for (const [field, headerKey] of Object.entries(columnByField)) {
      out[field] = headerKey ? row[headerKey] : undefined;
    }
    return out;
  });
}

const INSTRUMENT_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

export interface FixedIncomeObservationValidationResult {
  valid: NormalisedFixedIncomeObservationRow[];
  invalid: { row: RawFixedIncomeObservationRow; errors: string[]; rowNumber: number }[];
}

export function validateFixedIncomeObservationRows(rows: RawFixedIncomeObservationRow[]): FixedIncomeObservationValidationResult {
  const valid: NormalisedFixedIncomeObservationRow[] = [];
  const invalid: { row: RawFixedIncomeObservationRow; errors: string[]; rowNumber: number }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];

    const instrumentCode = (row.instrument_code ?? "").trim().toUpperCase();
    if (instrumentCode === "") errors.push("instrument_code is required");
    else if (!INSTRUMENT_CODE_RE.test(instrumentCode)) errors.push(`instrument_code is not plausible: "${instrumentCode}"`);

    const dateResult = parseGseFileDate(row.observation_date ?? "", "observation_date");
    if (dateResult.error) errors.push(dateResult.error.message);

    const cleanPriceRaw = (row.clean_price ?? "").trim();
    const sourceYieldRaw = (row.source_yield ?? "").trim();
    let cleanPrice: string | null = null;
    let sourceYieldPct: string | null = null;

    if (cleanPriceRaw === "" && sourceYieldRaw === "") {
      errors.push("at least one of clean_price or source_yield is required");
    }
    if (cleanPriceRaw !== "") {
      const parsed = parseDecimal(cleanPriceRaw, "clean_price");
      if (parsed.error) errors.push(parsed.error.message);
      else if (Number(parsed.value) <= 0) errors.push(`clean_price must be positive: "${cleanPriceRaw}"`);
      else cleanPrice = parsed.value!;
    }
    if (sourceYieldRaw !== "") {
      const parsed = parseDecimal(sourceYieldRaw, "source_yield");
      if (parsed.error) errors.push(parsed.error.message);
      else sourceYieldPct = parsed.value!;
    }

    const volumeRaw = (row.volume_traded ?? "").trim();
    let volumeTradedGhs: string | null = null;
    if (volumeRaw !== "") {
      const parsed = parseDecimal(volumeRaw, "volume_traded");
      if (parsed.error) errors.push(parsed.error.message);
      else volumeTradedGhs = parsed.value!;
    }

    if (errors.length > 0) {
      invalid.push({ row, errors, rowNumber });
      return;
    }

    valid.push({
      instrumentCode,
      observationDate: dateResult.date!,
      cleanPrice,
      sourceYieldPct,
      volumeTradedGhs,
    });
  });

  return { valid, invalid };
}
