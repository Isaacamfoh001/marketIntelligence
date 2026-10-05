// ---------------------------------------------------------------------------
// Language translation layer (M8.4). Pure.
//
// Technical inputs keep their technical form (+200 bps, -10%) and always get a
// plain-English sentence beside them. Human input ("rise", 2.0 percentage
// points) and expert input (+200 bps) resolve to EXACTLY the same stored rule
// value — there is one conversion function and both paths use it.
// ---------------------------------------------------------------------------

import type { ExposureAssetClass } from "../portfolio";
import { GOVERNMENT_OF_GHANA } from "../treasury-bills";
import { SHOCK_BOUNDS, validateShockValue, type ScenarioShockRule, type SelectorKind, type ShockType } from "../scenarios";
import { MINUS_SIGN, signOf } from "./format";

export type Direction = "UP" | "DOWN";
/** How the analyst typed the amount: percentage points (human), basis points (expert), or percent (equity prices). */
export type AmountUnit = "PP" | "BPS" | "PCT";

const clean = (n: number) => {
  const r = Number(n.toFixed(6));
  return r === 0 ? 0 : r; // never −0
};

/**
 * Human/expert input → the stored shock value (bps for yields, % for prices).
 * 2.0 pp and 200 bps both give +200; "fall 10" (%) gives -10. Bounds are the
 * engine's (validateShockValue) — rejected, never clamped.
 */
export function toShockValue(input: { shockType: ShockType; direction: Direction; amount: number; unit: AmountUnit }): { ok: true; value: number } | { ok: false; message: string } {
  const { shockType, direction, amount, unit } = input;
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, message: "Enter the size of the move as a positive number — use the rise/fall choice for direction." };
  if (shockType === "YIELD_BPS" && unit === "PCT") return { ok: false, message: "Bond yields and Treasury-bill rates are entered in percentage points or basis points." };
  if (shockType === "PRICE_PCT" && unit !== "PCT") return { ok: false, message: "Equity prices are entered as a percentage." };
  const magnitude = shockType === "YIELD_BPS" && unit === "PP" ? amount * 100 : amount;
  const value = clean(direction === "DOWN" ? -magnitude : magnitude);
  const v = validateShockValue(shockType, value);
  if (!v.ok) return { ok: false, message: boundsMessage(shockType) };
  return { ok: true, value };
}

function boundsMessage(shockType: ShockType): string {
  if (shockType === "YIELD_BPS") return `Yield moves can be at most ${Math.abs(SHOCK_BOUNDS.YIELD_BPS.max) / 100} percentage points (${SHOCK_BOUNDS.YIELD_BPS.max} bps) in either direction.`;
  return `Equity price moves can fall by at most 100% (a price cannot go below zero) or rise by at most ${SHOCK_BOUNDS.PRICE_PCT.max}%.`;
}

/** Stored value → human direction and amount (percentage points for yields, % for prices). */
export function toHumanInput(shockType: ShockType, value: number): { direction: Direction; amount: number; unit: AmountUnit } {
  const direction: Direction = value < 0 ? "DOWN" : "UP";
  return shockType === "YIELD_BPS" ? { direction, amount: clean(Math.abs(value) / 100), unit: "PP" } : { direction, amount: Math.abs(value), unit: "PCT" };
}

/** "2.0 percentage points" / "1.75 percentage points". */
export function percentagePoints(bps: number): string {
  const pp = Math.abs(bps) / 100;
  const oneDecimalIsExact = Math.abs(pp * 10 - Math.round(pp * 10)) < 1e-9;
  return `${oneDecimalIsExact ? pp.toFixed(1) : pp.toFixed(2)} percentage points`;
}

const trimNum = (n: number) => String(clean(Math.abs(n)));

/** The technical form, always shown beside the plain sentence: "+200 bps", "−10%". */
export function technicalLabel(rule: Pick<ScenarioShockRule, "shockType" | "value">): string {
  const sign = signOf(rule.value);
  return rule.shockType === "YIELD_BPS" ? `${sign}${trimNum(rule.value)} bps` : `${sign}${trimNum(rule.value)}%`;
}

const CLASS_YIELD_SUBJECT = { TREASURY_BILL: "Treasury-bill rates", GOVERNMENT_BOND: "Government bond yields", CORPORATE_BOND: "Corporate bond yields" } as const;

/**
 * The plain-English sentence for one assumption, in the present tense an
 * analyst would say it. It states an assumption — never a prediction.
 */
/** What the sentence needs to know about a target — satisfied by every real ShockSelector, and constructible in the browser without server-only ids. */
export interface SelectorLike {
  kind: SelectorKind;
  assetClass?: ExposureAssetClass;
  instrument?: "BOND" | "EQUITY" | "TREASURY_BILL";
}

export function describeAssumptionPlain(rule: { selector: SelectorLike; shockType: ShockType; value: number; targetLabel: string }): string {
  const { selector, shockType, value, targetLabel } = rule;
  const yields = shockType === "YIELD_BPS";
  let subject: string;
  let isPlural = false;
  if (selector.kind === "ASSET_CLASS") {
    isPlural = true;
    subject = selector.assetClass === "EQUITY" ? "Equity prices" : selector.assetClass ? CLASS_YIELD_SUBJECT[selector.assetClass] : "Yields";
  } else if (selector.kind === "ISSUER") {
    subject = yields ? `${targetLabel} bond yields${targetLabel === GOVERNMENT_OF_GHANA ? " and Treasury-bill rates" : ""}` : `${targetLabel} share price`;
    isPlural = yields;
  } else {
    subject = yields ? `${targetLabel} ${selector.instrument === "TREASURY_BILL" ? "rate" : "yield"}` : `${targetLabel} share price`;
  }
  if (value === 0) return `${subject} ${isPlural ? "are" : "is"} held unchanged.`;
  const verb = yields ? (value > 0 ? "rise" : "fall") : value > 0 ? "rise" : "fall";
  const verbForm = isPlural ? verb : `${verb}s`;
  const amount = yields ? percentagePoints(value) : `${trimNum(value)}%`;
  return `${subject} ${verbForm} by ${amount}.`;
}

/** A compact label for lists and comparison: "Government bonds +200 bps". */
export function shortAssumption(rule: Pick<ScenarioShockRule, "shockType" | "value" | "targetLabel">): string {
  return `${rule.targetLabel} ${technicalLabel(rule)}`;
}

export const LEVEL_LABEL = { ASSET_CLASS: "Asset class", ISSUER: "Issuer", SECURITY: "Security" } as const;

/** Live preview used by the assumption forms: technical + plain, or the reason the input is not valid. */
export function previewAssumption(input: { selector: SelectorLike; targetLabel: string; shockType: ShockType; direction: Direction; amountText: string; unit: AmountUnit }): { ok: true; technical: string; plain: string; value: number } | { ok: false; message: string | null } {
  const t = input.amountText.trim().replace(/,/g, "");
  if (t === "") return { ok: false, message: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, message: "Enter a plain number, e.g. 2.0 or 10." };
  const r = toShockValue({ shockType: input.shockType, direction: input.direction, amount: Number(t), unit: input.unit });
  if (!r.ok) return { ok: false, message: r.message };
  const rule = { selector: input.selector, shockType: input.shockType, value: r.value, targetLabel: input.targetLabel };
  return { ok: true, value: r.value, technical: technicalLabel(rule), plain: describeAssumptionPlain(rule) };
}

export { MINUS_SIGN };
