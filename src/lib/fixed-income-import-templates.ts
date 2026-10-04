// ---------------------------------------------------------------------------
// Fixed Income import dataset definitions — mirrors gse-import-templates.ts's
// role for GSE datasets, kept as a separate file because these datasets
// aren't GSE data (government/corporate bonds via Ghana's fixed-income
// market, not the exchange) even though they share the same generic
// upload/preview/confirm wizard (see ImportWizard.tsx).
// ---------------------------------------------------------------------------

export type FixedIncomeDatasetType = "fixed-income-securities" | "fixed-income-observations" | "fixed-income-secondary-market-report";

export interface FixedIncomeImportTemplate {
  type: FixedIncomeDatasetType;
  label: string;
  description: string;
  requiredHeaders: string[];
  requiredNote?: string;
  optionalHeaders: string[];
  templateFilename: string;
}

export const FIXED_INCOME_IMPORT_TEMPLATES: Record<FixedIncomeDatasetType, FixedIncomeImportTemplate> = {
  "fixed-income-securities": {
    type: "fixed-income-securities",
    label: "Fixed Income Securities (Master)",
    description:
      "Contractual terms for a government or corporate bond — issuer, maturity, coupon. Powers the Fixed Income Universe, Security Analysis, and Yield Curve. One row per instrument; re-importing an instrument_code updates it in place and reports any changed term as a restatement.",
    requiredHeaders: ["Instrument Code", "Instrument Name", "Issuer Name", "Instrument Type", "Issue Date", "Maturity Date", "Coupon Type"],
    requiredNote: "Coupon Rate and Coupon Frequency are required for FIXED coupon type, and must be blank for ZERO_COUPON",
    optionalHeaders: ["ISIN", "Ticker", "Currency", "Coupon Rate", "Coupon Frequency", "Face Value", "Status"],
    templateFilename: "fixed-income-securities-template.csv",
  },
  "fixed-income-observations": {
    type: "fixed-income-observations",
    label: "Fixed Income Market Observations",
    description:
      "A date's clean price and/or yield for an existing fixed-income security (import the Securities Master first). Powers YTM, duration, DV01, the price/yield history chart, and the sovereign spread. A row must supply at least Clean Price or Yield.",
    requiredHeaders: ["Instrument Code", "Observation Date", "Observation Kind"],
    requiredNote: "plus at least one of Clean Price or Yield. Observation Kind must be AUCTION_PRIMARY or SECONDARY_MARKET — never left ambiguous",
    optionalHeaders: ["Clean Price", "Yield", "Volume Traded"],
    templateFilename: "fixed-income-observations-template.csv",
  },
  "fixed-income-secondary-market-report": {
    type: "fixed-income-secondary-market-report",
    label: "GFIM Daily Trading Report (Secondary Market)",
    description:
      "The official GFIM daily trading report .xlsx (government and corporate bond sheets). Matches rows to existing securities by ISIN and imports real secondary-market price/yield/volume as SECONDARY_MARKET observations — a security with no trade that day is left alone, never forward-filled. Korbly fetches this automatically every day; upload here only as a manual fallback (e.g. a specific historical report an analyst has obtained directly).",
    requiredHeaders: ["the official unmodified GFIM report .xlsx, with its CORPORATE / NEW GOG NOTES AND BONDS / OLD GOG NOTES AND BONDS sheets"],
    requiredNote: "the report date is read from the file's own 'Date: ...' text — no column template applies",
    optionalHeaders: [],
    templateFilename: "",
  },
};

export function buildFixedIncomeCsvTemplate(type: FixedIncomeDatasetType): string {
  const spec = FIXED_INCOME_IMPORT_TEMPLATES[type];
  return `${[...spec.requiredHeaders, ...spec.optionalHeaders].join(",")}\n`;
}
