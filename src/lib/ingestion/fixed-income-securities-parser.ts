// ---------------------------------------------------------------------------
// Fixed Income Securities (Master) — manual import parser (M7).
//
// One row = one instrument's contractual identity (issuer, tenor, coupon
// terms) — mirrors financials-parser.ts's "long format, controlled alias
// map, never fuzzy matching" pattern. Deliberately covers GOVERNMENT_BOND
// and CORPORATE_BOND only; Treasury bills already have a complete working
// import path via the existing BoG Treasury ingestion (see
// fixed-income-securities-provider.ts header for why this is not
// duplicated here).
//
// Source reality: like GSE equities and company financials, Ghana's fixed-
// income market (GFIM) has no stable public API this agent can reach
// automatically (same CLAUDE.md §7.C constraint). This is Mode B/C only —
// an analyst transcribes verified terms from an official term
// sheet/prospectus into this template.
// ---------------------------------------------------------------------------

import { parseDecimal } from "../validation/index";
import { parseGseFileDate } from "./gse-file-date";
import { findHeader, normalizeHeader, type ParsedFile } from "./file-parse";

const FIELD_ALIASES: Record<string, string[]> = {
  instrument_code: ["instrument code", "security code", "isin", "code"],
  instrument_name: ["instrument name", "security name", "name"],
  issuer_name: ["issuer name", "issuer"],
  ticker: ["ticker", "share code", "symbol"],
  instrument_type: ["instrument type", "type"],
  currency: ["currency"],
  issue_date: ["issue date"],
  maturity_date: ["maturity date"],
  coupon_type: ["coupon type"],
  coupon_rate: ["coupon rate", "coupon rate pct", "coupon"],
  coupon_frequency: ["coupon frequency", "payment frequency", "frequency"],
  face_value: ["face value", "par value", "nominal value"],
  status: ["status"],
};

export interface RawFixedIncomeSecurityRow {
  [field: string]: string | undefined;
}

export type NormalisedInstrumentType = "GOVERNMENT_BOND" | "CORPORATE_BOND";
export type NormalisedCouponType = "FIXED" | "FLOATING" | "ZERO_COUPON";
export type NormalisedCouponFrequency = "ANNUAL" | "SEMI_ANNUAL" | "QUARTERLY" | "MONTHLY";
export type NormalisedSecurityStatus = "ACTIVE" | "MATURED" | "CALLED" | "DEFAULTED";

export interface NormalisedFixedIncomeSecurityRow {
  instrumentCode: string;
  instrumentName: string;
  issuerName: string;
  ticker: string | null;
  instrumentType: NormalisedInstrumentType;
  currency: string;
  issueDate: Date;
  maturityDate: Date;
  couponType: NormalisedCouponType;
  couponRatePct: string | null;
  couponFrequency: NormalisedCouponFrequency | null;
  faceValue: string;
  status: NormalisedSecurityStatus;
}

export function mapFixedIncomeSecurityColumns(rawHeaders: string[]): Record<string, string | null> {
  const normalized = rawHeaders.map(normalizeHeader);
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    mapping[field] = findHeader(normalized, aliases);
  }
  return mapping;
}

export function extractFixedIncomeSecurityRows(file: ParsedFile): RawFixedIncomeSecurityRow[] {
  const columnByField = mapFixedIncomeSecurityColumns(file.rawHeaders);
  return file.rows.map((row) => {
    const out: RawFixedIncomeSecurityRow = {};
    for (const [field, headerKey] of Object.entries(columnByField)) {
      out[field] = headerKey ? row[headerKey] : undefined;
    }
    return out;
  });
}

const INSTRUMENT_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

const INSTRUMENT_TYPE_ALIASES: Record<string, NormalisedInstrumentType> = {
  "GOVERNMENT BOND": "GOVERNMENT_BOND",
  GOVERNMENT: "GOVERNMENT_BOND",
  SOVEREIGN: "GOVERNMENT_BOND",
  GOG: "GOVERNMENT_BOND",
  "CORPORATE BOND": "CORPORATE_BOND",
  CORPORATE: "CORPORATE_BOND",
  CORP: "CORPORATE_BOND",
};

const COUPON_TYPE_ALIASES: Record<string, NormalisedCouponType> = {
  FIXED: "FIXED",
  "FIXED RATE": "FIXED",
  FLOATING: "FLOATING",
  "FLOATING RATE": "FLOATING",
  FRN: "FLOATING",
  ZERO: "ZERO_COUPON",
  "ZERO COUPON": "ZERO_COUPON",
  DISCOUNT: "ZERO_COUPON",
};

const COUPON_FREQUENCY_ALIASES: Record<string, NormalisedCouponFrequency> = {
  ANNUAL: "ANNUAL",
  ANNUALLY: "ANNUAL",
  "SEMI ANNUAL": "SEMI_ANNUAL",
  "SEMI-ANNUAL": "SEMI_ANNUAL",
  SEMIANNUAL: "SEMI_ANNUAL",
  "HALF YEARLY": "SEMI_ANNUAL",
  "HALF YEAR": "SEMI_ANNUAL",
  QUARTERLY: "QUARTERLY",
  MONTHLY: "MONTHLY",
};

const STATUS_ALIASES: Record<string, NormalisedSecurityStatus> = {
  ACTIVE: "ACTIVE",
  MATURED: "MATURED",
  CALLED: "CALLED",
  DEFAULTED: "DEFAULTED",
};

