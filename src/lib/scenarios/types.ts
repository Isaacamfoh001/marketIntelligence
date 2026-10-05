// ---------------------------------------------------------------------------
// Scenario domain types (M8.3). Pure — no I/O, no Prisma, no React.
//
// A scenario is an ASSUMPTION, not a forecast: "you told Korbly to assume X;
// given that and the reference inputs Korbly has, here is the mathematical
// effect on the portfolio." Nothing here says anything is likely.
//
// UNITS (never mixed):
//   YIELD_BPS  — basis points. +200 means +2.00 percentage points. Yields are
//                held as PERCENT everywhere (28.0 = 28.0%), so
//                scenarioYieldPct = referenceYieldPct + shockBps / 100.
//   PRICE_PCT  — percent. -10 means -10%. scenarioPrice = price × (1 + pct/100).
//   Prices     — per `faceValue` (100) for bonds; GHS per share for equities.
//   Money      — GHS, exact to the pesewa (integer cents internally).
// ---------------------------------------------------------------------------

import type { AppliedAssumption, ExposureAssetClass, IssuerRef, KorblyBasisSummary, UnvaluedCode, ValuationBasis, ValuationRecency } from "../portfolio";

export type ShockType = "YIELD_BPS" | "PRICE_PCT";

/** Which table a SECURITY-level target id refers to. TREASURY_BILL ids are TreasuryBill ids (M8.5). */
export type SecurityInstrument = "BOND" | "EQUITY" | "TREASURY_BILL";

/** V1 input bounds. Violations are REJECTED, never clamped. */
export const SHOCK_BOUNDS = {
  /** ±2000 bps = ±20 percentage points: wider than any plausible Ghana-market assumption (secondary yields sit ~15–35%) yet small enough to keep every supported bond in a well-behaved numerical range. */
  YIELD_BPS: { min: -2000, max: 2000 },
  /** An equity price cannot fall below zero, so −100% is the hard floor (allowed: price 0). The +1000% ceiling is a sanity bound for UI input, not a view. */
  PRICE_PCT: { min: -100, max: 1000 },
} as const satisfies Record<ShockType, { min: number; max: number }>;

export const SHOCK_UNIT_LABEL: Record<ShockType, string> = { YIELD_BPS: "bps", PRICE_PCT: "%" };

export type ShockSelector =
  | { kind: "ASSET_CLASS"; assetClass: ExposureAssetClass }
  /** `issuerKey` is the M8.2 issuer identity: "company:<id>" or "name:<normalised name>". The shock TYPE decides whether it reaches the issuer's bonds (YIELD_BPS) or equity (PRICE_PCT). */
  | { kind: "ISSUER"; issuerKey: string }
  | { kind: "SECURITY"; instrument: SecurityInstrument; instrumentId: string };

export type SelectorKind = ShockSelector["kind"];

export interface ScenarioShockRule {
  id: string;
  selector: ShockSelector;
  shockType: ShockType;
  /** bps for YIELD_BPS, percent for PRICE_PCT. */
  value: number;
  /** Human label of the target for display/explanations (e.g. "Government bonds", "Kasapreko"). */
  targetLabel: string;
}

/** A position as the scenario engine consumes it: the trusted M8.1 valuation plus the identities needed to match rules. */
export interface ScenarioPosition {
  positionId: string;
  label: string;
  assetClass: ExposureAssetClass;
  issuer: IssuerRef;
  /** fixedIncomeSecurityId for a bond, securityId for an equity. */
  instrumentId: string;
  /** The M8.1 reference valuation — consumed, never recomputed. */
  valuation: import("../portfolio").PositionValuation;
  /** Bond only: the M7 terms the reference valuation was priced from. */
  terms: import("../fixed-income").BondTerms | null;
}

export type ScenarioInput = {
  /** The ONE valuation date — the one the M8.1 reference valuations were built at. */
  valuationDate: Date;
  positions: ScenarioPosition[];
  rules: ScenarioShockRule[];
};

export type PrecedenceLevel = "SECURITY" | "ISSUER" | "ASSET_CLASS";
export const PRECEDENCE_ORDER: PrecedenceLevel[] = ["SECURITY", "ISSUER", "ASSET_CLASS"];

