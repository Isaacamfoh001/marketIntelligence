// ---------------------------------------------------------------------------
// GSE import dataset definitions — the single source of truth for what the
// browser upload UI (and its help/template text) tells a user about each
// dataset, kept separate from the parser's internal alias maps (which also
// accept GSE's own raw column labels — see gse-security-parser.ts /
// gse-index-parser.ts) so the UI's documentation can't silently drift from
// what those parsers actually understand.
// ---------------------------------------------------------------------------

import type { SecurityImportKind } from "./ingestion/gse-security-provider";

export type GseDatasetType = "security-daily" | "security-backfill" | "market-summary";

export interface GseImportTemplate {
  type: GseDatasetType;
  label: string;
  description: string;
  requiredHeaders: string[];
  requiredNote?: string;
  optionalHeaders: string[];
  templateFilename: string;
}

export const GSE_IMPORT_TEMPLATES: Record<GseDatasetType, GseImportTemplate> = {
  "security-daily": {
    type: "security-daily",
    label: "GSE Daily Security Prices",
    description:
      "Powers the Equities securities table, stock returns (1D/1M/YTD/1Y), Top Gainers, Top Losers, Most Traded, and Overview Market Activity.",
    requiredHeaders: ["Trading Date", "Share Code", "Closing Price - VWAP"],
    optionalHeaders: [
      "Previous Closing Price - VWAP",
      "Opening Price",
      "Last Transaction Price",
      "Price Change",
      "Closing Bid",
      "Closing Offer",
      "Total Shares Traded",
      "Total Value Traded",
      "Year High",
      "Year Low",
      "Company Name",
      "Security Type",
    ],
    templateFilename: "gse-daily-security-prices-template.csv",
  },
  "security-backfill": {
    type: "security-backfill",
    label: "GSE Historical Security Backfill",
    description:
      "Same fields as Daily Security Prices, imported as a lower-priority historical source. Use this for older report-derived data to extend history — it will never silently overwrite a value the routine daily import already owns for that date.",
    requiredHeaders: ["Trading Date", "Share Code", "Closing Price - VWAP"],
    optionalHeaders: [
      "Previous Closing Price - VWAP",
      "Opening Price",
      "Last Transaction Price",
      "Price Change",
      "Closing Bid",
      "Closing Offer",
      "Total Shares Traded",
      "Total Value Traded",
      "Year High",
      "Year Low",
      "Company Name",
      "Security Type",
    ],
    templateFilename: "gse-security-backfill-template.csv",
  },
  "market-summary": {
    type: "market-summary",
    label: "GSE Market Summary / Index History",
    description: "Powers GSE-CI, GSE-FSI, market capitalization, total market volume/value, and the Overview GSE chart.",
    requiredHeaders: ["Trading Date"],
    requiredNote: "plus at least one of GSE-CI or GSE-FSI on each row",
    optionalHeaders: ["GSE-CI", "GSE-FSI", "Market Capitalization", "Total Volume", "Total Value Traded"],
    templateFilename: "gse-market-summary-template.csv",
  },
};

export function datasetTypeToSecurityKind(type: GseDatasetType): SecurityImportKind {
  return type === "security-backfill" ? "backfill" : "daily";
}

/** Blank CSV containing only the header row (required + optional columns), for a user to fill in and re-upload. */
export function buildCsvTemplate(type: GseDatasetType): string {
  const spec = GSE_IMPORT_TEMPLATES[type];
  return `${[...spec.requiredHeaders, ...spec.optionalHeaders].join(",")}\n`;
}

// 10MB comfortably covers 1-2+ years of daily GSE security data: ~500
// trading days x ~40 securities x ~150 bytes/row is well under 4MB, so
// this leaves generous headroom for a much larger multi-year export.
// Cross-referenced in next.config.ts's Server Actions bodySizeLimit —
// keep the two in sync if this ever changes.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

export function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