function normalizeToken(text: string): string {
  return text.trim().toUpperCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export interface FixedIncomeSecurityValidationResult {
  valid: NormalisedFixedIncomeSecurityRow[];
  invalid: { row: RawFixedIncomeSecurityRow; errors: string[]; rowNumber: number }[];
}

export function validateFixedIncomeSecurityRows(rows: RawFixedIncomeSecurityRow[]): FixedIncomeSecurityValidationResult {
  const valid: NormalisedFixedIncomeSecurityRow[] = [];
  const invalid: { row: RawFixedIncomeSecurityRow; errors: string[]; rowNumber: number }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];

    const instrumentCode = (row.instrument_code ?? "").trim().toUpperCase();
    if (instrumentCode === "") errors.push("instrument_code is required");
    else if (!INSTRUMENT_CODE_RE.test(instrumentCode)) errors.push(`instrument_code is not plausible: "${instrumentCode}"`);

    const instrumentName = (row.instrument_name ?? "").trim();
    if (instrumentName === "") errors.push("instrument_name is required");

    const issuerName = (row.issuer_name ?? "").trim();
    if (issuerName === "") errors.push("issuer_name is required");

    const tickerRaw = (row.ticker ?? "").trim().toUpperCase();
    const ticker = tickerRaw === "" ? null : tickerRaw;

    const instrumentTypeToken = normalizeToken(row.instrument_type ?? "");
    const instrumentType = INSTRUMENT_TYPE_ALIASES[instrumentTypeToken];
    if (instrumentTypeToken === "") errors.push("instrument_type is required");
    else if (!instrumentType) errors.push(`instrument_type must be GOVERNMENT_BOND or CORPORATE_BOND: "${row.instrument_type}"`);

    const currency = (row.currency ?? "").trim() || "GHS";

    const issueResult = parseGseFileDate(row.issue_date ?? "", "issue_date");
    if (issueResult.error) errors.push(issueResult.error.message);
    const maturityResult = parseGseFileDate(row.maturity_date ?? "", "maturity_date");
    if (maturityResult.error) errors.push(maturityResult.error.message);
    if (!issueResult.error && !maturityResult.error && issueResult.date! >= maturityResult.date!) {
      errors.push(`maturity_date (${row.maturity_date}) must be after issue_date (${row.issue_date})`);
    }

    const couponTypeToken = normalizeToken(row.coupon_type ?? "");
    const couponType = COUPON_TYPE_ALIASES[couponTypeToken];
    if (couponTypeToken === "") errors.push("coupon_type is required");
    else if (!couponType) errors.push(`coupon_type must be FIXED, FLOATING, or ZERO_COUPON: "${row.coupon_type}"`);

    const couponRateRaw = (row.coupon_rate ?? "").trim();
    let couponRatePct: string | null = null;
    if (couponType === "ZERO_COUPON") {
      if (couponRateRaw !== "") errors.push("coupon_rate must be blank for a ZERO_COUPON instrument");
    } else if (couponType === "FIXED") {
      if (couponRateRaw === "") {
        errors.push("coupon_rate is required for a FIXED-coupon instrument");
      } else {
        const parsed = parseDecimal(couponRateRaw, "coupon_rate");
        if (parsed.error) errors.push(parsed.error.message);
        else couponRatePct = parsed.value;
      }
    } else if (couponRateRaw !== "") {
      const parsed = parseDecimal(couponRateRaw, "coupon_rate");
      if (parsed.error) errors.push(parsed.error.message);
      else couponRatePct = parsed.value;
    }

    const couponFrequencyToken = normalizeToken(row.coupon_frequency ?? "");
    let couponFrequency: NormalisedCouponFrequency | null = null;
    if (couponType === "ZERO_COUPON") {
      if (couponFrequencyToken !== "") errors.push("coupon_frequency must be blank for a ZERO_COUPON instrument");
    } else if (couponType === "FIXED") {
      if (couponFrequencyToken === "") {
        errors.push("coupon_frequency is required for a FIXED-coupon instrument");
      } else {
        couponFrequency = COUPON_FREQUENCY_ALIASES[couponFrequencyToken] ?? null;
        if (!couponFrequency) errors.push(`coupon_frequency must be ANNUAL, SEMI_ANNUAL, QUARTERLY, or MONTHLY: "${row.coupon_frequency}"`);
      }
    } else if (couponFrequencyToken !== "") {
      couponFrequency = COUPON_FREQUENCY_ALIASES[couponFrequencyToken] ?? null;
      if (!couponFrequency) errors.push(`coupon_frequency must be ANNUAL, SEMI_ANNUAL, QUARTERLY, or MONTHLY: "${row.coupon_frequency}"`);
    }

    const faceValueRaw = (row.face_value ?? "").trim();
    let faceValue = "100";
    if (faceValueRaw !== "") {
      const parsed = parseDecimal(faceValueRaw, "face_value");
      if (parsed.error) errors.push(parsed.error.message);
      else if (Number(parsed.value) <= 0) errors.push(`face_value must be positive: "${faceValueRaw}"`);
      else faceValue = parsed.value!;
    }

    const statusToken = normalizeToken(row.status ?? "");
    let status: NormalisedSecurityStatus = "ACTIVE";
    if (statusToken !== "") {
      const resolved = STATUS_ALIASES[statusToken];
      if (!resolved) errors.push(`status must be ACTIVE, MATURED, CALLED, or DEFAULTED: "${row.status}"`);
      else status = resolved;
    }

    if (errors.length > 0) {
      invalid.push({ row, errors, rowNumber });
      return;
    }

    valid.push({
      instrumentCode,
      instrumentName,
      issuerName,
      ticker,
      instrumentType: instrumentType!,
      currency,
      issueDate: issueResult.date!,
      maturityDate: maturityResult.date!,
      couponType: couponType!,
      couponRatePct,
      couponFrequency,
      faceValue,
      status,
    });
  });

  return { valid, invalid };
}
