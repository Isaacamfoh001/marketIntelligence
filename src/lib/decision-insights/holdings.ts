// ---------------------------------------------------------------------------
// Holdings, maturity profile and data-quality view models (M9.0). Pure.
// Reads M8.1 valuations and M8.2 exposures; recomputes nothing financial.
// Weights are the M8.1 reference value ÷ the M8.1 portfolio reference value.
// ---------------------------------------------------------------------------

import { daysBetween, formatIsoDate } from "../fixed-income";
import {
  ASSUMPTION_DISCLOSURE,
  assumptionAvailability,
  BILL_BASIS_LABEL,
  EXPOSURE_ASSET_CLASS_LABEL,
  EQUITY_RECENT_WINDOW_DAYS,
  checkBillMaturityEligibility,
  checkMaturityEligibility,
  maturityBucketOf,
  type ExposurePosition,
  type PortfolioExposures,
  type PortfolioValuationSummary,
} from "../portfolio";
import { ghsWhole, plural } from "../scenario-studio/format";
import { NEAR_MATURITY_DAYS, PLAIN_TERMS, type HoldingQuality, type HoldingRate, type HoldingView, type MaturityProfile, type MaturityProfileBucket, type QualityView } from "./types";

export interface WorkspaceInput {
  portfolioId: string;
  valuationDate: string;
  summary: PortfolioValuationSummary;
  exposures: PortfolioExposures;
  positions: ExposurePosition[];
}

export const inspectHref = (portfolioId: string, positionId: string) => `/portfolios/${portfolioId}?view=holdings&position=${positionId}#inspect`;

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const num = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 0 });

function sizeText(p: ExposurePosition): string {
  if (p.bond) return `${ghsWhole(p.bond.nominalGhs)} nominal`;
  if (p.bill) return `${ghsWhole(p.bill.faceValueGhs)} face`;
  const v = p.valuation;
  return v.status === "VALUED" && v.detail.assetClass === "EQUITY" ? `${num(v.detail.shares)} shares` : "—";
}

