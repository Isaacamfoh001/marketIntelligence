// ---------------------------------------------------------------------------
// Valuation assumptions (M9.0.1). Pure — no I/O, no Prisma, no React.
//
// Korbly is deliberately conservative about REFERENCE valuation: with no reliable
// observed evidence a holding is "unvalued". That must not stop an analyst asking
// "what would this portfolio look like if I held it?". So the analyst may supply an
// EXPLICIT STARTING ASSUMPTION — and Korbly then carries that holding at an
// ANALYST_ASSUMPTION value, disclosed as such everywhere, never as an observation.
//
//   no reliable Reference value  →  valuation assumption  →  assumption value
//     →  analytical starting value  →  scenario analysis
//   missing essential contract terms  →  still unavailable (terms are never invented)
//
// NO second engine: an assumed yield goes through M7's priceFromYield, an assumed
// price through M7's computeYtm (to recover the yield the scenario engine and DV01
// need), a bill assumption through the M8.5 bill formula, an equity price is
// shares × price. The result is an ordinary ValuedPosition (same `detail` shapes), so
// exposures, rate sensitivity and the scenario engine consume it unchanged.
//
// STARTING ASSUMPTION ≠ SCENARIO SHOCK. The assumption fixes where the holding
// STARTS ("assume a 28% yield"); a scenario shock then moves it from there
// ("yields +300 bps → 31%"). Changing the starting assumption changes the scenario
// result, and Korbly says so.
//
// PAR is never a silent fallback. It exists only as an explicit, labelled
// assumption for bonds ("Use par as an assumption": clean price = face value, with
// accrued interest added). It is not offered for bills (par before maturity implies
// a 0% rate) or equities (no par concept for a share price).
// ---------------------------------------------------------------------------

import { cleanToDirty, computeAccruedInterest, computeYtm, priceFromYield, type BondTerms } from "../fixed-income";
import { BILL_CONVENTION_LABEL, BILL_FORMULA, billDv01PerUnitFace, billModifiedDurationYears, billPriceFactor, billPricePer100, billRateFromPricePer100 } from "../treasury-bills";
import type { BondValuationDetail, BillValuationDetail, EquityValuationDetail, KorblyBasisSummary, PositionValuation, UnvaluedPosition, ValuedPosition } from "./valuation";
import { round2 } from "./valuation";
import type { AppliedAssumption, AssumptionKind, PortfolioAssetClass, StoredAssumption, UnvaluedCode } from "./types";

// --- What may be assumed, by asset class ----------------------------------------------------

export const ASSUMPTION_KINDS_BY_CLASS: Record<PortfolioAssetClass, AssumptionKind[]> = {
  BOND: ["YIELD_PCT", "PRICE_PER_100", "PAR"],
  TREASURY_BILL: ["RATE_PCT", "PRICE_PER_100"],
  EQUITY: ["SHARE_PRICE_GHS"],
};

export const ASSUMPTION_KIND_LABEL: Record<AssumptionKind, string> = {
  YIELD_PCT: "Assume a yield",
  RATE_PCT: "Assume a rate",
  PRICE_PER_100: "Assume a price",
  PAR: "Use par as an assumption",
  SHARE_PRICE_GHS: "Assume a share price",
};

/** Unit shown beside the input. */
export const ASSUMPTION_UNIT: Record<AssumptionKind, string> = {
  YIELD_PCT: "% a year",
  RATE_PCT: "% a year",
  PRICE_PER_100: "per 100 of face value",
  PAR: "",
  SHARE_PRICE_GHS: "GHS per share",
};

