// ---------------------------------------------------------------------------
// Portfolio exposure analytics (M8.2). Pure — no I/O, no Prisma, no React.
//
//   M8.1 position valuations → M8.1 portfolio summary → THIS MODULE → UI
//
// Nothing here prices, resolves a yield or totals a portfolio independently:
// every value-based figure is built from the `ValuedPosition.referenceValueGhs`
// M8.1 already produced, and the denominator of every percentage is the
// M8.1 `summary.referenceValueGhs` (the VALUED portion only).
//
// TWO ANALYTIC FAMILIES, deliberately kept apart (never one "eligible" flag):
//
//   MARKET / REFERENCE-VALUE analytics  — asset allocation, issuer
//     concentration, DV01, modified duration. Need a VALUED position, i.e. a
//     trustworthy market input AND trustworthy terms.
//
//   CONTRACTUAL analytics — maturity ladder, annual coupon, upcoming
//     maturities. Depend only on the security's TERMS (maturity / coupon) and
//     the nominal held. A bond with no usable market observation (or a stale
//     one) still contributes, because a stale price does not make a coupon
//     term stale. Conversely a bond whose maturity is in conflict is excluded
//     from the ladder even if its market data is perfect; one whose coupon is
//     in conflict is excluded from coupon aggregation. The quality dimension
//     checked is the one the metric actually depends on.
//
// Money arithmetic is done in integer pesewas (cents) so every invariant
// (Σ parts == total) holds exactly, not approximately.
//
// DV01 CONVENTION (inherited from M7 computeDuration): DV01 is the price
// change per 100 face for a 1bp PARALLEL RISE in yield, reported as a POSITIVE
// magnitude ((P(y−1bp) − P(y+1bp)) / 2). Nothing is flipped here. Position DV01
// = M7 dv01 × nominal / faceValue, in GHS per bp. It is a first-order
// sensitivity, not a scenario result and not a P/L forecast.
//
// MATURITY BUCKETS are calendar-anniversary based (M7 shiftMonths, which
// clamps 29 Feb): with V the valuation date and M the maturity date,
//   <1y   : M <  V + 12 months
//   1–3y  : V + 12m ≤ M < V + 36m
//   3–5y  : V + 36m ≤ M < V + 60m
//   5y+   : M ≥ V + 60m
// A bond maturing exactly on the anniversary falls in the LONGER bucket.
// Matured bonds (M ≤ V) are never bucketed.
// ---------------------------------------------------------------------------

import { computeDuration, daysBetween, paymentsPerYear, shiftMonths, type BondTerms } from "../fixed-income";
import type { PositionValuation, ValuedPosition } from "./valuation";

export type ExposureAssetClass = "GOVERNMENT_BOND" | "CORPORATE_BOND" | "EQUITY";

export const EXPOSURE_ASSET_CLASS_ORDER: ExposureAssetClass[] = ["GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"];

export const EXPOSURE_ASSET_CLASS_LABEL: Record<ExposureAssetClass, string> = {
  GOVERNMENT_BOND: "Government bonds",
  CORPORATE_BOND: "Corporate bonds",
  EQUITY: "Equities",
};

/** The economic issuer a position is exposed to. `key` is the identity used for aggregation. */
export interface IssuerRef {
  key: string;
  name: string;
}

/** Contractual facts of a held bond — everything the CONTRACTUAL analytics need, independent of market data. */
export interface BondContractFacts {
  nominalGhs: number;
  currency: string;
  status: "ACTIVE" | "MATURED" | "CALLED" | "DEFAULTED";
  terms: BondTerms;
  /** The source and the Securities Master disagree on the MATURITY date (M7 MATURITY_CONFLICT). */
  maturityConflict: boolean;
  /** The source and the Securities Master disagree on the COUPON (M7 COUPON_CONFLICT). */
  couponConflict: boolean;
}

export interface ExposurePosition {
  positionId: string;
  label: string;
  assetClass: ExposureAssetClass;
  issuer: IssuerRef;
  /** The trusted M8.1 valuation of this position. */
  valuation: PositionValuation;
  /** Present for bonds only. */
  bond: BondContractFacts | null;
}

