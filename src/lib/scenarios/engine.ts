// ---------------------------------------------------------------------------
// Scenario engine (M8.3). Pure — no I/O, no Prisma, no React.
//
//   M8.1 reference valuations + explicit assumptions
//     → shock resolution (one winning rule per position; no stacking)
//     → position repricing
//     → portfolio aggregation + audit trail
//
// BONDS are FULLY REPRICED with M7's engine at the scenario yield:
//     y1       = y0 + shockBps / 100                    (percent units)
//     P1_dirty = priceFromYield(terms, valuationDate, y1)
//     value    = nominal × P1_dirty / faceValue
// on the SAME valuation date as the M8.1 reference value (which is also a dirty
// price), so accrued interest is identical and a yield-only shock moves only
// the clean component. DV01 × shock is exposed purely as a first-order
// comparison — it never replaces repricing.
//
// EQUITIES: scenarioPrice = referencePrice × (1 + pct/100) using the M8.1
// reference price; no price is fetched here.
//
// NO BASELINE → NO SCENARIO: a position M8.1 could not value stays unavailable.
// NO MATCHING RULE → UNCHANGED (scenario value = reference value), which is a
// defined result, not an unavailable one.
//
// MONEY: reference values arrive rounded to the pesewa (M8.1). Each scenario
// value is rounded ONCE to the pesewa; everything is summed as integer cents,
// so Σ position impacts == Σ class impacts == portfolio impact exactly.
// Prices/yields stay in floating point (like M7) and are never rounded
// before the value is formed.
// ---------------------------------------------------------------------------

import { buildPricingPoints, computeDuration, priceFromYield } from "../fixed-income";
import { BILL_CONVENTION_LABEL, BILL_FORMULA, billPriceFactor, billPricePer100 } from "../treasury-bills";
import { EXPOSURE_ASSET_CLASS_ORDER, round2, type ValuedPosition, type BondValuationDetail, type BillValuationDetail, type EquityValuationDetail } from "../portfolio";
import { explainScenario } from "./explain";
import { resolveShock, validateRules } from "./shocks";
import type {
  BillScenarioDetail,
  BondScenarioDetail,
  EquityScenarioDetail,
  ParticipatingPositionResult,
  ScenarioClassRow,
  ScenarioInput,
  ScenarioPosition,
  ScenarioPositionResult,
  ScenarioResult,
  ShockResolution,
  StaleBasis,
  UnavailablePositionResult,
} from "./types";

const toCents = (ghs: number) => Math.round(ghs * 100);
const fromCents = (c: number) => c / 100;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pctOf = (num: number, den: number): number | null => (den === 0 ? null : (num / den) * 100);

export const LARGEST_IMPACTS_LIMIT = 5;

type Repriced<T> = { ok: true; value: T } | { ok: false; code: "INVALID_YIELD_DOMAIN" | "PRICING_FAILED" | "MISSING_TERMS"; reason: string };