/** Plain-English help, shown with the option. */
export const ASSUMPTION_HELP: Record<AssumptionKind, { bond?: string; bill?: string; equity?: string }> = {
  YIELD_PCT: { bond: "The yield you assume this bond starts at. Korbly prices the bond from it using the same engine as every other bond." },
  RATE_PCT: { bill: "The Treasury-bill rate you assume (simple interest, Actual/365). Korbly values the bill from it with the Treasury-bill formula." },
  PRICE_PER_100: {
    bond: "A clean price per 100 of face value (the quoted price — accrued interest is added). Korbly works out the yield it implies so the bond can be stress-tested.",
    bill: "A price per 100 of face value. Korbly works out the rate it implies so the bill can be stress-tested.",
  },
  PAR: { bond: "Treat the bond as priced at par (clean price equal to face value) — an assumption you are making, not a view that par is today's value. Accrued interest is added." },
  SHARE_PRICE_GHS: { equity: "The price per share you want to assume. No fair-value model is used." },
};

export const ASSUMPTION_BOUNDS = {
  /** Annual yield / bill rate, percent. Broad sanity bounds, not a view on any current level. */
  RATE_PCT: { min: 0, max: 100 },
  /** Price per 100 of face. */
  PRICE_PER_100: { minExclusive: 0, max: 1000 },
  /** GHS per share. */
  SHARE_PRICE_GHS: { minExclusive: 0, max: 1_000_000 },
} as const;

/** The disclosure that must accompany every assumption. */
export const ASSUMPTION_DISCLOSURE = "This is an analyst assumption, not an observed market price.";
export const ASSUMPTION_PROVENANCE = "Analyst assumption" as const;

export const kindsFor = (assetClass: PortfolioAssetClass): AssumptionKind[] => ASSUMPTION_KINDS_BY_CLASS[assetClass];

// --- Which unvalued cases may accept an assumption --------------------------------------------

const ASSUMABLE_CODES: ReadonlySet<UnvaluedCode> = new Set<UnvaluedCode>(["NO_OBSERVATION", "NO_REFERENCE_RATE", "NO_TRADE", "UNDER_REVIEW", "OBSERVATION_EXCLUDED", "NO_PRICE", "CALCULATION_FAILED"]);

const NOT_ASSUMABLE_REASON: Partial<Record<UnvaluedCode, string>> = {
  NOT_GHS: "Only GHS instruments are supported.",
  MATURED: "A matured instrument has no remaining cash flows to value.",
  FLOATING_RATE: "A floating-rate bond's future coupons cannot be projected, so no yield or price assumption can value it.",
  NOT_OUTSTANDING: "The Securities Master records this bond as no longer outstanding, so its cash flows cannot be assumed.",
  TERMS_UNSUPPORTED: "The bond's contractual terms (coupon rate or frequency) are incomplete. Korbly does not invent contract terms — complete them in the Securities Master first.",
  TERMS_CONFLICT: "The source and the Securities Master disagree on this bond's terms, so its cash flows are uncertain. Resolve the conflict first.",
  INACTIVE: "This security is inactive (delisted or suspended).",
};

export type AssumptionAvailability = { assumable: true; kinds: AssumptionKind[] } | { assumable: false; reason: string };

/**
 * Can an analyst assumption stand in for a missing Reference value? Only when the
 * gap is MARKET EVIDENCE. A gap in the instrument's own terms stays unavailable.
 */
export function assumptionAvailability(assetClass: PortfolioAssetClass, code: UnvaluedCode): AssumptionAvailability {
  if (!ASSUMABLE_CODES.has(code)) return { assumable: false, reason: NOT_ASSUMABLE_REASON[code] ?? "This instrument cannot be modelled." };
  return { assumable: true, kinds: kindsFor(assetClass) };
}

// --- Validation of the analyst's input ---------------------------------------------------------

export type AssumptionDraft = { kind: AssumptionKind; value: number | null };
export type AssumptionCheck = { ok: true; assumption: AssumptionDraft } | { ok: false; error: string };

const fmt = (n: number, dp = 2) => n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Checks an assumption's kind against the asset class and its value against broad
 * sanity bounds. Rejects NaN/Infinity, zero or negative prices, out-of-range
 * yields — never clamps. PAR takes no value.
 */
