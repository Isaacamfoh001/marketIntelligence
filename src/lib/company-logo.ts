// ---------------------------------------------------------------------------
// Centralized company-logo metadata (M8 Part A.2 §17, expanded M8.2 Part B)
// — the one place a ticker maps to a brand asset, so /equities, /companies,
// and /companies/[ticker] never hardcode a logo path in JSX.
//
// Assets are official first-party brand marks (each issuer's own site
// favicon/header logo — see public/logos/PROVENANCE.md for the exact
// source URL per file), normalized and stored locally under public/logos/
// rather than hotlinked, per the project's asset policy. A ticker with no
// entry here falls back to initials — see CompanyLogo.tsx.
//
// `background` controls the chip a logo renders inside, since a single
// neutral-light chip does not suit every mark:
//   - "light"  (default) — a light/white chip. Right for full-color marks
//     and dark-line-only marks (most of the roster).
//   - "dark"   — a dark chip. Right for a mark supplied as solid white
//     with no fill of its own (e.g. Tullow Oil's), which would otherwise
//     vanish on a light background.
//   - "brand"  — a chip filled with `brandColor`. Reserved for marks whose
//     brand identity IS the color pairing (MTN's black wordmark is only
//     recognizable as MTN on its own yellow, per MTN brand guidelines) —
//     use sparingly, not as a decorative default.
// ---------------------------------------------------------------------------

export type LogoBackground = "light" | "dark" | "brand";

export interface CompanyLogo {
  /** Path under /public. */
  src: string;
  background?: LogoBackground;
  /** Required when background is "brand". CSS color value. */
  brandColor?: string;
}

const ECOBANK: CompanyLogo = { src: "/logos/ECOBANK.png" };
const CAL: CompanyLogo = { src: "/logos/CAL.png" };
const SCB: CompanyLogo = { src: "/logos/SCB.png" };
const AGA: CompanyLogo = { src: "/logos/AGA.svg" };

export const COMPANY_LOGOS: Record<string, CompanyLogo> = {
  // Companies with Company Explorer financial data (M7/M8)
  MTNGH: { src: "/logos/MTNGH.svg", background: "brand", brandColor: "#FFCC00" },
  GOIL: { src: "/logos/GOIL.png" },
  ADB: { src: "/logos/ADB.png" },
  BOPP: { src: "/logos/BOPP.png" },
  CAL,
  TOTAL: { src: "/logos/TOTAL.png" },

  // Broader GSE ordinary-share universe (M8.2)
  AGA,
  AADS: AGA, // AngloGold Ashanti Ghana depositary shares — same issuer/mark
  EGH: ECOBANK,
  ETI: ECOBANK, // Ecobank Transnational Incorporated — same group mark as Ecobank Ghana
  SCB,
  SCBPREF: SCB, // Standard Chartered Ghana preference shares — same issuer/mark
  CALPREF: CAL, // CalBank preference shares — same issuer/mark
  CALRT: CAL, // CalBank rights — same issuer/mark
  KASA: { src: "/logos/KASA.png" },
  TLW: { src: "/logos/TLW.svg", background: "dark" }, // supplied as solid white
  UNIL: { src: "/logos/UNIL.png" },
  SOGEGH: { src: "/logos/SOGEGH.svg" },
  RBGH: { src: "/logos/RBGH.png" },
  FAB: { src: "/logos/FAB.webp" },
  EGL: { src: "/logos/EGL.png" },
  SIC: { src: "/logos/SIC.png" },
  ALLGH: { src: "/logos/ALLGH.webp" },
  CPC: { src: "/logos/CPC.png" },
  DASPHARMA: { src: "/logos/DASPHARMA.png" },
};

export function getCompanyLogo(ticker: string | null | undefined): CompanyLogo | null {
  if (!ticker) return null;
  return COMPANY_LOGOS[ticker] ?? null;
}
