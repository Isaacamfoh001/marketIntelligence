// ---------------------------------------------------------------------------
// Company financial-reporting profile (M8 Part A §8) — which metric set and
// Company Explorer template a company should use, resolved from its sector
// once, in one place. Growing the company universe past two industries
// means a single inline `company.sector === "Banking"` check is no longer
// self-evidently the only comparison that will ever be needed — this gives
// it a name and a single home to extend (e.g. INSURANCE) rather than
// accumulating scattered string comparisons across pages/queries.
//
// Only GENERAL and BANK exist because only those two are actually needed
// this milestone (M8 §8: "do not build dozens of sector models"). Insurance
// was considered for M8 and deliberately deferred — see M8 completion
// report §S — rather than forcing an insurer into either template.
// ---------------------------------------------------------------------------

export type FinancialProfile = "GENERAL" | "BANK";

export function resolveFinancialProfile(sector: string | null | undefined): FinancialProfile {
  return sector === "Banking" ? "BANK" : "GENERAL";
}