export function validateAssumption(assetClass: PortfolioAssetClass, kind: AssumptionKind, value: number | null): AssumptionCheck {
  if (!kindsFor(assetClass).includes(kind)) {
    return { ok: false, error: `${ASSUMPTION_KIND_LABEL[kind]} is not available for this kind of instrument.${kind === "PAR" ? " Par is offered only for bonds." : ""}` };
  }
  if (kind === "PAR") {
    if (value !== null) return { ok: false, error: "Par takes no value — it means a clean price equal to face value." };
    return { ok: true, assumption: { kind, value: null } };
  }
  if (value === null || !Number.isFinite(value)) return { ok: false, error: "Enter the assumption as a number." };
  if (kind === "YIELD_PCT" || kind === "RATE_PCT") {
    const b = ASSUMPTION_BOUNDS.RATE_PCT;
    if (value < b.min || value > b.max) return { ok: false, error: `A ${kind === "YIELD_PCT" ? "yield" : "rate"} must be between ${b.min}% and ${b.max}% a year (enter 28 for 28%).` };
    return { ok: true, assumption: { kind, value } };
  }
  if (kind === "PRICE_PER_100") {
    const b = ASSUMPTION_BOUNDS.PRICE_PER_100;
    if (!(value > b.minExclusive)) return { ok: false, error: "A price must be greater than zero." };
    if (value > b.max) return { ok: false, error: `A price per 100 of face value cannot exceed ${b.max}.` };
    return { ok: true, assumption: { kind, value } };
  }
  const b = ASSUMPTION_BOUNDS.SHARE_PRICE_GHS;
  if (!(value > b.minExclusive)) return { ok: false, error: "A share price must be greater than zero." };
  if (value > b.max) return { ok: false, error: `A share price cannot exceed GHS ${b.max.toLocaleString("en-GB")}.` };
  return { ok: true, assumption: { kind, value } };
}

export function describeAssumption(kind: AssumptionKind, value: number | null): string {
  switch (kind) {
    case "YIELD_PCT":
      return `${fmt(value ?? 0)}% yield`;
    case "RATE_PCT":
      return `${fmt(value ?? 0)}% rate`;
    case "PRICE_PER_100":
      return `price ${fmt(value ?? 0, 4)} per 100`;
    case "PAR":
      return "par (clean price = face value)";
    case "SHARE_PRICE_GHS":
      return `GHS ${fmt(value ?? 0, 4)} per share`;
  }
}

// --- Valuation under an assumption -------------------------------------------------------------

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function applied(a: StoredAssumption, method: string, calculation: string[]): AppliedAssumption {
  return { kind: a.kind, value: a.value, overridesReference: a.overridesReference, provenance: ASSUMPTION_PROVENANCE, summary: describeAssumption(a.kind, a.value), method, calculation };
}

function unvalued(assetClass: PortfolioAssetClass, a: StoredAssumption, reason: string): UnvaluedPosition {
  return { status: "UNVALUED", assetClass, available: false, code: "CALCULATION_FAILED", reason: `The analyst assumption (${describeAssumption(a.kind, a.value)}) could not be applied: ${reason}`, assumptionProblem: { summary: describeAssumption(a.kind, a.value), reason } };
}

const assumedFields = { basis: "ANALYST_ASSUMPTION", recency: "NOT_APPLICABLE", inputAgeDays: 0, ignoredAssumption: null, korblyBasis: null } as const;

