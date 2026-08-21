// ---------------------------------------------------------------------------
// Tests for the centralized company-logo resolution (M8.2 Part B).
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { getCompanyLogo, COMPANY_LOGOS } from "../company-logo";

const PUBLIC_DIR = path.resolve(__dirname, "../../../public");

describe("getCompanyLogo", () => {
  it("resolves a known ticker to its logo asset", () => {
    const logo = getCompanyLogo("MTNGH");
    expect(logo).not.toBeNull();
    expect(logo?.src).toBe("/logos/MTNGH.svg");
  });

  it("resolves the MTN entry with the yellow brand-tile treatment, not a plain white chip", () => {
    const logo = getCompanyLogo("MTNGH");
    expect(logo?.background).toBe("brand");
    expect(logo?.brandColor).toMatch(/^#/);
  });

  it("aliases preference/depositary variants to their parent issuer's mark", () => {
    expect(getCompanyLogo("SCBPREF")?.src).toBe(getCompanyLogo("SCB")?.src);
    expect(getCompanyLogo("CALPREF")?.src).toBe(getCompanyLogo("CAL")?.src);
    expect(getCompanyLogo("CALRT")?.src).toBe(getCompanyLogo("CAL")?.src);
    expect(getCompanyLogo("AADS")?.src).toBe(getCompanyLogo("AGA")?.src);
    expect(getCompanyLogo("ETI")?.src).toBe(getCompanyLogo("EGH")?.src);
  });

  it("returns null for an unknown ticker (component falls back to initials)", () => {
    expect(getCompanyLogo("NOT_A_REAL_TICKER")).toBeNull();
  });

  it("returns null for a null/undefined ticker", () => {
    expect(getCompanyLogo(null)).toBeNull();
    expect(getCompanyLogo(undefined)).toBeNull();
  });

  it("covers a majority of the loaded 43-security GSE universe", () => {
    // Guards against silent regression of M8.2's logo-coverage expansion —
    // not a claim about any particular ticker list, just the count.
    expect(Object.keys(COMPANY_LOGOS).length).toBeGreaterThan(21);
  });

  it("every configured logo file actually exists under public/", () => {
    const missing = Object.entries(COMPANY_LOGOS)
      .filter(([, logo]) => !fs.existsSync(path.join(PUBLIC_DIR, logo.src)))
      .map(([ticker]) => ticker);
    expect(missing).toEqual([]);
  });

  it("every configured logo file is non-empty", () => {
    const empty = Object.entries(COMPANY_LOGOS)
      .filter(([, logo]) => {
        const full = path.join(PUBLIC_DIR, logo.src);
        return fs.existsSync(full) && fs.statSync(full).size === 0;
      })
      .map(([ticker]) => ticker);
    expect(empty).toEqual([]);
  });
});