function qualityOf(p: ExposurePosition, valuationDate: string): HoldingQuality {
  const v = p.valuation;
  if (v.status !== "VALUED") return { recency: null, inputDate: null, ageDays: null, label: "Needs review", note: v.reason };
  // An assumption has no observation, so it has no recency: data quality and valuation basis stay separate questions.
  if (v.basis === "ANALYST_ASSUMPTION") return { recency: null, inputDate: null, ageDays: null, label: "Analyst assumption — not observed", note: `${ASSUMPTION_DISCLOSURE}${v.korblyBasis ? ` Korbly's own ${v.korblyBasis.basis === "REFERENCE" ? "Reference" : "indicative"} value is ${ghsWhole(v.korblyBasis.valueGhs)}.` : ""}` };
  const age = v.inputAgeDays;
  const recent = v.recency === "RECENT";
  const rec: "RECENT" | "STALE" = recent ? "RECENT" : "STALE";
  const d = v.detail;
  if (d.assetClass === "EQUITY") {
    const reportAge = daysBetween(day(d.latestReportDate), day(valuationDate));
    const reportCurrent = reportAge <= EQUITY_RECENT_WINDOW_DAYS;
    return {
      recency: rec,
      inputDate: v.inputDate,
      ageDays: age,
      label: recent ? `Recent trade (${age} ${plural(age, "day")} old)` : `Last traded ${age} days ago`,
      note: recent ? null : reportCurrent ? `The latest GSE report (${formatIsoDate(d.latestReportDate)}) is current, but ${p.label} itself has not traded recently.` : `The latest GSE report (${formatIsoDate(d.latestReportDate)}) is itself older than a week.`,
    };
  }
  if (d.assetClass === "TREASURY_BILL") {
    return { recency: rec, inputDate: v.inputDate, ageDays: age, label: recent ? `Recent auction curve (${age} ${plural(age, "day")} old)` : `Auction curve ${age} days old`, note: `${BILL_BASIS_LABEL}: ${PLAIN_TERMS.billValuation.help}` };
  }
  return { recency: rec, inputDate: v.inputDate, ageDays: age, label: recent ? `Recent yield observation (${age} ${plural(age, "day")} old)` : `Yield last observed ${age} days ago`, note: null };
}

/** One row per position — the shared basis of every holdings lens. Order: reference value descending, unvalued last, then label (stable). */
export function buildHoldings(input: WorkspaceInput): HoldingView[] {
  const valDate = day(input.valuationDate);
  const denom = input.summary.referenceValueGhs;
  const rateByPos = new Map<string, HoldingRate>();
  for (const c of input.exposures.rates.contributors) rateByPos.set(c.positionId, { kind: "BOND_YIELD", basis: c.basis, dv01Ghs: c.dv01Ghs, per1ppGhs: c.dv01Ghs * 100, modifiedDurationYears: c.modifiedDurationYears, sleeveSharePct: c.sharePct });
  for (const c of input.exposures.rates.treasuryBills.contributors) rateByPos.set(c.positionId, { kind: "BILL_RATE", basis: c.basis, dv01Ghs: c.dv01Ghs, per1ppGhs: c.dv01Ghs * 100, modifiedDurationYears: c.modifiedDurationYears, sleeveSharePct: c.sharePct });

  const rows = input.positions.map((p): HoldingView => {
    const v = p.valuation;
    const korbly = v.status === "VALUED" ? v.korblyBasis : null;
    let maturityDate: string | null = null;
    let daysToMaturity: number | null = null;
    if (p.bond && checkMaturityEligibility(p.bond, valDate).eligible) maturityDate = p.bond.terms.maturityDate.toISOString().slice(0, 10);
    if (p.bill && checkBillMaturityEligibility(p.bill, valDate).eligible) maturityDate = p.bill.maturityDate.toISOString().slice(0, 10);
    if (maturityDate) daysToMaturity = daysBetween(valDate, day(maturityDate));
    return {
      positionId: p.positionId,
      label: p.label,
      issuerName: p.issuer.name,
      assetClass: p.assetClass,
      assetClassLabel: EXPOSURE_ASSET_CLASS_LABEL[p.assetClass],
      status: v.status,
      basis: v.status === "VALUED" ? v.basis : "UNVALUED",
      referenceValueGhs: v.status === "VALUED" ? v.referenceValueGhs : null,
      weightPct: v.status === "VALUED" && denom ? (v.referenceValueGhs / denom) * 100 : null,
      assumptionSummary: v.status === "VALUED" && v.assumption ? v.assumption.summary : null,
      korblyValueGhs: korbly ? korbly.valueGhs : null,
      principalGhs: p.bond ? p.bond.nominalGhs : p.bill ? p.bill.faceValueGhs : null,
      canAssume: v.status === "UNVALUED" && assumptionAvailability(p.assetClass === "EQUITY" ? "EQUITY" : p.assetClass === "TREASURY_BILL" ? "TREASURY_BILL" : "BOND", v.code).assumable,
      assumptionNote: v.status === "VALUED" ? (v.ignoredAssumption ? `A stored assumption (${v.ignoredAssumption.summary}) is not used: Korbly now has its own supported value, which an assumption never silently replaces.` : null) : (v.assumptionProblem ? `The stored assumption (${v.assumptionProblem.summary}) could not be applied: ${v.assumptionProblem.reason}` : null),
      sizeText: sizeText(p),
      maturityDate,
      daysToMaturity,
      rate: rateByPos.get(p.positionId) ?? null,
      quality: qualityOf(p, input.valuationDate),
      unvaluedReason: v.status === "UNVALUED" ? v.reason : null,
      inspectHref: inspectHref(input.portfolioId, p.positionId),
    };
  });
  return rows.sort((a, b) => (b.referenceValueGhs ?? -1) - (a.referenceValueGhs ?? -1) || a.label.localeCompare(b.label) || a.positionId.localeCompare(b.positionId));
}

/**
 * "When does capital come due?" — contractual principal on the M8.2 eligibility
 * rules, with the first year split at the stated near-term window. Years 1+ use
 * the M8.2 calendar-anniversary buckets unchanged, so Σ equals the M8.2 ladder.
 */
export function buildMaturityProfile(input: WorkspaceInput): MaturityProfile {
  const valDate = day(input.valuationDate);
  const defs: { key: MaturityProfileBucket["key"]; label: string }[] = [
    { key: "LE_90D", label: `Within ${NEAR_MATURITY_DAYS} days` },
    { key: "D91_12M", label: `${NEAR_MATURITY_DAYS} days – 1 year` },
    { key: "Y1_3", label: "1–3 years" },
    { key: "Y3_5", label: "3–5 years" },
    { key: "GT_5Y", label: "5+ years" },
  ];
  const acc = new Map(defs.map((d) => [d.key, { cents: 0, count: 0 }]));
  for (const p of input.positions) {
    const eligible = p.bond ? checkMaturityEligibility(p.bond, valDate).eligible : p.bill ? checkBillMaturityEligibility(p.bill, valDate).eligible : false;
    if (!eligible) continue;
    const maturity = p.bond ? p.bond.terms.maturityDate : p.bill!.maturityDate;
    const nominal = p.bond ? p.bond.nominalGhs : p.bill!.faceValueGhs;
    const days = daysBetween(valDate, maturity);
    const key: MaturityProfileBucket["key"] | null = days <= NEAR_MATURITY_DAYS ? "LE_90D" : bucketAfter(maturity, valDate);
    if (key === null) continue;
    const slot = acc.get(key)!;
    slot.cents += Math.round(nominal * 100);
    slot.count += 1;
  }
  const totalCents = [...acc.values()].reduce((s, a) => s + a.cents, 0);
  const buckets = defs.map((d) => {
    const a = acc.get(d.key)!;
    return { key: d.key, label: d.label, nominalGhs: a.cents / 100, nominalPct: totalCents > 0 ? (a.cents / totalCents) * 100 : null, positionCount: a.count };
  });
  const near = acc.get("LE_90D")!;
  return { buckets, totalNominalGhs: totalCents / 100, nearTermNominalGhs: near.cents / 100, nearTermCount: near.count };
}

/** The M8.2 bucket for a maturity beyond the near-term window, mapped onto the profile keys. */
function bucketAfter(maturity: Date, valDate: Date): MaturityProfileBucket["key"] | null {
  const k = maturityBucketOf(maturity, valDate);
  if (k === null) return null;
  return k === "LT_1Y" ? "D91_12M" : k;
}

export function buildQuality(input: WorkspaceInput, holdings: HoldingView[]): QualityView {
  const s = input.summary;
  const needsReview = holdings
    .filter((h) => h.status === "UNVALUED" || h.quality.recency === "STALE")
    .map((h) => ({ positionId: h.positionId, label: h.label, message: h.status === "UNVALUED" ? `Cannot be valued: ${h.unvaluedReason}` : (h.quality.note ?? h.quality.label), href: h.inspectHref }));
  const n = s.positionCount;
  const supported = s.valuedCount - s.assumptionCount;
  const open = s.staleCount + s.unvaluedCount;
  const holdingsWord = (k: number) => plural(k, "holding");
  let summary: string;
  if (n === 0) summary = "No holdings yet.";
  else if (s.valuedCount === 0) summary = `None of the ${n} ${holdingsWord(n)} can be valued yet.`;
  else if (s.assumptionCount === 0) {
    summary = `${s.recentCount} of ${n} ${holdingsWord(n)} ${s.recentCount === 1 ? "uses" : "use"} recent valuation evidence.${open > 0 ? ` ${open} ${holdingsWord(open)} ${open === 1 ? "needs" : "need"} review.` : ""}`;
  } else {
    // With assumptions the question changes from "how recent is the evidence" to "what kind of value is each holding".
    const parts = [`${supported} of ${n} ${holdingsWord(n)} ${supported === 1 ? "is" : "are"} supported by Korbly valuations`, `${s.assumptionCount} ${s.assumptionCount === 1 ? "rests" : "rest"} on analyst assumptions`];
    if (s.unvaluedCount > 0) parts.push(`${s.unvaluedCount} cannot be valued`);
    summary = `${parts.join("; ")}.${s.staleCount > 0 ? ` ${s.staleCount} of the supported ${plural(s.staleCount, "holding")} ${s.staleCount === 1 ? "uses" : "use"} older evidence.` : ""}`;
  }
  const heroParts: string[] = [];
  if (s.recentCount > 0) heroParts.push(`${s.recentCount} recent`);
  if (s.staleCount > 0) heroParts.push(`${s.staleCount} older`);
  if (s.assumptionCount > 0) heroParts.push(`${s.assumptionCount} assumed`);
  if (s.unvaluedCount > 0) heroParts.push(`${s.unvaluedCount} not valued`);
  return {
    valuedCount: s.valuedCount,
    positionCount: n,
    recentCount: s.recentCount,
    staleCount: s.staleCount,
    unvaluedCount: s.unvaluedCount,
    assumptionCount: s.assumptionCount,
    supportedCount: supported,
    recentPct: s.recentPct,
    assumptionPct: s.assumptionPct,
    summary,
    heroLine: heroParts.join(" · "),
    needsReview,
    hasBillDisclosure: input.positions.some((p) => p.assetClass === "TREASURY_BILL"),
  };
}