/** BOND — assumed yield (→ M7 priceFromYield), assumed clean price or explicit par (→ M7 computeYtm for the implied yield). */
export function valueBondWithAssumption(nominalGhs: number, terms: BondTerms, a: StoredAssumption, valuationDate: Date): PositionValuation {
  const check = validateAssumption("BOND", a.kind, a.value);
  if (!check.ok) return unvalued("BOND", a, check.error);
  const accrued = computeAccruedInterest(terms, valuationDate);
  if (!accrued.ok) return unvalued("BOND", a, accrued.message);
  const face = terms.faceValue;
  const day = isoDay(valuationDate);

  let yieldPct: number;
  let dirty: number;
  let method: string;
  const calc: string[] = [];
  if (a.kind === "YIELD_PCT") {
    const priced = priceFromYield(terms, valuationDate, a.value as number);
    if (!priced.ok) return unvalued("BOND", a, priced.message);
    yieldPct = a.value as number;
    dirty = priced.dirtyPrice;
    method = "The assumed yield is priced with the same bond engine Korbly uses for every bond.";
    calc.push(`Assumed yield = ${fmt(yieldPct, 4)}%`, `Dirty price per ${face} = priceFromYield(terms, ${day}, ${fmt(yieldPct, 4)}%) = ${fmt(dirty, 6)}`);
  } else {
    const clean = a.kind === "PAR" ? face : (a.value as number) * (face / 100);
    dirty = cleanToDirty(clean, accrued.accruedInterest);
    const ytm = computeYtm(terms, valuationDate, dirty);
    if (!ytm.ok) return unvalued("BOND", a, `no yield can be derived from that price (${ytm.message})`);
    if (!Number.isFinite(ytm.ytmPct) || ytm.ytmPct <= -100) return unvalued("BOND", a, "that price implies an impossible yield");
    yieldPct = ytm.ytmPct;
    method = a.kind === "PAR" ? "Par is treated as a clean price equal to face value; accrued interest is added and the implied yield is solved with the bond engine." : "The assumed clean price has accrued interest added; the implied yield is solved with the bond engine.";
    calc.push(`Assumed clean price per ${face} = ${fmt(clean, 4)}${a.kind === "PAR" ? " (par)" : ""}`, `Accrued interest at ${day} = ${fmt(accrued.accruedInterest, 6)}`, `Dirty price = clean + accrued = ${fmt(dirty, 6)}`, `Implied yield = ${fmt(yieldPct, 4)}%`);
  }
  if (!Number.isFinite(dirty) || !(dirty > 0)) return unvalued("BOND", a, "the assumption does not give a positive price");
  const value = round2((nominalGhs * dirty) / face);
  calc.push(`Value = nominal × dirty ÷ ${face} = GHS ${fmt(nominalGhs)} × ${fmt(dirty, 6)} ÷ ${face} = GHS ${fmt(value)}`);

  const detail: BondValuationDetail = {
    assetClass: "BOND",
    nominalGhs,
    faceValue: face,
    valuationDate: day,
    observedYtmPct: yieldPct,
    observationDate: day,
    ageDays: 0,
    observedCleanPrice: null,
    yieldFromSourceQuote: false,
    referenceCleanPrice: dirty - accrued.accruedInterest,
    accruedInterest: accrued.accruedInterest,
    referenceDirtyPrice: dirty,
    pendingReview: null,
    yieldIsAssumed: true,
  };
  return { status: "VALUED", assetClass: "BOND", ...assumedFields, referenceValueGhs: value, inputDate: day, detail, assumption: applied(a, method, calc) };
}

