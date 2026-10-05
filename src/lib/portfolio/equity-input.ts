// ---------------------------------------------------------------------------
// Equity valuation-input resolver (M8.1 §3/§4/§8).
//
// FORENSIC BASIS (GSE importer + database, checked 5 Oct 2026): GSE publishes
// a closing-price row for EVERY listed share on EVERY trading day. On a day a
// share does not trade, the importer stores the source's row as-is
// (volume = 0) and that row's `closeVwap` is the PREVIOUS close carried
// forward — 8,031 of 8,032 zero-volume rows in the database have
// closeVwap == previousCloseVwap (the 1 exception is a 0.05 move with a
// non-zero value traded, i.e. a source volume-column error). Meanwhile
// `closeVwap` on a volume > 0 row is GSE's volume-weighted close of that
// day's real trades. So a zero-volume row carries NO information about the
// date it is stamped with; using it would present a months-old price as if
// observed that day.
//
// RULE: the valuation price is `closeVwap` of the NEWEST row that represents
// an actual trade — volume strictly greater than zero. Its OWN trading date
// and age are carried into the valuation, never the later carried rows'
// dates. A null volume ("not published") does not establish a trade and is
// skipped. Equities have no M7-style quality model, so none is implied: the
// only judgement made is "was this a real trade, and how old is it".
// ---------------------------------------------------------------------------

import { observationAgeDays } from "../fixed-income";
import { EQUITY_RECENT_WINDOW_DAYS, type InputRecency, type Unvalued } from "./types";

export interface EquityPriceRow {
  /** ISO date (YYYY-MM-DD). */
  tradingDate: string;
  closeVwap: number;
  /** Shares traded that day; null = not published (distinct from a real 0). */
  volume: number | null;
  valueTradedGhs: number | null;
}

export interface EquityValuationSource {
  currency: string;
  active: boolean;
  /** Every stored price row for the security, any order. */
  prices: EquityPriceRow[];
}

export interface EquityValuationInput {
  available: true;
  assetClass: "EQUITY";
  /** GSE's volume-weighted closing price on the trade date (GHS per share). */
  priceGhs: number;
  priceDate: string;
  ageDays: number;
  recency: InputRecency;
  volume: number;
  valueTradedGhs: number | null;
  /** Always true: the price comes from a row with volume > 0 (an actual trade). Exposed so the UI can state the basis. */
  isActualTrade: true;
  /** Newest report date held for this security (may be later than the price date when later rows are carried, no-trade rows). */
  latestReportDate: string;
  /** How many later report rows were skipped because they carry a previous close with no trading. */
  skippedNoTradeRows: number;
}

export function resolveEquityValuationInput(source: EquityValuationSource, valuationDate: Date): EquityValuationInput | Unvalued {
  const no = (code: Unvalued["code"], reason: string): Unvalued => ({ available: false, code, reason });
  if (source.currency !== "GHS") return no("NOT_GHS", `Only GHS instruments are supported (this one is ${source.currency}).`);
  if (!source.active) return no("INACTIVE", "This security is marked inactive (delisted or suspended) in the securities master.");

  const valuationIso = valuationDate.toISOString().slice(0, 10);
  const rows = source.prices.filter((r) => r.tradingDate <= valuationIso).sort((a, b) => (a.tradingDate < b.tradingDate ? 1 : a.tradingDate > b.tradingDate ? -1 : 0));
  if (rows.length === 0) return no("NO_PRICE", "No GSE price has been imported for this security.");

  const traded = rows.findIndex((r) => r.volume !== null && r.volume > 0 && Number.isFinite(r.closeVwap) && r.closeVwap > 0);
  if (traded === -1) {
    const oldest = rows[rows.length - 1].tradingDate;
    return no("NO_TRADE", `No day with actual trading is recorded since ${oldest}; the source only re-prints a carried closing price, which is not a dated market price.`);
  }

  const row = rows[traded];
  const age = observationAgeDays(row.tradingDate, valuationDate) ?? 0;
  return {
    available: true,
    assetClass: "EQUITY",
    priceGhs: row.closeVwap,
    priceDate: row.tradingDate,
    ageDays: age,
    recency: age <= EQUITY_RECENT_WINDOW_DAYS ? "RECENT" : "STALE",
    volume: row.volume as number,
    valueTradedGhs: row.valueTradedGhs,
    isActualTrade: true,
    latestReportDate: rows[0].tradingDate,
    skippedNoTradeRows: traded,
  };
}