/** The pricing function must be defined AND positive at the scenario yield, else the position is unavailable (never NaN/Infinity). */
function repriceBond(p: ScenarioPosition, valued: ValuedPosition, detail: BondValuationDetail, valuationDate: Date, shockBps: number | null, explicitShock: boolean): Repriced<{ result: ParticipatingValues; detail: BondScenarioDetail; warnings: string[] }> {
  if (!p.terms) return { ok: false, code: "MISSING_TERMS", reason: "The bond's contractual terms are missing, so it cannot be repriced." };
  const y0 = detail.observedYtmPct;
  const bps = shockBps ?? 0;
  const y1 = y0 + bps / 100;
  const warnings: string[] = [];

  let dirty1 = detail.referenceDirtyPrice;
  if (explicitShock) {
    const built = buildPricingPoints(p.terms, valuationDate);
    if (!built.ok) return { ok: false, code: "PRICING_FAILED", reason: built.message };
    // Domain of the discount function: (1 + y/freq) > 0 (compounded) or (1 + y·t) > 0 (final-period simple interest).
    const base = built.simpleFinalPeriod ? 1 + (y1 / 100) * (built.points[0].exponent / built.freq) : 1 + y1 / 100 / built.freq;
    if (!(base > 0)) return { ok: false, code: "INVALID_YIELD_DOMAIN", reason: `A scenario yield of ${y1.toFixed(4)}% is outside the range where this bond can be priced.` };
    const priced = priceFromYield(p.terms, valuationDate, y1);
    if (!priced.ok) return { ok: false, code: "PRICING_FAILED", reason: priced.message };
    if (!Number.isFinite(priced.dirtyPrice) || priced.dirtyPrice <= 0) return { ok: false, code: "INVALID_YIELD_DOMAIN", reason: `A scenario yield of ${y1.toFixed(4)}% does not give a positive finite price.` };
    dirty1 = priced.dirtyPrice;
  }
  if (y1 < 0) warnings.push(`The scenario yield is negative (${y1.toFixed(2)}%).`);

  const refCents = toCents(valued.referenceValueGhs);
  const scenCents = explicitShock ? toCents(round2((detail.nominalGhs * dirty1) / p.terms.faceValue)) : refCents;

  let dv01Ghs: number | null = null;
  let firstOrder: number | null = null;
  let firstOrderError: number | null = null;
  if (explicitShock) {
    const dur = computeDuration(p.terms, valuationDate, y0);
    if (dur.ok) {
      dv01Ghs = (dur.dv01 * detail.nominalGhs) / p.terms.faceValue;
      firstOrder = -dv01Ghs * bps;
      firstOrderError = fromCents(scenCents - refCents) - firstOrder;
    }
  }

  return {
    ok: true,
    value: {
      result: { refCents, scenCents },
      warnings,
      detail: {
        assetClass: "BOND",
        nominalGhs: detail.nominalGhs,
        faceValue: p.terms.faceValue,
        referenceYieldPct: y0,
        appliedShockBps: bps,
        scenarioYieldPct: y1,
        referenceDirtyPrice: detail.referenceDirtyPrice,
        scenarioDirtyPrice: dirty1,
        accruedInterest: detail.accruedInterest,
        referenceCleanPrice: detail.referenceCleanPrice,
        scenarioCleanPrice: dirty1 - detail.accruedInterest,
        dv01Ghs,
        firstOrderImpactGhs: firstOrder,
        firstOrderErrorGhs: firstOrderError,
      },
    },
  };
}

interface ParticipatingValues {
  refCents: number;
  scenCents: number;
}

/**
 * A Treasury bill is repriced with ITS OWN convention (simple interest, Act/365):
 *   r1 = r0 + shockBps/100 ;  value = face / (1 + r1 × d/365)
 * on the same valuation date and remaining days as the M8.1 reference value. The
 * M7 compounding routine is deliberately not used (see treasury-bills/convention.ts).
 */
function repriceBill(valued: ValuedPosition, detail: BillValuationDetail, shockBps: number | null, explicitShock: boolean): Repriced<{ result: ParticipatingValues; detail: BillScenarioDetail; warnings: string[] }> {
  const bps = shockBps ?? 0;
  const r1 = detail.referenceRatePct + bps / 100;
  const warnings: string[] = [];
  const refCents = toCents(valued.referenceValueGhs);
  let scenCents = refCents;
  let price1 = detail.referencePricePer100;
  if (explicitShock) {
    const factor = billPriceFactor(r1, detail.daysToMaturity);
    const p = billPricePer100(r1, detail.daysToMaturity);
    if (factor === null || p === null || !(factor > 0)) return { ok: false, code: "INVALID_YIELD_DOMAIN", reason: `A scenario rate of ${r1.toFixed(4)}% is outside the range where this bill can be priced.` };
    scenCents = toCents(round2(detail.faceValueGhs * factor));
    price1 = p;
  }
  if (r1 < 0) warnings.push(`The scenario rate is negative (${r1.toFixed(2)}%).`);
  const firstOrder = explicitShock ? 0 - detail.dv01Ghs * bps : 0; // `0 −` rather than unary minus: a zero shock must give +0, never −0
  return {
    ok: true,
    value: {
      result: { refCents, scenCents },
      warnings,
      detail: {
        assetClass: "TREASURY_BILL",
        faceValueGhs: detail.faceValueGhs,
        daysToMaturity: detail.daysToMaturity,
        referenceRatePct: detail.referenceRatePct,
        appliedShockBps: bps,
        scenarioRatePct: r1,
        referencePricePer100: detail.referencePricePer100,
        scenarioPricePer100: price1,
        dv01Ghs: detail.dv01Ghs,
        firstOrderImpactGhs: firstOrder,
        firstOrderErrorGhs: fromCents(scenCents - refCents) - firstOrder,
        convention: BILL_CONVENTION_LABEL,
        formula: BILL_FORMULA,
      },
    },
  };
}

