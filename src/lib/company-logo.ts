// ---------------------------------------------------------------------------
// Centralized company-logo metadata (M8 Part A.2 §17) — the one place a
// ticker maps to a brand asset, so /companies, /companies/[ticker], and any
// future Equities logo usage never hardcode a logo path in JSX.
//
// Assets are official first-party brand marks (each company's own site
// favicon/header logo — see data/company-financials/PROVENANCE.md for the
// exact source URL per file), normalized and stored locally under
// public/logos/ rather than hotlinked, per the project's asset policy.
// A ticker with no entry here falls back to initials — see CompanyLogo.tsx.
// ---------------------------------------------------------------------------

export interface CompanyLogo {
  /** Path under /public. */
  src: string;
}

export const COMPANY_LOGOS: Record<string, CompanyLogo> = {
  MTNGH: { src: "/logos/MTNGH.svg" },
  GOIL: { src: "/logos/GOIL.png" },
  ADB: { src: "/logos/ADB.png" },
  BOPP: { src: "/logos/BOPP.png" },
  CAL: { src: "/logos/CAL.png" },
  TOTAL: { src: "/logos/TOTAL.png" },
};

export function getCompanyLogo(ticker: string | null | undefined): CompanyLogo | null {
  if (!ticker) return null;
  return COMPANY_LOGOS[ticker] ?? null;
}