const toCents = (ghs: number) => Math.round(ghs * 100);
const fromCents = (cents: number) => cents / 100;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Deterministic issuer identity: the Company entity when the database links one (so a company's bond and equity aggregate), else the normalised issuer name (e.g. Government of Ghana). */
export function resolveIssuerRef(input: { companyId: string | null; issuerName: string | null }): IssuerRef {
  const name = (input.issuerName ?? "").trim().replace(/\s+/g, " ");
  if (input.companyId) return { key: `company:${input.companyId}`, name: name || "Unknown issuer" };
  if (!name) return { key: "unknown", name: "Unknown issuer" };
  return { key: `name:${name.toLowerCase()}`, name };
}

// ---------------------------------------------------------------------------
// Contractual eligibility — per metric, independent of market valuation
// ---------------------------------------------------------------------------

export type ContractualExclusionCode = "NOT_GHS" | "MATURED" | "NOT_OUTSTANDING" | "MATURITY_CONFLICT" | "COUPON_CONFLICT" | "FLOATING_RATE" | "TERMS_INCOMPLETE";

export type ContractualCheck = { eligible: true } | { eligible: false; code: ContractualExclusionCode; reason: string };

function commonContractualCheck(bond: BondContractFacts, valuationDate: Date): ContractualCheck {
  if (bond.currency !== "GHS") return { eligible: false, code: "NOT_GHS", reason: `Not a GHS instrument (${bond.currency}).` };
  if (bond.terms.maturityDate.getTime() <= valuationDate.getTime()) return { eligible: false, code: "MATURED", reason: "Matured — no remaining contractual exposure." };
  if (bond.status !== "ACTIVE") return { eligible: false, code: "NOT_OUTSTANDING", reason: `Recorded as ${bond.status.toLowerCase()} in the Securities Master — contractual terms cannot be assumed.` };
  return { eligible: true };
}

/** Maturity ladder / upcoming maturities: needs a trusted maturity date, an outstanding GHS bond. Coupon terms and market data are irrelevant. */
export function checkMaturityEligibility(bond: BondContractFacts, valuationDate: Date): ContractualCheck {
  const common = commonContractualCheck(bond, valuationDate);
  if (!common.eligible) return common;
  if (bond.maturityConflict) return { eligible: false, code: "MATURITY_CONFLICT", reason: "The source and the Securities Master disagree on the maturity date." };
  return { eligible: true };
}

/**
 * Annual coupon: needs a trusted FIXED coupon rate and frequency on an
 * outstanding GHS bond. Zero-coupon bonds pay no coupon — computeCoupon counts
 * them in `zeroCouponCount` rather than treating them as an omission.
 */
export function checkCouponEligibility(bond: BondContractFacts, valuationDate: Date): ContractualCheck {
  const common = commonContractualCheck(bond, valuationDate);
  if (!common.eligible) return common;
  if (bond.couponConflict) return { eligible: false, code: "COUPON_CONFLICT", reason: "The source and the Securities Master disagree on the coupon." };
  if (bond.terms.couponType === "FLOATING") return { eligible: false, code: "FLOATING_RATE", reason: "Floating-rate coupons are not fixed contractual amounts." };
  if (bond.terms.couponType === "FIXED" && (bond.terms.couponRatePct === null || bond.terms.couponFrequency === null)) {
    return { eligible: false, code: "TERMS_INCOMPLETE", reason: "The Securities Master is missing this bond's coupon rate or frequency." };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AllocationRow {
  assetClass: ExposureAssetClass;
  label: string;
  referenceValueGhs: number;
  /** Share of the VALUED reference value, 0–100. */
  pct: number;
  valuedCount: number;
  /** Positions in this class that cannot be valued — shown, never given a share. */
  unvaluedCount: number;
  staleValueGhs: number;
}

export interface UnvaluedSummary {
  count: number;
  byClass: { assetClass: ExposureAssetClass; label: string; count: number }[];
}

export interface AssetAllocation {
  /** Always the valued reference value — the explicit denominator. */
  basis: "VALUED_REFERENCE_VALUE";
  denominatorGhs: number | null;
  rows: AllocationRow[];
  unvalued: UnvaluedSummary;
}

export interface IssuerRow {
  issuer: IssuerRef;
  referenceValueGhs: number;
  pct: number;
  assetClasses: ExposureAssetClass[];
  valuedCount: number;
  /** Further positions in this issuer that are not valued (no value attributed to them). */
  unvaluedCount: number;
  staleValueGhs: number;
}

export interface IssuerConcentration {
  denominatorGhs: number | null;
  rows: IssuerRow[];
  /** Issuers whose held positions are ALL unvalued — they have no value-based share at all. */
  unvaluedOnly: { issuer: IssuerRef; unvaluedCount: number }[];
}

export type MaturityBucketKey = "LT_1Y" | "Y1_3" | "Y3_5" | "GT_5Y";

export const MATURITY_BUCKETS: { key: MaturityBucketKey; label: string; fromMonths: number; toMonths: number | null }[] = [
  { key: "LT_1Y", label: "< 1 year", fromMonths: 0, toMonths: 12 },
  { key: "Y1_3", label: "1–3 years", fromMonths: 12, toMonths: 36 },
  { key: "Y3_5", label: "3–5 years", fromMonths: 36, toMonths: 60 },
  { key: "GT_5Y", label: "5+ years", fromMonths: 60, toMonths: null },
];

/** The bucket a maturity date falls in at `valuationDate`, or null when it has already matured. */
export function maturityBucketOf(maturityDate: Date, valuationDate: Date): MaturityBucketKey | null {
  if (maturityDate.getTime() <= valuationDate.getTime()) return null;
  for (const b of MATURITY_BUCKETS) {
    if (b.toMonths === null || maturityDate.getTime() < shiftMonths(valuationDate, b.toMonths).getTime()) return b.key;
  }
  return "GT_5Y";
}

export interface MaturityBucketRow {
  key: MaturityBucketKey;
  label: string;
  /** PRIMARY measure: contractual principal maturing in the bucket. */
  nominalGhs: number;
  /** Share of eligible fixed-income nominal, 0–100 (null when there is none). */
  nominalPct: number | null;
  positionCount: number;
  /** SECONDARY: reference value of the bucket's VALUED bonds only (a different, market-based measure). */
  valuedReferenceValueGhs: number;
  valuedCount: number;
  /** Nominal in the bucket that has no reference value — still counted in `nominalGhs`. */
  unvaluedNominalGhs: number;
}

export interface ExcludedBond {
  positionId: string;
  label: string;
  code: ContractualExclusionCode;
  reason: string;
}

export interface MaturityLadder {
  buckets: MaturityBucketRow[];
  /** Σ nominal of every bond that passed the maturity eligibility check (== Σ bucket nominal). */
  eligibleNominalGhs: number;
  eligibleCount: number;
  bondPositionCount: number;
  excluded: ExcludedBond[];
}

export interface CouponPositionRow {
  positionId: string;
  label: string;
  assetClass: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  nominalGhs: number;
  couponRatePct: number;
  paymentsPerYear: number;
  annualCouponGhs: number;
  couponPerPaymentGhs: number;
}

export interface CouponIncome {
  /** Σ per-position annual coupon. CONTRACTUAL — not return, yield, forecast or cash received this year. */
  annualCouponGhs: number | null;
  governmentGhs: number;
  corporateGhs: number;
  includedCount: number;
  rows: CouponPositionRow[];
  /** Zero-coupon bonds: they pay no coupon (not an omission). */
  zeroCouponCount: number;
  excluded: ExcludedBond[];
  bondPositionCount: number;
}

export interface Dv01Row {
  positionId: string;
  label: string;
  assetClass: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  issuerName: string;
  nominalGhs: number;
  referenceValueGhs: number;
  modifiedDurationYears: number;
  /** GHS per 1bp, positive magnitude (M7 convention), rounded to 0.01. */
  dv01Ghs: number;
  /** Share of total bond DV01, 0–100. */
  sharePct: number;
  recency: ValuedPosition["recency"];
}

export interface RateSensitivity {
  /** Σ position DV01 (GHS/bp); null when no bond could contribute. */
  bondDv01Ghs: number | null;
  governmentDv01Ghs: number;
  corporateDv01Ghs: number;
  /** Σ(refValue × MD) / Σ refValue over the contributing bonds; null when none. */
  weightedModifiedDurationYears: number | null;
  /** Σ reference value of the contributing bonds — the exact denominator of the weighted duration. */
  durationBasisGhs: number;
  /** DV01 contributed by positions resting on STALE market inputs (they keep their stale status). */
  staleDv01Ghs: number;
  staleCount: number;
  contributors: Dv01Row[];
  coverage: {
    bondPositionCount: number;
    contributingCount: number;
    /** Valued bonds' reference value, and the part of it that has a DV01. */
    valuedBondReferenceValueGhs: number;
    coveredReferenceValueGhs: number;
    /** Bond positions with no DV01, and why. */
    excluded: { positionId: string; label: string; reason: string }[];
  };
}

export interface UpcomingMaturity {
  positionId: string;
  label: string;
  issuerName: string;
  maturityDate: string;
  daysRemaining: number;
  nominalGhs: number;
  /** null when the position has no reference value (never 0). */
  referenceValueGhs: number | null;
  unvaluedReason: string | null;
  withinNext12Months: boolean;
}

export interface PortfolioExposures {
  valuationDate: string;
  positionCount: number;
  valuedCount: number;
  unvaluedCount: number;
  allocation: AssetAllocation;
  issuers: IssuerConcentration;
  maturity: MaturityLadder;
  coupon: CouponIncome;
  rates: RateSensitivity;
  upcoming: UpcomingMaturity[];
  callouts: string[];
}

/** How many upcoming maturities the summary list carries. */
export const UPCOMING_MATURITIES_LIMIT = 5;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

type BondPosition = ExposurePosition & { bond: BondContractFacts; assetClass: "GOVERNMENT_BOND" | "CORPORATE_BOND" };
const isBond = (p: ExposurePosition): p is BondPosition => p.bond !== null && p.assetClass !== "EQUITY";
const isValued = (p: ExposurePosition): p is ExposurePosition & { valuation: ValuedPosition } => p.valuation.status === "VALUED";

const pct = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

export function computeExposures(positions: ExposurePosition[], summary: { referenceValueGhs: number | null; valuationDate: string }, valuationDate: Date): PortfolioExposures {
  const valued = positions.filter(isValued);
  const denomCents = summary.referenceValueGhs === null ? null : toCents(summary.referenceValueGhs);

  const allocation = computeAllocation(positions, valued, denomCents);
  const issuers = computeIssuers(positions, valued, denomCents);
  const bonds = positions.filter(isBond);
  const maturity = computeMaturityLadder(bonds, valuationDate);
  const coupon = computeCoupon(bonds, valuationDate);
  const rates = computeRates(bonds, valuationDate);
  const upcoming = computeUpcoming(bonds, valuationDate);

  const exposures: PortfolioExposures = {
    valuationDate: summary.valuationDate,
    positionCount: positions.length,
    valuedCount: valued.length,
    unvaluedCount: positions.length - valued.length,
    allocation,
    issuers,
    maturity,
    coupon,
    rates,
    upcoming,
    callouts: [],
  };
  exposures.callouts = buildCallouts(exposures);
  return exposures;
}

function computeAllocation(positions: ExposurePosition[], valued: (ExposurePosition & { valuation: ValuedPosition })[], denomCents: number | null): AssetAllocation {
  const rows: AllocationRow[] = [];
  for (const assetClass of EXPOSURE_ASSET_CLASS_ORDER) {
    const inClass = valued.filter((p) => p.assetClass === assetClass);
    if (inClass.length === 0) continue;
    const cents = inClass.reduce((s, p) => s + toCents(p.valuation.referenceValueGhs), 0);
    const staleCents = inClass.filter((p) => p.valuation.recency === "STALE").reduce((s, p) => s + toCents(p.valuation.referenceValueGhs), 0);
    rows.push({
      assetClass,
      label: EXPOSURE_ASSET_CLASS_LABEL[assetClass],
      referenceValueGhs: fromCents(cents),
      pct: denomCents ? pct(cents, denomCents) : 0,
      valuedCount: inClass.length,
      unvaluedCount: positions.filter((p) => p.assetClass === assetClass && p.valuation.status === "UNVALUED").length,
      staleValueGhs: fromCents(staleCents),
    });
  }
  const unvalued = positions.filter((p) => p.valuation.status === "UNVALUED");
  return {
    basis: "VALUED_REFERENCE_VALUE",
    denominatorGhs: denomCents === null ? null : fromCents(denomCents),
    rows,
    unvalued: {
      count: unvalued.length,
      byClass: EXPOSURE_ASSET_CLASS_ORDER.map((assetClass) => ({ assetClass, label: EXPOSURE_ASSET_CLASS_LABEL[assetClass], count: unvalued.filter((p) => p.assetClass === assetClass).length })).filter((c) => c.count > 0),
    },
  };
}

function computeIssuers(positions: ExposurePosition[], valued: (ExposurePosition & { valuation: ValuedPosition })[], denomCents: number | null): IssuerConcentration {
  const byIssuer = new Map<string, { issuer: IssuerRef; cents: number; staleCents: number; classes: Set<ExposureAssetClass>; valuedCount: number; unvaluedCount: number }>();
  const slot = (issuer: IssuerRef) => {
    let s = byIssuer.get(issuer.key);
    if (!s) byIssuer.set(issuer.key, (s = { issuer, cents: 0, staleCents: 0, classes: new Set(), valuedCount: 0, unvaluedCount: 0 }));
    // Prefer a bond's legal issuer name over an equity ticker-style company name when the same Company is reached both ways (deterministic: longest name).
    if (issuer.name.length > s.issuer.name.length) s.issuer = issuer;
    return s;
  };
  for (const p of valued) {
    const s = slot(p.issuer);
    const c = toCents(p.valuation.referenceValueGhs);
    s.cents += c;
    if (p.valuation.recency === "STALE") s.staleCents += c;
    s.classes.add(p.assetClass);
    s.valuedCount += 1;
  }
  for (const p of positions) {
    if (p.valuation.status === "UNVALUED") slot(p.issuer).unvaluedCount += 1;
  }
  const all = [...byIssuer.values()];
  const rows: IssuerRow[] = all
    .filter((s) => s.valuedCount > 0)
    .map((s) => ({
      issuer: s.issuer,
      referenceValueGhs: fromCents(s.cents),
      pct: denomCents ? pct(s.cents, denomCents) : 0,
      assetClasses: EXPOSURE_ASSET_CLASS_ORDER.filter((c) => s.classes.has(c)),
      valuedCount: s.valuedCount,
      unvaluedCount: s.unvaluedCount,
      staleValueGhs: fromCents(s.staleCents),
    }))
    .sort((a, b) => b.referenceValueGhs - a.referenceValueGhs || a.issuer.name.localeCompare(b.issuer.name));
  const unvaluedOnly = all
    .filter((s) => s.valuedCount === 0)
    .map((s) => ({ issuer: s.issuer, unvaluedCount: s.unvaluedCount }))
    .sort((a, b) => a.issuer.name.localeCompare(b.issuer.name));
  return { denominatorGhs: denomCents === null ? null : fromCents(denomCents), rows, unvaluedOnly };
}

function computeMaturityLadder(bonds: BondPosition[], valuationDate: Date): MaturityLadder {
  const acc = new Map(MATURITY_BUCKETS.map((b) => [b.key, { nominalCents: 0, count: 0, valuedCents: 0, valuedCount: 0, unvaluedNominalCents: 0 }]));
  const excluded: ExcludedBond[] = [];
  let eligibleCents = 0;
  let eligibleCount = 0;

  for (const p of bonds) {
    const check = checkMaturityEligibility(p.bond, valuationDate);
    if (!check.eligible) {
      excluded.push({ positionId: p.positionId, label: p.label, code: check.code, reason: check.reason });
      continue;
    }
    const key = maturityBucketOf(p.bond.terms.maturityDate, valuationDate);
    if (key === null) continue; // unreachable: matured bonds are rejected by the check
    const a = acc.get(key)!;
    const nominal = toCents(p.bond.nominalGhs);
    a.nominalCents += nominal;
    a.count += 1;
    eligibleCents += nominal;
    eligibleCount += 1;
    if (p.valuation.status === "VALUED") {
      a.valuedCents += toCents(p.valuation.referenceValueGhs);
      a.valuedCount += 1;
    } else {
      a.unvaluedNominalCents += nominal;
    }
  }

  return {
    buckets: MATURITY_BUCKETS.map((b) => {
      const a = acc.get(b.key)!;
      return {
        key: b.key,
        label: b.label,
        nominalGhs: fromCents(a.nominalCents),
        nominalPct: eligibleCents > 0 ? pct(a.nominalCents, eligibleCents) : null,
        positionCount: a.count,
        valuedReferenceValueGhs: fromCents(a.valuedCents),
        valuedCount: a.valuedCount,
        unvaluedNominalGhs: fromCents(a.unvaluedNominalCents),
      };
    }),
    eligibleNominalGhs: fromCents(eligibleCents),
    eligibleCount,
    bondPositionCount: bonds.length,
    excluded,
  };
}

function computeCoupon(bonds: BondPosition[], valuationDate: Date): CouponIncome {
  const rows: CouponPositionRow[] = [];
  const excluded: ExcludedBond[] = [];
  let zeroCouponCount = 0;
  let total = 0;
  let gov = 0;
  let corp = 0;

  for (const p of bonds) {
    if (p.bond.terms.couponType === "ZERO_COUPON" && commonContractualCheck(p.bond, valuationDate).eligible) {
      zeroCouponCount += 1;
      continue;
    }
    const check = checkCouponEligibility(p.bond, valuationDate);
    if (!check.eligible) {
      excluded.push({ positionId: p.positionId, label: p.label, code: check.code, reason: check.reason });
      continue;
    }
    const rate = p.bond.terms.couponRatePct as number;
    const ppy = paymentsPerYear(p.bond.terms.couponFrequency!);
    const annualCents = toCents((p.bond.nominalGhs * rate) / 100);
    rows.push({
      positionId: p.positionId,
      label: p.label,
      assetClass: p.assetClass,
      nominalGhs: p.bond.nominalGhs,
      couponRatePct: rate,
      paymentsPerYear: ppy,
      annualCouponGhs: fromCents(annualCents),
      couponPerPaymentGhs: Math.round(annualCents / ppy) / 100,
    });
    total += annualCents;
    if (p.assetClass === "GOVERNMENT_BOND") gov += annualCents;
    else corp += annualCents;
  }
  rows.sort((a, b) => b.annualCouponGhs - a.annualCouponGhs || a.label.localeCompare(b.label));
  return {
    annualCouponGhs: rows.length > 0 ? fromCents(total) : null,
    governmentGhs: fromCents(gov),
    corporateGhs: fromCents(corp),
    includedCount: rows.length,
    rows,
    zeroCouponCount,
    excluded,
    bondPositionCount: bonds.length,
  };
}

function computeRates(bonds: BondPosition[], valuationDate: Date): RateSensitivity {
  const rows: Omit<Dv01Row, "sharePct">[] = [];
  const excluded: { positionId: string; label: string; reason: string }[] = [];
  let durationNumerator = 0; // Σ refValue(GHS) × MD
  let basisCents = 0;
  let valuedBondCents = 0;

  for (const p of bonds) {
    if (p.valuation.status !== "VALUED") {
      excluded.push({ positionId: p.positionId, label: p.label, reason: `Not valued — ${p.valuation.reason}` });
      continue;
    }
    const v = p.valuation;
    valuedBondCents += toCents(v.referenceValueGhs);
    if (v.detail.assetClass !== "BOND") continue;
    // M7's engine, at the SAME observed yield and valuation date M8.1 priced the position with.
    const d = computeDuration(p.bond.terms, valuationDate, v.detail.observedYtmPct);
    if (!d.ok) {
      excluded.push({ positionId: p.positionId, label: p.label, reason: `Rate sensitivity could not be calculated — ${d.message}` });
      continue;
    }
    rows.push({
      positionId: p.positionId,
      label: p.label,
      assetClass: p.assetClass,
      issuerName: p.issuer.name,
      nominalGhs: p.bond.nominalGhs,
      referenceValueGhs: v.referenceValueGhs,
      modifiedDurationYears: d.modifiedDurationYears,
      dv01Ghs: fromCents(toCents((d.dv01 * p.bond.nominalGhs) / p.bond.terms.faceValue)),
      recency: v.recency,
    });
    basisCents += toCents(v.referenceValueGhs);
    durationNumerator += v.referenceValueGhs * d.modifiedDurationYears;
  }

  const sumCents = (rs: { dv01Ghs: number }[]) => rs.reduce((s, r) => s + toCents(r.dv01Ghs), 0);
  const totalCents = sumCents(rows);
  const contributors: Dv01Row[] = rows
    .map((r) => ({ ...r, sharePct: pct(toCents(r.dv01Ghs), totalCents) }))
    .sort((a, b) => b.dv01Ghs - a.dv01Ghs || a.label.localeCompare(b.label));
  const stale = rows.filter((r) => r.recency === "STALE");

  return {
    bondDv01Ghs: rows.length > 0 ? fromCents(totalCents) : null,
    governmentDv01Ghs: fromCents(sumCents(rows.filter((r) => r.assetClass === "GOVERNMENT_BOND"))),
    corporateDv01Ghs: fromCents(sumCents(rows.filter((r) => r.assetClass === "CORPORATE_BOND"))),
    weightedModifiedDurationYears: basisCents > 0 ? durationNumerator / fromCents(basisCents) : null,
    durationBasisGhs: fromCents(basisCents),
    staleDv01Ghs: fromCents(sumCents(stale)),
    staleCount: stale.length,
    contributors,
    coverage: {
      bondPositionCount: bonds.length,
      contributingCount: rows.length,
      valuedBondReferenceValueGhs: fromCents(valuedBondCents),
      coveredReferenceValueGhs: fromCents(basisCents),
      excluded,
    },
  };
}

function computeUpcoming(bonds: BondPosition[], valuationDate: Date): UpcomingMaturity[] {
  const horizon = shiftMonths(valuationDate, 12).getTime();
  return bonds
    .filter((p) => checkMaturityEligibility(p.bond, valuationDate).eligible)
    .sort((a, b) => a.bond.terms.maturityDate.getTime() - b.bond.terms.maturityDate.getTime() || a.label.localeCompare(b.label))
    .slice(0, UPCOMING_MATURITIES_LIMIT)
    .map((p) => ({
      positionId: p.positionId,
      label: p.label,
      issuerName: p.issuer.name,
      maturityDate: isoDay(p.bond.terms.maturityDate),
      daysRemaining: daysBetween(valuationDate, p.bond.terms.maturityDate),
      nominalGhs: p.bond.nominalGhs,
      referenceValueGhs: p.valuation.status === "VALUED" ? p.valuation.referenceValueGhs : null,
      unvaluedReason: p.valuation.status === "UNVALUED" ? p.valuation.reason : null,
      withinNext12Months: p.bond.terms.maturityDate.getTime() < horizon,
    }));
}

// ---------------------------------------------------------------------------
// Deterministic factual callouts — statements of fact about the numbers above,
// never advice, never a threshold ("too high"), never a rating.
// ---------------------------------------------------------------------------

const fmtPct = (n: number) => `${n.toFixed(n >= 10 || Number.isInteger(n) ? 0 : 1)}%`;

export function buildCallouts(e: PortfolioExposures): string[] {
  const out: string[] = [];
  const top = e.allocation.rows.length > 0 ? [...e.allocation.rows].sort((a, b) => b.pct - a.pct)[0] : null;
  if (top) out.push(`${top.label} are the largest asset class: ${fmtPct(top.pct)} of valued reference value.`);

  const issuer = e.issuers.rows[0];
  if (issuer) out.push(`${issuer.issuer.name} is the largest valued issuer exposure: ${fmtPct(issuer.pct)} of valued reference value.`);

  const longBucket = e.maturity.buckets.find((b) => b.key === "GT_5Y");
  if (longBucket && longBucket.nominalPct !== null && longBucket.nominalPct > 0 && e.maturity.eligibleNominalGhs > 0) out.push(`${fmtPct(longBucket.nominalPct)} of contractual bond nominal matures after five years.`);

  const c = e.rates.contributors[0];
  if (c && e.rates.contributors.length > 1) out.push(`${c.label} contributes ${fmtPct(c.sharePct)} of bond DV01.`);

  if (e.unvaluedCount > 0) out.push(`${e.unvaluedCount} ${e.unvaluedCount === 1 ? "position is" : "positions are"} excluded from value-based analytics because ${e.unvaluedCount === 1 ? "it" : "they"} cannot currently be valued.`);
  return out;
}
