// ---------------------------------------------------------------------------
// Overall Market Condition (M8 §21/§23/§28/§41) — combines the five
// dimension evaluators into one short descriptive label plus a concise,
// template-assembled explanation. Deterministic: same five dimension
// results always produce the same label and explanation, no randomness,
// no LLM call (M8 §28/§52).
//
// Methodology (documented, versioned — CLAUDE.md §22's original Market
// Condition V1 spec, finally implemented in M8):
//   Each dimension contributes -1 / 0 / +1 depending on whether its state
//   is the "improving", "neutral", or "pressure" member of its own state
//   vocabulary (see POSITIVE_STATES/NEGATIVE_STATES below). Only
//   dimensions with freshness=CURRENT count (M8 §40/§41) — a stale or
//   missing dimension is excluded from the score AND named as excluded,
//   never silently treated as neutral (M8 §39).
// ---------------------------------------------------------------------------

import { isEligibleForSynthesis, type IntelligenceResult } from "./types";

export const MARKET_CONDITION_METHODOLOGY_VERSION = "v1";

const POSITIVE_STATES = new Set(["EASING", "STRENGTHENING", "FALLING", "POSITIVE"]);
const NEGATIVE_STATES = new Set(["RISING", "WEAKENING", "TIGHTENING", "NEGATIVE"]);

function scoreFor(state: string): -1 | 0 | 1 {
  if (POSITIVE_STATES.has(state)) return 1;
  if (NEGATIVE_STATES.has(state)) return -1;
  return 0;
}

export type DimensionKey = "inflation" | "currency" | "monetaryPolicy" | "shortTermRates" | "equityMomentum";

export interface DimensionSummary {
  key: DimensionKey;
  label: string;
  result: IntelligenceResult<string>;
  eligible: boolean;
  score: number;
}

export interface MarketConditionSummary {
  label: string;
  explanation: string;
  dimensions: DimensionSummary[];
  eligibleCount: number;
  totalCount: number;
  calculationDate: string;
  methodologyVersion: string;
}

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  inflation: "Inflation",
  currency: "Currency",
  monetaryPolicy: "Policy",
  shortTermRates: "T-Bills",
  equityMomentum: "Equities",
};

/** Fixed evaluation order — used to break ties deterministically when picking which dimensions drive the explanation. */
const DIMENSION_ORDER: DimensionKey[] = ["inflation", "currency", "monetaryPolicy", "shortTermRates", "equityMomentum"];

export function buildMarketConditionSummary(results: Record<DimensionKey, IntelligenceResult<string>>, now: Date = new Date()): MarketConditionSummary {
  const dimensions: DimensionSummary[] = DIMENSION_ORDER.map((key) => {
    const result = results[key];
    const eligible = isEligibleForSynthesis(result);
    return { key, label: DIMENSION_LABELS[key], result, eligible, score: eligible ? scoreFor(result.state) : 0 };
  });

  const eligible = dimensions.filter((d) => d.eligible);
  const eligibleCount = eligible.length;
  const totalCount = dimensions.length;

  if (eligibleCount === 0) {
    return {
      label: "Insufficient current data",
      explanation: "None of the tracked market dimensions have current data yet — check Data Centre for ingestion status.",
      dimensions,
      eligibleCount,
      totalCount,
      calculationDate: now.toISOString().slice(0, 10),
      methodologyVersion: MARKET_CONDITION_METHODOLOGY_VERSION,
    };
  }

  const totalScore = eligible.reduce((sum, d) => sum + d.score, 0);
  const avgScore = totalScore / eligibleCount;

  const positives = eligible.filter((d) => d.score > 0);
  const negatives = eligible.filter((d) => d.score < 0);

  let label: string;
  // A clear net-positive or net-negative average speaks for itself; only
  // when the average is genuinely ambiguous (near zero) does a specific
  // divergent pair (M8 §23's "Inflation easing, currency pressure
  // elevated" example) add more information than the generic bucket.
  if (avgScore > 0.3) {
    label = "Improving macro backdrop";
  } else if (avgScore < -0.3) {
    label = "Tight financial conditions";
  } else if (positives.length > 0 && negatives.length > 0) {
    const positive = positives[0];
    const negative = negatives[0];
    label = `${capitalize(shortPhrase(positive))}, ${shortPhrase(negative)}`;
  } else {
    label = "Mixed market conditions";
  }

  const explanation = buildExplanation(eligible, positives, negatives);

  return {
    label,
    explanation,
    dimensions,
    eligibleCount,
    totalCount,
    calculationDate: now.toISOString().slice(0, 10),
    methodologyVersion: MARKET_CONDITION_METHODOLOGY_VERSION,
  };
}

const SHORT_PHRASE: Record<DimensionKey, Partial<Record<string, string>>> = {
  inflation: { EASING: "inflation easing", RISING: "inflation rising", STABLE: "inflation stable" },
  currency: { STRENGTHENING: "currency strengthening", WEAKENING: "currency pressure elevated", STABLE: "currency stable" },
  monetaryPolicy: { EASING: "policy easing", TIGHTENING: "policy tightening", HOLDING: "policy holding" },
  shortTermRates: { FALLING: "yields falling", RISING: "yields rising", MIXED: "yields mixed" },
  equityMomentum: { POSITIVE: "equities positive", NEGATIVE: "equities under pressure", NEUTRAL: "equities neutral" },
};

function shortPhrase(d: DimensionSummary): string {
  return SHORT_PHRASE[d.key][d.result.state] ?? `${d.label.toLowerCase()} ${d.result.state.toLowerCase()}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Concise deterministic explanation (M8 §28): reuses each dimension's own
 * already-worded, already-tested `explanation` sentence rather than a
 * second templating layer — picks at most one representative positive and
 * one representative negative sentence, so the summary reads like "X.
 * However, Y." without inventing new prose.
 */
function buildExplanation(eligible: DimensionSummary[], positives: DimensionSummary[], negatives: DimensionSummary[]): string {
  if (positives.length === 0 && negatives.length === 0) {
    return "Conditions were broadly unchanged across tracked indicators this period.";
  }
  if (negatives.length === 0) {
    return positives
      .slice(0, 2)
      .map((d) => d.result.explanation)
      .join(" ");
  }
  if (positives.length === 0) {
    return negatives
      .slice(0, 2)
      .map((d) => d.result.explanation)
      .join(" ");
  }
  return `${positives[0].result.explanation} However, ${lowerFirst(negatives[0].result.explanation)}`;
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}
