// ---------------------------------------------------------------------------
// Pure mapping between the stored ScenarioShock row shape (typed nullable
// target columns — see prisma/schema.prisma) and the engine's discriminated
// selector. No I/O.
// ---------------------------------------------------------------------------

import type { ScenarioShockRule, ShockSelector, ShockType } from "./types";

export interface StoredShockRow {
  id: string;
  targetKind: "ASSET_CLASS" | "ISSUER" | "SECURITY";
  shockType: ShockType;
  value: number;
  assetClass: "GOVERNMENT_BOND" | "CORPORATE_BOND" | "EQUITY" | null;
  companyId: string | null;
  issuerNameKey: string | null;
  fixedIncomeSecurityId: string | null;
  securityId: string | null;
}

/** Normalises an issuer name exactly as M8.2 resolveIssuerRef does (trim, collapse whitespace, lower-case for the key). */
export const issuerNameKeyOf = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The M8.2 issuer identity for a stored issuer selector: "company:<id>" or "name:<key>". */
export const issuerKeyOf = (s: { companyId: string | null; issuerNameKey: string | null }): string | null => (s.companyId ? `company:${s.companyId}` : s.issuerNameKey ? `name:${s.issuerNameKey}` : null);

/** Null when the row violates the shape the database CHECK constraint enforces (cannot happen for stored rows). */
export function rowToSelector(row: StoredShockRow): ShockSelector | null {
  if (row.targetKind === "ASSET_CLASS" && row.assetClass) return { kind: "ASSET_CLASS", assetClass: row.assetClass };
  if (row.targetKind === "ISSUER") {
    const key = issuerKeyOf(row);
    return key ? { kind: "ISSUER", issuerKey: key } : null;
  }
  if (row.targetKind === "SECURITY") {
    if (row.fixedIncomeSecurityId) return { kind: "SECURITY", instrument: "BOND", instrumentId: row.fixedIncomeSecurityId };
    if (row.securityId) return { kind: "SECURITY", instrument: "EQUITY", instrumentId: row.securityId };
  }
  return null;
}

export function rowToRule(row: StoredShockRow, targetLabel: string): ScenarioShockRule | null {
  const selector = rowToSelector(row);
  return selector ? { id: row.id, selector, shockType: row.shockType, value: row.value, targetLabel } : null;
}

/** Column values for inserting a selector. */
export function selectorToColumns(selector: ShockSelector): Pick<StoredShockRow, "targetKind" | "assetClass" | "companyId" | "issuerNameKey" | "fixedIncomeSecurityId" | "securityId"> {
  const none = { assetClass: null, companyId: null, issuerNameKey: null, fixedIncomeSecurityId: null, securityId: null };
  switch (selector.kind) {
    case "ASSET_CLASS":
      return { ...none, targetKind: "ASSET_CLASS", assetClass: selector.assetClass };
    case "SECURITY":
      return selector.instrument === "BOND" ? { ...none, targetKind: "SECURITY", fixedIncomeSecurityId: selector.instrumentId } : { ...none, targetKind: "SECURITY", securityId: selector.instrumentId };
    case "ISSUER":
      return selector.issuerKey.startsWith("company:") ? { ...none, targetKind: "ISSUER", companyId: selector.issuerKey.slice("company:".length) } : { ...none, targetKind: "ISSUER", issuerNameKey: selector.issuerKey.replace(/^name:/, "") };
  }
}
