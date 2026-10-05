// ---------------------------------------------------------------------------
// Shock validation and resolution (M8.3). Pure.
//
// PRECEDENCE: SECURITY > ISSUER > ASSET_CLASS. Exactly ONE rule applies to a
// position — rules REPLACE, they never stack. Same-level duplicates are
// rejected (never "first/last/largest wins").
//
// ASSET DOMAIN: YIELD_BPS reaches bonds and Treasury bills (the bill's reference
// RATE moves); PRICE_PCT reaches equities only. An issuer rule therefore reaches
// an issuer's fixed-income holdings (bonds and bills) OR its equity depending on
// its shock type — never both. Specific beats broad: a Treasury-bill asset-class
// rule is overridden by an issuer rule (e.g. Government of Ghana) which is in
// turn overridden by a rule on one specific bill.
// ---------------------------------------------------------------------------

import type { ExposureAssetClass } from "../portfolio";
import {
  PRECEDENCE_ORDER,
  SHOCK_BOUNDS,
  SHOCK_UNIT_LABEL,
  type PrecedenceLevel,
  type ScenarioPosition,
  type ScenarioShockRule,
  type ScenarioValidationError,
  type ShockResolution,
  type ShockSelector,
  type ShockType,
} from "./types";

/** Bonds AND Treasury bills take a yield/rate shock in bps; equities take a price %. */
export const shockTypeForAssetClass = (c: ExposureAssetClass): ShockType => (c === "EQUITY" ? "PRICE_PCT" : "YIELD_BPS");

/** The asset classes a SECURITY-level selector for this instrument table can reach. */
const instrumentClasses = (i: "BOND" | "EQUITY" | "TREASURY_BILL"): ExposureAssetClass[] => (i === "EQUITY" ? ["EQUITY"] : i === "TREASURY_BILL" ? ["TREASURY_BILL"] : ["GOVERNMENT_BOND", "CORPORATE_BOND"]);

/** Does a shock of this type reach a position of this asset class at all? */
export const shockTypeReaches = (type: ShockType, assetClass: ExposureAssetClass): boolean => shockTypeForAssetClass(assetClass) === type;

export function validateShockValue(type: ShockType, value: number): { ok: true } | { ok: false; code: "BAD_VALUE" | "OUT_OF_BOUNDS"; message: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, code: "BAD_VALUE", message: "The shock must be a finite number." };
  const { min, max } = SHOCK_BOUNDS[type];
  if (value < min || value > max) {
    const unit = SHOCK_UNIT_LABEL[type];
    const why = type === "PRICE_PCT" && value < min ? " An equity price cannot fall below zero." : "";
    return { ok: false, code: "OUT_OF_BOUNDS", message: `The shock must be between ${min} and ${max} ${unit}.${why}` };
  }
  return { ok: true };
}

/** Selector/type compatibility: asset-class and security selectors fix the type; issuer selectors accept either. */
export function checkCompatibility(selector: ShockSelector, type: ShockType): { ok: true } | { ok: false; message: string } {
  const expected: ShockType | null = selector.kind === "ASSET_CLASS" ? shockTypeForAssetClass(selector.assetClass) : selector.kind === "SECURITY" ? (selector.instrument === "EQUITY" ? "PRICE_PCT" : "YIELD_BPS") : null;
  if (expected === null || expected === type) return { ok: true };
  return { ok: false, message: type === "PRICE_PCT" ? "A price % shock applies to equities only — bonds and Treasury bills take a yield / rate shock in basis points." : "A yield (bps) shock applies to bonds and Treasury bills only — equities take a price % shock." };
}

/** Identity of the (selector, domain) a rule occupies — two rules with the same identity are ambiguous. */
export function selectorIdentity(rule: Pick<ScenarioShockRule, "selector" | "shockType">): string {
  const s = rule.selector;
  switch (s.kind) {
    case "ASSET_CLASS":
      return `ASSET_CLASS|${s.assetClass}`;
    case "ISSUER":
      return `ISSUER|${s.issuerKey}|${rule.shockType}`;
    case "SECURITY":
      return `SECURITY|${s.instrument}|${s.instrumentId}`;
  }
}

/** Validates a whole scenario definition BEFORE execution. Returns every problem found. */
export function validateRules(rules: ScenarioShockRule[]): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];
  const seen = new Map<string, string>();
  for (const rule of rules) {
    const v = validateShockValue(rule.shockType, rule.value);
    if (!v.ok) errors.push({ ruleId: rule.id, code: v.code, message: `${rule.targetLabel}: ${v.message}` });
    const c = checkCompatibility(rule.selector, rule.shockType);
    if (!c.ok) errors.push({ ruleId: rule.id, code: "INCOMPATIBLE", message: `${rule.targetLabel}: ${c.message}` });
    const id = selectorIdentity(rule);
    const prior = seen.get(id);
    if (prior !== undefined) errors.push({ ruleId: rule.id, code: "DUPLICATE", message: `${rule.targetLabel}: more than one ${SHOCK_UNIT_LABEL[rule.shockType]} assumption targets the same thing — Korbly will not choose between them.` });
    else seen.set(id, rule.id);
  }
  return errors;
}

function levelOf(rule: ScenarioShockRule): PrecedenceLevel {
  return rule.selector.kind;
}

/** Does this rule reach this position? Domain (shock type vs asset class) is always checked. */
export function ruleReaches(rule: ScenarioShockRule, p: Pick<ScenarioPosition, "assetClass" | "issuer" | "instrumentId">): boolean {
  if (!shockTypeReaches(rule.shockType, p.assetClass)) return false;
  const s = rule.selector;
  switch (s.kind) {
    case "ASSET_CLASS":
      return s.assetClass === p.assetClass;
    case "ISSUER":
      return s.issuerKey === p.issuer.key;
    case "SECURITY":
      return s.instrumentId === p.instrumentId && instrumentClasses(s.instrument).includes(p.assetClass);
  }
}

const LEVEL_LABEL: Record<PrecedenceLevel, string> = { SECURITY: "security-level", ISSUER: "issuer-level", ASSET_CLASS: "asset-class" };

/** Picks the single applicable rule. Assumes `validateRules` passed (no same-level ambiguity). */
export function resolveShock(position: Pick<ScenarioPosition, "assetClass" | "issuer" | "instrumentId">, rules: ScenarioShockRule[]): ShockResolution {
  const matched = rules.filter((r) => ruleReaches(r, position)).sort((a, b) => PRECEDENCE_ORDER.indexOf(levelOf(a)) - PRECEDENCE_ORDER.indexOf(levelOf(b)));
  if (matched.length === 0) return { matchedRules: [], winner: null, precedence: null, reason: "No assumption applies to this position, so it is unchanged." };
  const winner = matched[0];
  const level = levelOf(winner);
  const overridden = matched.length - 1;
  const reason = overridden === 0 ? `The ${LEVEL_LABEL[level]} assumption for ${winner.targetLabel} applies.` : `The ${LEVEL_LABEL[level]} assumption for ${winner.targetLabel} overrides ${overridden} lower-precedence assumption${overridden === 1 ? "" : "s"}. Assumptions replace each other; they do not add up.`;
  return { matchedRules: matched, winner, precedence: level, reason };
}
