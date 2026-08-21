// ---------------------------------------------------------------------------
// Public reference metadata (real, well-known GSE-listed company names for
// the initial representative universe named in PROJECT.md §11 / CLAUDE.md
// §7) — used only as a fallback display name when neither a GSE security
// import nor a company-financials import supplies one explicitly. Never
// used as a source of price/financial data. Shared by
// gse-security-provider.ts (M6) and financials-provider.ts (M7) so the two
// importers can never independently drift on a company's display name.
// ---------------------------------------------------------------------------

export const KNOWN_COMPANY_NAMES: Record<string, string> = {
  MTNGH: "MTN Ghana",
  GCB: "GCB Bank PLC",
  GOIL: "GOIL PLC",
  CAL: "CalBank PLC",
  SCB: "Standard Chartered Bank Ghana PLC",
  EGH: "Ecobank Ghana PLC",
  TOTAL: "TotalEnergies Marketing Ghana PLC",
  BOPP: "Benso Oil Palm Plantation PLC",
  SIC: "SIC Insurance Company PLC",
  ETI: "Ecobank Transnational Incorporated",
  ADB: "Agricultural Development Bank PLC",
};

export const KNOWN_COMPANY_SECTORS: Record<string, string> = {
  MTNGH: "Telecommunications",
  GCB: "Banking",
  GOIL: "Energy / Downstream Petroleum",
  CAL: "Banking",
  SCB: "Banking",
  EGH: "Banking",
  TOTAL: "Energy / Downstream Petroleum",
  BOPP: "Agriculture",
  SIC: "Insurance",
  ETI: "Banking",
  ADB: "Banking",
};
