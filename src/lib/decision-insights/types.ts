// ---------------------------------------------------------------------------
// Decision-insight contract (M9.0). Pure. These types describe INTERPRETATION
// of calculations that already exist (M8.1 valuation, M8.2 exposures, M8.3
// scenario engine) — nothing here prices, values, shocks or aggregates.
//
//   CALCULATION → INTERPRETATION → MATERIALITY → CONCLUSION → INVESTIGATION → EVIDENCE
//
// Every statement keeps three things apart:
//   fact           what the numbers say
//   interpretation what that means arithmetically for the portfolio
//   investigation  what an analyst may want to look at — never BUY/SELL/HOLD
// ---------------------------------------------------------------------------

import type { ExposureAssetClass } from "../portfolio";

export type InsightKind = "UNVALUED_EXPOSURE" | "DOMINANT_ASSET_CLASS" | "LARGEST_ISSUER" | "LARGEST_HOLDING" | "RATE_DRIVER" | "NEAR_MATURITY" | "STALE_EVIDENCE";

/** Where a figure came from, so a conclusion can be traced to a number, a position and a page. */
export interface EvidenceItem {
  label: string;
  value: string;
  href?: string;
}

export interface Investigation {
  id: string;
  kind: InsightKind | "SCENARIO_DRIVER" | "SCENARIO_RATE" | "SCENARIO_STALE" | "SCENARIO_EXCLUDED";
  /** "Review GoG Jul-34" */
  title: string;
  /** Plain prompt. Always an invitation to look, never an instruction to trade. */
  prompt: string;
  /** Why this deserves attention — the measured reason. */
  reason: string;
  positionId: string | null;
  href: string | null;
  evidence: EvidenceItem[];
}

export interface Insight {
  id: string;
  kind: InsightKind;
  /** Materiality on a 0–100 scale — always a share of something real (portfolio value, rate sensitivity, maturity ladder). Used only to rank. */
  materiality: number;
  /** What is measured, so the ranking rule is visible: e.g. "Share of valued Reference Value". */
  materialityBasis: string;
  title: string;
  fact: string;
  interpretation: string | null;
  investigationId: string | null;
  positionId: string | null;
  evidence: EvidenceItem[];
}

export interface PrimaryConclusion {
  kind: "PORTFOLIO" | "NOT_VALUED";
  fact: string;
  interpretation: string | null;
  /** The insight ids the conclusion was drawn from. */
  basedOn: string[];
  evidence: EvidenceItem[];
}

export interface DecisionInsights {
  primary: PrimaryConclusion | null;
  /** Ranked, at most {@link MAX_INSIGHTS}. */
  insights: Insight[];
  /** At most {@link MAX_INVESTIGATIONS}, ordered by the insight that produced each. */
  investigations: Investigation[];
}

export const MAX_INSIGHTS = 4;
export const MAX_INVESTIGATIONS = 3;
/** "Matures soon" — a calendar window, stated, not tuned. */
export const NEAR_MATURITY_DAYS = 90;

// ---------------------------------------------------------------------------
// Holdings / profile view models
// ---------------------------------------------------------------------------

export type RateKind = "BOND_YIELD" | "BILL_RATE";

export interface HoldingRate {
  kind: RateKind;
  /** GHS per +1bp, positive magnitude (M8.2). */
  dv01Ghs: number;
  /** First-order GHS change for a 1 percentage-point rise = DV01 × 100. An estimate, not a scenario result. */
  per1ppGhs: number;
  modifiedDurationYears: number;
  /** Share of this holding's sleeve DV01 (bonds vs bills are never added together). */
  sleeveSharePct: number;
}

export interface HoldingQuality {
  recency: "RECENT" | "STALE" | null;
  inputDate: string | null;
  ageDays: number | null;
  /** Calm one-liner: "Recent trade (3 days old)". */
  label: string;
  /** Extra context when it matters (stale trade vs current report, indicative bill valuation). */
  note: string | null;
}

export interface HoldingView {
  positionId: string;
  label: string;
  issuerName: string;
  assetClass: ExposureAssetClass;
  assetClassLabel: string;
  status: "VALUED" | "UNVALUED";
  referenceValueGhs: number | null;
  /** Share of valued Reference Value (0–100); null when unvalued. */
  weightPct: number | null;
  /** "GHS 1,000,000 face" / "GHS 1,500,000 nominal" / "100,000 shares". */
  sizeText: string;
  maturityDate: string | null;
  daysToMaturity: number | null;
  rate: HoldingRate | null;
  quality: HoldingQuality;
  unvaluedReason: string | null;
  inspectHref: string;
}

export type HoldingsLens = "SIMPLE" | "RATES" | "MATURITY" | "QUALITY";

export interface MaturityProfileBucket {
  key: "LE_90D" | "D91_12M" | "Y1_3" | "Y3_5" | "GT_5Y";
  label: string;
  /** Contractual principal: bond nominal + Treasury-bill face. */
  nominalGhs: number;
  nominalPct: number | null;
  positionCount: number;
}

export interface MaturityProfile {
  buckets: MaturityProfileBucket[];
  totalNominalGhs: number;
  /** Principal maturing within {@link NEAR_MATURITY_DAYS}. */
  nearTermNominalGhs: number;
  nearTermCount: number;
}

export interface QualityView {
  valuedCount: number;
  positionCount: number;
  recentCount: number;
  staleCount: number;
  unvaluedCount: number;
  /** Share of valued Reference Value on recent evidence (0–100); null when nothing is valued. */
  recentPct: number | null;
  /** "5 of 6 holdings use recent valuation evidence." */
  summary: string;
  /** Holdings that need a look, most material first. */
  needsReview: { positionId: string; label: string; message: string; href: string }[];
  /** True when any holding is a Treasury bill (indicative valuation disclosure applies). */
  hasBillDisclosure: boolean;
}

/** Plain-English glosses for technical terms — shown first, with the technical name behind progressive disclosure. */
export const PLAIN_TERMS = {
  rateSensitivity: { plain: "Rate sensitivity", technical: "Modified duration / DV01", help: "How much a holding's value is estimated to change when interest rates move." },
  dv01: { plain: "Value change for a 0.01 percentage-point rate move", technical: "DV01", help: "Estimated value change for a 0.01 percentage-point (1 basis-point) rise in the holding's rate." },
  billValuation: { plain: "Indicative Treasury-bill valuation", technical: "Interpolated BoG auction curve", help: "Indicative valuation using an interpolated Bank of Ghana auction rate; no secondary-market quote is available." },
} as const;
