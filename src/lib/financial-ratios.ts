// ---------------------------------------------------------------------------
// Derived financial ratios (M7 §22). Pure functions — no I/O — so the same
// methodology is guaranteed to be used everywhere a ratio is shown.
//
// Every ratio either returns a definite value with its methodology
// documented, or null. Never a fabricated/misleading number: a negative
// P/E, a P/B against zero shares outstanding, or an ROE that can't average
// two real equity observations is unavailable, not approximated.
// ---------------------------------------------------------------------------

export interface RatioResult {
  /** Percentage for ROE/ROA/Dividend Yield (e.g. 15.3 means 15.3%); a plain multiple for P/E and P/B. */
  value: number;
  methodology: string;
}

/**
 * PAT ÷ average(latest, prior) year-end Total Equity. Requires BOTH
 * observations — if the prior period's equity isn't in the system, this
 * returns null rather than silently falling back to an ending-equity-only
 * formula (M7 §22: "Do not silently switch methodologies").
 */
export function computeROE(latestPatGhs: number, latestEquityGhs: number, priorEquityGhs: number | null): RatioResult | null {
  if (priorEquityGhs === null) return null;
  const avgEquity = (latestEquityGhs + priorEquityGhs) / 2;
  if (avgEquity <= 0) return null;
  return { value: (latestPatGhs / avgEquity) * 100, methodology: "Profit After Tax ÷ average of latest and prior year-end Total Equity" };
}

/** Same discipline as computeROE, against Total Assets. */
export function computeROA(latestPatGhs: number, latestAssetsGhs: number, priorAssetsGhs: number | null): RatioResult | null {
  if (priorAssetsGhs === null) return null;
  const avgAssets = (latestAssetsGhs + priorAssetsGhs) / 2;
  if (avgAssets <= 0) return null;
  return { value: (latestPatGhs / avgAssets) * 100, methodology: "Profit After Tax ÷ average of latest and prior year-end Total Assets" };
}

/**
 * Latest market price ÷ latest ANNUAL EPS (not a rolling trailing-twelve-
 * month figure — this product doesn't yet assemble a reliable TTM series
 * from interim filings). Negative or zero EPS makes P/E not meaningful,
 * not a misleading negative/undefined number — returns null.
 */
export function computePE(marketPriceGhs: number, annualEpsGhs: number): RatioResult | null {
  if (annualEpsGhs <= 0 || marketPriceGhs <= 0) return null;
  return { value: marketPriceGhs / annualEpsGhs, methodology: "Latest market price ÷ latest annual EPS" };
}

/** Book value per share = Total Equity ÷ Shares Outstanding; P/B = price ÷ that. */
export function computePB(marketPriceGhs: number, totalEquityGhs: number, sharesOutstanding: number): RatioResult | null {
  if (sharesOutstanding <= 0 || marketPriceGhs <= 0) return null;
  const bookValuePerShare = totalEquityGhs / sharesOutstanding;
  if (bookValuePerShare <= 0) return null;
  return { value: marketPriceGhs / bookValuePerShare, methodology: "Latest market price ÷ (Total Equity ÷ Shares Outstanding)" };
}

/** DPS of exactly 0 is a real fact (no dividend paid) and yields 0%, not "unavailable" — only a negative DPS or non-positive price is invalid. */
export function computeDividendYield(dividendPerShareGhs: number, marketPriceGhs: number): RatioResult | null {
  if (dividendPerShareGhs < 0 || marketPriceGhs <= 0) return null;
  return { value: (dividendPerShareGhs / marketPriceGhs) * 100, methodology: "Dividend Per Share ÷ latest market price" };
}