/** TREASURY BILL — assumed rate (M8.5 formula) or assumed price per 100 (→ the rate it implies). Par is not offered: before maturity it would imply a 0% rate. */
export function valueBillWithAssumption(faceValueGhs: number, daysToMaturity: number, a: StoredAssumption, valuationDate: Date): PositionValuation {
  const check = validateAssumption("TREASURY_BILL", a.kind, a.value);
  if (!check.ok) return unvalued("TREASURY_BILL", a, check.error);
  if (!(daysToMaturity > 0)) return unvalued("TREASURY_BILL", a, "the bill has no time left to maturity");
  const day = isoDay(valuationDate);

  let ratePct: number;
  let value: number;
  let method: string;
  const calc: string[] = [];
  if (a.kind === "RATE_PCT") {
    ratePct = a.value as number;
    const factor = billPriceFactor(ratePct, daysToMaturity);
    if (factor === null) return unvalued("TREASURY_BILL", a, "that rate is outside the range the formula can price");
    value = round2(faceValueGhs * factor);
    method = "The assumed rate is applied with the Treasury-bill formula (simple interest, Actual/365).";
    calc.push(`Assumed rate = ${fmt(ratePct, 4)}%`, `Days to maturity = ${daysToMaturity}`, `Value = face ÷ (1 + rate × days ÷ 365) = GHS ${fmt(faceValueGhs)} ÷ (1 + ${fmt(ratePct / 100, 6)} × ${daysToMaturity} ÷ 365) = GHS ${fmt(value)}`);
  } else {
    const price = a.value as number;
    const implied = billRateFromPricePer100(price, daysToMaturity);
    if (implied === null || !Number.isFinite(implied)) return unvalued("TREASURY_BILL", a, "no rate can be derived from that price");
    const b = ASSUMPTION_BOUNDS.RATE_PCT;
    if (implied < b.min || implied > b.max) return unvalued("TREASURY_BILL", a, `that price implies a rate of ${fmt(implied, 2)}%, outside ${b.min}%–${b.max}% (a bill cannot be worth more than its face value)`);
    ratePct = implied;
    value = round2((faceValueGhs * price) / 100);
    method = "The assumed price per 100 of face value is applied directly; the rate it implies (simple interest, Actual/365) is derived so the bill can be stress-tested.";
    calc.push(`Assumed price per 100 = ${fmt(price, 4)}`, `Value = face × price ÷ 100 = GHS ${fmt(faceValueGhs)} × ${fmt(price, 4)} ÷ 100 = GHS ${fmt(value)}`, `Implied rate = (100 ÷ price − 1) × 365 ÷ days = ${fmt(ratePct, 4)}%`);
  }
  const factor = billPriceFactor(ratePct, daysToMaturity);
  const dv01Unit = billDv01PerUnitFace(ratePct, daysToMaturity);
  const md = billModifiedDurationYears(ratePct, daysToMaturity);
  const price100 = billPricePer100(ratePct, daysToMaturity);
  if (factor === null || dv01Unit === null || md === null || price100 === null) return unvalued("TREASURY_BILL", a, "the value could not be calculated");

  const detail: BillValuationDetail = {
    assetClass: "TREASURY_BILL",
    faceValueGhs,
    valuationDate: day,
    daysToMaturity,
    referenceRatePct: ratePct,
    rateObservationDate: day,
    ageDays: 0,
    method: "ANALYST_ASSUMPTION",
    methodDescription: "An analyst-assumed starting rate — not read from the Bank of Ghana auction curve.",
    nodes: [],
    referencePricePer100: price100,
    remainingDiscountGhs: round2(faceValueGhs - value),
    dv01Ghs: faceValueGhs * dv01Unit,
    modifiedDurationYears: md,
    convention: BILL_CONVENTION_LABEL,
    formula: BILL_FORMULA,
  };
  return { status: "VALUED", assetClass: "TREASURY_BILL", ...assumedFields, referenceValueGhs: value, inputDate: day, detail, assumption: applied(a, method, calc) };
}

/** EQUITY — shares × the assumed price. No yield, DCF or fair-value model. */
export function valueEquityWithAssumption(shares: number, a: StoredAssumption, valuationDate: Date): PositionValuation {
  const check = validateAssumption("EQUITY", a.kind, a.value);
  if (!check.ok) return unvalued("EQUITY", a, check.error);
  const price = a.value as number;
  const day = isoDay(valuationDate);
  const value = round2(shares * price);
  const detail: EquityValuationDetail = { assetClass: "EQUITY", shares, priceGhs: price, priceDate: day, ageDays: 0, volume: 0, valueTradedGhs: null, latestReportDate: day, skippedNoTradeRows: 0, priceIsAssumed: true };
  return {
    status: "VALUED",
    assetClass: "EQUITY",
    ...assumedFields,
    referenceValueGhs: value,
    inputDate: day,
    detail,
    assumption: applied(a, "Shares multiplied by the assumed price.", [`Assumed price = GHS ${fmt(price, 4)} per share`, `Value = shares × price = ${shares.toLocaleString("en-GB")} × GHS ${fmt(price, 4)} = GHS ${fmt(value)}`]),
  };
}

