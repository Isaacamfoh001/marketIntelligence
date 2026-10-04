// ---------------------------------------------------------------------------
// Fixed Income import dataset definitions — mirrors gse-import-templates.ts's
// role for GSE datasets, kept as a separate file because these datasets
// aren't GSE data (government/corporate bonds via Ghana's fixed-income
// market, not the exchange) even though they share the same generic
// upload/preview/confirm wizard (see ImportWizard.tsx).
// ---------------------------------------------------------------------------

export type FixedIncomeDatasetType = "fixed-income-securities" | "fixed-income-observations";

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
    optionalHeaders: ["Ticker", "Currency", "Coupon Rate", "Coupon Frequency", "Face Value", "Status"],
    templateFilename: "fixed-income-securities-template.csv",
  },
  "fixed-income-observations": {
    type: "fixed-income-observations",
    label: "Fixed Income Market Observations",
    description:
      "A date's clean price and/or yield for an existing fixed-income security (import the Securities Master first). Powers YTM, duration, DV01, the price/yield history chart, and the sovereign spread. A row must supply at least Clean Price or Yield.",
    requiredHeaders: ["Instrument Code", "Observation Date"],
    requiredNote: "plus at least one of Clean Price or Yield",
    optionalHeaders: ["Clean Price", "Yield", "Volume Traded"],
    templateFilename: "fixed-income-observations-template.csv",
  },
};

export function buildFixedIncomeCsvTemplate(type: FixedIncomeDatasetType): string {
  const spec = FIXED_INCOME_IMPORT_TEMPLATES[type];
  return `${[...spec.requiredHeaders, ...spec.optionalHeaders].join(",")}\n`;
}
