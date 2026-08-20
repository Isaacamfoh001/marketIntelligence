// ---------------------------------------------------------------------------
// GSE Daily Shares & ETFs — manual/semi-automated import parser.
//
// gse.com.gh's robots.txt explicitly disallows AI-agent user agents
// (including this one, named directly) site-wide, enforced with a 403 at
// the edge for every path tested — not a login wall or paywall, a
// deliberate opt-out. No automated fetch of GSE's site is attempted
// anywhere in this codebase as a result (see gse-security-provider.ts
// header for the full note). This parser instead reads a file a human
// obtained through their own normal browser session (robots.txt does not
// restrict human visitors) and exported/saved as CSV or Excel.
//
// Column contract: the canonical header names below are Korbly's own
// documented template (see docs at the bottom of this file), but every
// field also accepts the exact labels GSE's own Daily Shares & ETFs table
// uses, so a close copy-paste export is likely to import unmodified too.
// Required: trading_date, share_code, close_vwap (the primary displayed
// price — GSE's "Closing Price - VWAP"). Every other field is optional
// and a blank cell is stored as missing, never coerced to 0. Only
// shares_traded/value_traded may legitimately be the number 0 (a real
// no-trade day) — see validateGseSecurityRows for how blank vs "0" is
// distinguished.
// ---------------------------------------------------------------------------

import { parseDecimal } from "../validation/index";
import { parseGseFileDate } from "./gse-file-date";
import { findHeader, normalizeHeader, type ParsedFile } from "./file-parse";

export const SECURITY_TYPE_ALIASES: Record<string, string> = {
  ORDINARY: "ORDINARY_SHARE",
  "ORDINARY SHARE": "ORDINARY_SHARE",
  ORD: "ORDINARY_SHARE",
  PREFERENCE: "PREFERENCE_SHARE",
  "PREFERENCE SHARE": "PREFERENCE_SHARE",
  PREF: "PREFERENCE_SHARE",
  DEPOSITARY: "DEPOSITARY_SHARE",
  "DEPOSITARY SHARE": "DEPOSITARY_SHARE",
  ETF: "ETF",
};

const FIELD_ALIASES: Record<string, string[]> = {
  trading_date: ["trading date", "daily date", "date"],
  share_code: ["share code", "ticker", "symbol"],
  company_name: ["company", "company name", "security name", "issuer"],
  security_type: ["security type", "type"],
  previous_close_vwap: ["previous closing price vwap", "previous closing price", "previous close vwap", "previous close", "prev close"],
  open_price: ["opening price", "open"],
  last_transaction_price: ["last transaction price", "last price", "last traded price"],
  close_vwap: ["closing price vwap", "closing price", "close vwap", "close"],
  price_change: ["price change", "change"],
  closing_bid: ["closing bid", "bid"],
  closing_offer: ["closing offer", "offer", "ask"],
  shares_traded: ["total shares traded", "shares traded", "volume"],
  value_traded: ["total value traded", "value traded", "turnover"],
  year_high: ["year high", "52 week high", "52wk high"],
  year_low: ["year low", "52 week low", "52wk low"],
};

export interface RawGseSecurityRow {
  [field: string]: string | undefined;
}

export interface NormalisedGseSecurityRow {
  tradingDate: Date;
  ticker: string;
  companyName: string | null;
  securityType: string | null;
  previousCloseVwap: string | null;
  openPrice: string | null;
  lastTransactionPrice: string | null;
  closeVwap: string;
  priceChange: string | null;
  closingBid: string | null;
  closingOffer: string | null;
  yearHigh: string | null;
  yearLow: string | null;
  /** null = not published this row; "0" is a real, explicit no-trade day. */
  sharesTraded: string | null;
  valueTraded: string | null;
}

/** Maps a ParsedFile's normalized headers onto the canonical field set this parser understands. Missing optional columns simply resolve to `undefined` for every row. */
export function mapGseSecurityColumns(rawHeaders: string[]): Record<string, string | null> {
  const normalized = rawHeaders.map(normalizeHeader);
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    mapping[field] = findHeader(normalized, aliases);
  }
  return mapping;
}