/** The facts an assumption needs about a holding — plain and serialisable, so the same function serves the server and a live client preview. */
export type AssumptionSubject = { assetClass: "BOND"; nominalGhs: number; terms: BondTerms } | { assetClass: "EQUITY"; shares: number } | { assetClass: "TREASURY_BILL"; faceValueGhs: number; daysToMaturity: number };

/** One entry point over the three asset-class valuers. */
export function valueWithAssumption(subject: AssumptionSubject, a: StoredAssumption, valuationDate: Date): PositionValuation {
  if (subject.assetClass === "BOND") return valueBondWithAssumption(subject.nominalGhs, subject.terms, a, valuationDate);
  if (subject.assetClass === "EQUITY") return valueEquityWithAssumption(subject.shares, a, valuationDate);
  return valueBillWithAssumption(subject.faceValueGhs, subject.daysToMaturity, a, valuationDate);
}

// --- Precedence ----------------------------------------------------------------------------------

const korblyBasisOf = (v: ValuedPosition): KorblyBasisSummary => ({ basis: v.basis as KorblyBasisSummary["basis"], valueGhs: v.referenceValueGhs, inputDate: v.inputDate, recency: v.recency });

/**
 * The single rule that decides which value a position is carried at. Korbly's
 * supported value is NEVER overwritten:
 *
 *   no assumption                                  → Korbly's own result (reference / indicative / unvalued)
 *   assumption, Korbly unvalued, instrument assumable → the assumption value (or unvalued, with the reason, if it cannot be applied)
 *   assumption, Korbly unvalued, NOT assumable     → stays unvalued — terms are never invented
 *   assumption entered as an OVERRIDE, Korbly valued → the assumption, with Korbly's value kept beside it (`korblyBasis`)
 *   assumption entered to fill a GAP, Korbly now valued → Korbly's value wins; the assumption is flagged `ignoredAssumption`
 *
 * `assumed` is called only when the assumption is to be used.
 */
export function resolveValuation(korbly: PositionValuation, stored: StoredAssumption | null, assumed: () => PositionValuation): PositionValuation {
  if (!stored) return korbly;
  if (korbly.status === "VALUED") {
    if (!stored.overridesReference) {
      const shadow = assumed();
      return { ...korbly, ignoredAssumption: shadow.status === "VALUED" ? shadow.assumption : applied(stored, "", []) };
    }
    const over = assumed();
    if (over.status !== "VALUED") return { ...korbly, ignoredAssumption: applied(stored, "", []) };
    return { ...over, korblyBasis: korblyBasisOf(korbly) };
  }
  const available = assumptionAvailability(korbly.assetClass, korbly.code);
  if (!available.assumable) return korbly;
  return assumed();
}

// --- Wording ---------------------------------------------------------------------------------------

export const BASIS_LABEL: Record<"REFERENCE" | "INDICATIVE" | "ANALYST_ASSUMPTION" | "UNVALUED", string> = {
  REFERENCE: "Reference",
  INDICATIVE: "Indicative",
  ANALYST_ASSUMPTION: "Analyst assumption",
  UNVALUED: "Unvalued",
};

export const BASIS_MEANING: Record<"REFERENCE" | "INDICATIVE" | "ANALYST_ASSUMPTION" | "UNVALUED", string> = {
  REFERENCE: "Korbly-supported: built from accepted observed market evidence.",
  INDICATIVE: "Korbly-modelled: a defensible estimate without an instrument-level quote.",
  ANALYST_ASSUMPTION: "Assumed by the analyst: not observed, and not a Korbly valuation.",
  UNVALUED: "Unknown: no reliable value and no assumption — excluded, not counted as zero.",
};