export interface ShockResolution {
  /** Every rule that reaches this position (any precedence), highest precedence first. */
  matchedRules: ScenarioShockRule[];
  /** The single rule that applies; null when no rule reaches the position. Rules replace, never stack. */
  winner: ScenarioShockRule | null;
  precedence: PrecedenceLevel | null;
  /** Deterministic one-line reason. */
  reason: string;
}

export type ScenarioUnavailableCode =
  | "UNVALUED_REFERENCE" // M8.1 produced no reference value — no baseline, no scenario
  | "INVALID_YIELD_DOMAIN" // scenario yield makes the pricing function undefined / non-positive
  | "PRICING_FAILED" // M7 refused to price the bond / the bill formula was undefined
  | "MISSING_TERMS";

export interface BondScenarioDetail {
  assetClass: "BOND";
  nominalGhs: number;
  faceValue: number;
  referenceYieldPct: number;
  /** Signed bps actually applied (0 when unchanged). */
  appliedShockBps: number;
  scenarioYieldPct: number;
  referenceDirtyPrice: number;
  scenarioDirtyPrice: number;
  /** Accrued interest at the valuation date — identical for reference and scenario (yield-independent). */
  accruedInterest: number;
  referenceCleanPrice: number;
  scenarioCleanPrice: number;
  /** M7 DV01 scaled to this holding (GHS per +1bp, positive magnitude) at the reference yield; null if M7 could not compute it. */
  dv01Ghs: number | null;
  /** FIRST-ORDER explanatory estimate −DV01 × shockBps. NOT the scenario result. */
  firstOrderImpactGhs: number | null;
  /** exact impact − first-order estimate (what convexity and rounding account for). */
  firstOrderErrorGhs: number | null;
}

/**
 * Treasury-bill scenario: the shock moves the bill REFERENCE RATE (simple
 * Act/365) by `appliedShockBps`; the bill is revalued with the bill formula,
 * never the coupon-bond / ZERO_COUPON compounding routine.
 */
export interface BillScenarioDetail {
  assetClass: "TREASURY_BILL";
  faceValueGhs: number;
  daysToMaturity: number;
  referenceRatePct: number;
  appliedShockBps: number;
  scenarioRatePct: number;
  referencePricePer100: number;
  scenarioPricePer100: number;
  /** GHS per +1bp at the reference rate (positive magnitude). */
  dv01Ghs: number;
  /** FIRST-ORDER estimate −DV01 × shockBps. NOT the scenario result. */
  firstOrderImpactGhs: number;
  firstOrderErrorGhs: number;
  convention: string;
  formula: string;
}

export interface EquityScenarioDetail {
  assetClass: "EQUITY";
  shares: number;
  referencePriceGhs: number;
  appliedShockPct: number;
  scenarioPriceGhs: number;
}

export interface ScenarioPositionCommon {
  positionId: string;
  label: string;
  assetClass: ExposureAssetClass;
  issuer: IssuerRef;
  resolution: ShockResolution;
}

export interface ParticipatingPositionResult extends ScenarioPositionCommon {
  status: "PARTICIPATING";
  /** SHOCKED = a rule applied; UNCHANGED = no rule reached it, so scenario value = reference value (not "unavailable"). */
  outcome: "SHOCKED" | "UNCHANGED";
  /**
   * What kind of STARTING value this position was carried at (M9.0.1). A scenario shock moves a holding from its
   * starting value; if that start is an analyst assumption the whole result for this position depends on it.
   */
  basis: ValuationBasis;
  /** The starting assumption behind an ANALYST_ASSUMPTION position; null otherwise. */
  startingAssumption: AppliedAssumption | null;
  /** When an assumption overrides a Korbly-supported start, what Korbly itself supports. */
  korblyBasis: KorblyBasisSummary | null;
  recency: ValuationRecency;
  inputDate: string;
  inputAgeDays: number;
  referenceValueGhs: number;
  scenarioValueGhs: number;
  impactGhs: number;
  /** Position scenario return: impact ÷ THIS position's reference value × 100. Null if its reference value is 0. */
  impactPct: number | null;
  /** Contribution to the portfolio: impact ÷ portfolio scenario reference basis × 100 (percentage points of the basis). Null if the basis is 0. */
  contributionPct: number | null;
  detail: BondScenarioDetail | EquityScenarioDetail | BillScenarioDetail;
  warnings: string[];
}