function repriceEquity(valued: ValuedPosition, detail: EquityValuationDetail, shockPct: number | null, explicitShock: boolean): { result: ParticipatingValues; detail: EquityScenarioDetail } {
  const pct = shockPct ?? 0;
  const scenarioPrice = detail.priceGhs * (1 + pct / 100);
  const refCents = toCents(valued.referenceValueGhs);
  const scenCents = explicitShock ? toCents(round2(detail.shares * scenarioPrice)) : refCents;
  return { result: { refCents, scenCents }, detail: { assetClass: "EQUITY", shares: detail.shares, referencePriceGhs: detail.priceGhs, appliedShockPct: pct, scenarioPriceGhs: explicitShock ? scenarioPrice : detail.priceGhs } };
}

export function runScenario(input: ScenarioInput): ScenarioResult {
  const errors = validateRules(input.rules);
  if (errors.length > 0) return { ok: false, errors };

  const valuationDate = input.valuationDate;
  type Interim = { position: ScenarioPosition; resolution: ShockResolution; values?: ParticipatingValues; detail?: BondScenarioDetail | EquityScenarioDetail | BillScenarioDetail; warnings?: string[]; fail?: UnavailablePositionResult };
  const interim: Interim[] = input.positions.map((position) => {
    const resolution = resolveShock(position, input.rules);
    const common = { positionId: position.positionId, label: position.label, assetClass: position.assetClass, issuer: position.issuer, resolution };
    const v = position.valuation;
    if (v.status !== "VALUED") {
      return { position, resolution, fail: { ...common, status: "UNAVAILABLE", code: "UNVALUED_REFERENCE", upstreamCode: v.code, reason: v.reason } };
    }
    const shock = resolution.winner ? resolution.winner.value : null;
    const explicit = resolution.winner !== null;
    if (v.detail.assetClass === "BOND") {
      const r = repriceBond(position, v, v.detail, valuationDate, shock, explicit);
      if (!r.ok) return { position, resolution, fail: { ...common, status: "UNAVAILABLE", code: r.code, upstreamCode: null, reason: r.reason } };
      return { position, resolution, values: r.value.result, detail: r.value.detail, warnings: r.value.warnings };
    }
    if (v.detail.assetClass === "TREASURY_BILL") {
      const r = repriceBill(v, v.detail, shock, explicit);
      if (!r.ok) return { position, resolution, fail: { ...common, status: "UNAVAILABLE", code: r.code, upstreamCode: null, reason: r.reason } };
      return { position, resolution, values: r.value.result, detail: r.value.detail, warnings: r.value.warnings };
    }
    const r = repriceEquity(v, v.detail, shock, explicit);
    return { position, resolution, values: r.result, detail: r.detail, warnings: [] };
  });

  const participating = interim.filter((i) => i.values);
  const basisCents = participating.reduce((s, i) => s + i.values!.refCents, 0);
  const hasBasis = participating.length > 0;

  const positions: ScenarioPositionResult[] = interim.map((i): ScenarioPositionResult => {
    if (i.fail) return i.fail;
    const v = i.position.valuation as ValuedPosition;
    const { refCents, scenCents } = i.values!;
    const impact = scenCents - refCents;
    return {
      positionId: i.position.positionId,
      label: i.position.label,
      assetClass: i.position.assetClass,
      issuer: i.position.issuer,
      resolution: i.resolution,
      status: "PARTICIPATING",
      outcome: i.resolution.winner ? "SHOCKED" : "UNCHANGED",
      recency: v.recency,
      inputDate: v.inputDate,
      inputAgeDays: v.inputAgeDays,
      referenceValueGhs: fromCents(refCents),
      scenarioValueGhs: fromCents(scenCents),
      impactGhs: fromCents(impact),
      impactPct: pctOf(impact, refCents),
      contributionPct: pctOf(impact, basisCents),
      detail: i.detail!,
      warnings: i.warnings ?? [],
    };
  });

  const part = positions.filter((p): p is ParticipatingPositionResult => p.status === "PARTICIPATING");
  const sumC = (xs: ParticipatingPositionResult[], f: (p: ParticipatingPositionResult) => number) => xs.reduce((s, p) => s + toCents(f(p)), 0);
  const refC = sumC(part, (p) => p.referenceValueGhs);
  const scenC = sumC(part, (p) => p.scenarioValueGhs);
  const impactC = scenC - refC;

  const byAssetClass: ScenarioClassRow[] = EXPOSURE_ASSET_CLASS_ORDER.map((assetClass) => {
    const rows = part.filter((p) => p.assetClass === assetClass);
    const r = sumC(rows, (p) => p.referenceValueGhs);
    const s = sumC(rows, (p) => p.scenarioValueGhs);
    return {
      assetClass,
      participatingCount: rows.length,
      shockedCount: rows.filter((p) => p.outcome === "SHOCKED").length,
      referenceValueGhs: fromCents(r),
      scenarioValueGhs: fromCents(s),
      impactGhs: fromCents(s - r),
      impactPct: pctOf(s - r, r),
      contributionPct: pctOf(s - r, basisCents),
    };
  });
  const classImpactC = byAssetClass.reduce((s, r) => s + toCents(r.impactGhs), 0);
  const positionImpactC = part.reduce((s, p) => s + toCents(p.impactGhs), 0);

  const staleOf = (rows: ParticipatingPositionResult[]): StaleBasis => ({
    count: rows.length,
    referenceValueGhs: fromCents(sumC(rows, (p) => p.referenceValueGhs)),
    scenarioValueGhs: fromCents(sumC(rows, (p) => p.scenarioValueGhs)),
    impactGhs: fromCents(sumC(rows, (p) => p.scenarioValueGhs) - sumC(rows, (p) => p.referenceValueGhs)),
  });
  const stale = staleOf(part.filter((p) => p.recency === "STALE"));
  const recent = staleOf(part.filter((p) => p.recency === "RECENT"));

  const byLabel = (a: ParticipatingPositionResult, b: ParticipatingPositionResult) => a.label.localeCompare(b.label) || a.positionId.localeCompare(b.positionId);
  const largestNegative = part.filter((p) => p.impactGhs < 0).sort((a, b) => a.impactGhs - b.impactGhs || byLabel(a, b)).slice(0, LARGEST_IMPACTS_LIMIT);
  const largestPositive = part.filter((p) => p.impactGhs > 0).sort((a, b) => b.impactGhs - a.impactGhs || byLabel(a, b)).slice(0, LARGEST_IMPACTS_LIMIT);

  const valued = input.positions.filter((p) => p.valuation.status === "VALUED");
  const m81Cents = valued.reduce((s, p) => s + toCents((p.valuation as ValuedPosition).referenceValueGhs), 0);

  const portfolio = {
    valuationDate: isoDay(valuationDate),
    positionCount: input.positions.length,
    valuedCount: valued.length,
    participatingCount: part.length,
    unvaluedCount: input.positions.length - valued.length,
    scenarioErrorCount: positions.filter((p) => p.status === "UNAVAILABLE" && p.code !== "UNVALUED_REFERENCE").length,
    shockedPositionCount: part.filter((p) => p.outcome === "SHOCKED").length,
    unchangedPositionCount: part.filter((p) => p.outcome === "UNCHANGED").length,
    m81ValuedReferenceValueGhs: valued.length > 0 ? fromCents(m81Cents) : null,
    referenceBasisGhs: hasBasis ? fromCents(refC) : null,
    scenarioValueGhs: hasBasis ? fromCents(scenC) : null,
    impactGhs: hasBasis ? fromCents(impactC) : null,
    impactPct: hasBasis ? pctOf(impactC, refC) : null,
    recentBasis: recent,
    staleBasis: stale,
    staleBasisPct: hasBasis ? pctOf(toCents(stale.referenceValueGhs), refC) : null,
    byAssetClass,
    largestNegative,
    largestPositive,
    reconciles: positionImpactC === impactC && classImpactC === impactC,
  };

  return { ok: true, valuationDate: portfolio.valuationDate, rules: input.rules, positions, portfolio, explanations: explainScenario(input.rules, positions, portfolio) };
}