export function extractGseSecurityRows(file: ParsedFile): RawGseSecurityRow[] {
  const columnByField = mapGseSecurityColumns(file.rawHeaders);
  return file.rows.map((row) => {
    const out: RawGseSecurityRow = {};
    for (const [field, headerKey] of Object.entries(columnByField)) {
      out[field] = headerKey ? row[headerKey] : undefined;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Validation + normalisation
// ---------------------------------------------------------------------------

export interface GseSecurityValidationResult {
  valid: NormalisedGseSecurityRow[];
  invalid: { row: RawGseSecurityRow; errors: string[]; rowNumber: number }[];
}

const TICKER_RE = /^[A-Z0-9.]{1,15}$/;

/** Optional numeric field: undefined/blank cell → null (not published). A non-blank value that fails to parse is an error, never silently dropped. */
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

/** Same as optionalDecimal, but for integer share/value counts where an explicit "0" must survive as the real observation 0, not be conflated with "column absent". */
function optionalCount(raw: string | undefined, field: string, errors: string[]): string | null {
  return optionalDecimal(raw, field, errors);
}

export function validateGseSecurityRows(rows: RawGseSecurityRow[]): GseSecurityValidationResult {
  const valid: NormalisedGseSecurityRow[] = [];
  const invalid: { row: RawGseSecurityRow; errors: string[]; rowNumber: number }[] = [];

  rows.forEach((row, index) => {
    // +2: 1-based, and the header row itself occupies line 1 of the file.
    const rowNumber = index + 2;
    const errors: string[] = [];

    const dateResult = parseGseFileDate(row.trading_date ?? "", "trading_date");
    if (dateResult.error) errors.push(dateResult.error.message);

    const tickerRaw = (row.share_code ?? "").trim().toUpperCase();
    if (tickerRaw === "") {
      errors.push("share_code is required");
    } else if (!TICKER_RE.test(tickerRaw)) {
      errors.push(`share_code is not a plausible ticker: "${tickerRaw}"`);
    }

    const closeResult = parseDecimal(row.close_vwap ?? "", "close_vwap");
    if (closeResult.error) errors.push(closeResult.error.message);

    const previousCloseVwap = optionalDecimal(row.previous_close_vwap, "previous_close_vwap", errors);
    const openPrice = optionalDecimal(row.open_price, "open_price", errors);
    const lastTransactionPrice = optionalDecimal(row.last_transaction_price, "last_transaction_price", errors);
    const priceChange = optionalDecimal(row.price_change, "price_change", errors);
    const closingBid = optionalDecimal(row.closing_bid, "closing_bid", errors);
    const closingOffer = optionalDecimal(row.closing_offer, "closing_offer", errors);
    const yearHigh = optionalDecimal(row.year_high, "year_high", errors);
    const yearLow = optionalDecimal(row.year_low, "year_low", errors);
    const sharesTraded = optionalCount(row.shares_traded, "shares_traded", errors);
    const valueTraded = optionalCount(row.value_traded, "value_traded", errors);

    let securityType: string | null = null;
    const rawType = (row.security_type ?? "").trim().toUpperCase();
    if (rawType !== "") {
      const mapped = SECURITY_TYPE_ALIASES[rawType];
      if (!mapped) {
        errors.push(`security_type is not recognised: "${rawType}"`);
      } else {
        securityType = mapped;
      }
    }

    if (closingBid !== null && closingOffer !== null && !errors.length) {
      const bid = Number(closingBid);
      const offer = Number(closingOffer);
      if (bid > offer) {
        errors.push(`closing_bid (${bid}) is greater than closing_offer (${offer})`);
      }
    }

    if (errors.length > 0) {
      invalid.push({ row, errors, rowNumber });
      return;
    }

    const companyName = (row.company_name ?? "").trim();

    valid.push({
      tradingDate: dateResult.date!,
      ticker: tickerRaw,
      companyName: companyName === "" ? null : companyName,
      securityType,
      previousCloseVwap,
      openPrice,
      lastTransactionPrice,
      closeVwap: closeResult.value!,
      priceChange,
      closingBid,
      closingOffer,
      yearHigh,
      yearLow,
      sharesTraded,
      valueTraded,
    });
  });

  return { valid, invalid };
}