export interface UnavailablePositionResult extends ScenarioPositionCommon {
  status: "UNAVAILABLE";
  code: ScenarioUnavailableCode;
  /** For UNVALUED_REFERENCE, the upstream M8.1 code. */
  upstreamCode: UnvaluedCode | null;
  reason: string;
}

export type ScenarioPositionResult = ParticipatingPositionResult | UnavailablePositionResult;

export interface ScenarioClassRow {
  assetClass: ExposureAssetClass;
  participatingCount: number;
  shockedCount: number;
  referenceValueGhs: number;
  scenarioValueGhs: number;
  impactGhs: number;
  /** Class return: class impact ÷ class reference value × 100; null when the class has no value. */
  impactPct: number | null;
  /** Class impact ÷ PORTFOLIO reference basis × 100. */
  contributionPct: number | null;
}

export interface StaleBasis {
  count: number;
  referenceValueGhs: number;
  scenarioValueGhs: number;
  impactGhs: number;
}

/** One valuation basis within the starting value — exact in pesewas; the three bases add to the totals. */
export interface BasisBasisRow {
  count: number;
  startingValueGhs: number;
  scenarioValueGhs: number;
  impactGhs: number;
  /** Share of the starting value (0–100); null when there is no starting value. */
  startingPct: number | null;
}

export interface ScenarioPortfolioResult {
  valuationDate: string;
  positionCount: number;
  /** Positions M8.1 could value. */
  valuedCount: number;
  /** Positions with a defensible scenario value (valued AND repriced, whether or not shocked). */
  participatingCount: number;
  /** Positions with no M8.1 reference value. */
  unvaluedCount: number;
  /** Valued positions whose repricing failed under the assumption. */
  scenarioErrorCount: number;
  shockedPositionCount: number;
  unchangedPositionCount: number;
  /** M8.1's valued reference value (all valued positions, incl. any that errored under the scenario). */
  m81ValuedReferenceValueGhs: number | null;
  /** Σ reference value of PARTICIPATING positions; null when none. Equals m81ValuedReferenceValueGhs when no position errored. */
  referenceBasisGhs: number | null;
  /** "Scenario value of valued positions". */
  scenarioValueGhs: number | null;
  impactGhs: number | null;
  impactPct: number | null;
  /**
   * The starting value split by VALUATION BASIS (reference / indicative / analyst assumption). The scenario shock is applied
   * on top of this start, so a scenario result must be read together with how much of the start was assumed.
   */
  byBasis: { reference: BasisBasisRow; indicative: BasisBasisRow; assumption: BasisBasisRow; supported: BasisBasisRow };
  /** Share of the starting value that rests on analyst assumptions (0–100); null when no basis. */
  assumptionBasisPct: number | null;
  /**
   * Stable fingerprint of every starting assumption in force (position, kind, value, override). Two results may be compared
   * as "only the shocks differ" only if their fingerprints match.
   */
  startingBasisFingerprint: string;
  recentBasis: StaleBasis;
  staleBasis: StaleBasis;
  /** Share of the reference basis resting on stale inputs (0–100); null when no basis. */
  staleBasisPct: number | null;
  byAssetClass: ScenarioClassRow[];
  /** Most negative first; zero impacts excluded. */
  largestNegative: ParticipatingPositionResult[];
  /** Most positive first; zero impacts excluded. */
  largestPositive: ParticipatingPositionResult[];
  /** Σ position impacts and Σ class impacts both equal `impactGhs` exactly (cents). */
  reconciles: boolean;
}

export type ScenarioValidationErrorCode = "BAD_VALUE" | "OUT_OF_BOUNDS" | "INCOMPATIBLE" | "DUPLICATE";

export interface ScenarioValidationError {
  ruleId: string;
  code: ScenarioValidationErrorCode;
  message: string;
}

export type ScenarioResult =
  | { ok: false; errors: ScenarioValidationError[] }
  | {
      ok: true;
      valuationDate: string;
      rules: ScenarioShockRule[];
      positions: ScenarioPositionResult[];
      portfolio: ScenarioPortfolioResult;
      explanations: string[];
    };
