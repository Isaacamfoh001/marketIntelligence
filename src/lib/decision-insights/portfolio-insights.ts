// ---------------------------------------------------------------------------
// Portfolio decision insights (M9.0, methodology revised in M9.0.1). Pure and
// deterministic: same portfolio + same context → same insights, same order, same
// words. No LLM, no verdicts ("too high"), no recommendation vocabulary.
//
// BEFORE (M9.0): every candidate was scored 0–100 and ranked on ONE list. Rate
// and maturity shares were rescaled by "the fixed-income sleeve's share of value"
// so they could sit beside value shares. That multiplication is not a financial
// quantity: it let "60% of rate sensitivity × 50% fixed income = 30%" compete with
// "35% of value is equities", as if both were the same kind of importance.
//
// NOW, in three separate steps, none of which creates a universal score:
//
//  1. RANK WITHIN A DIMENSION, by that dimension's natural denominator (rank.ts):
//       composition → share of value · concentration → share of value in one
//       issuer/holding · rate sensitivity → share of MEASURED sensitivity ·
//       maturity → share of contractual principal · data quality → share of value
//       on older evidence · valuation basis → share of value resting on assumptions.
//     Shares are never compared across dimensions.
//
//  2. CHOOSE WHICH DIMENSIONS LEAD by a fixed policy per CONTEXT (what the user is
//     looking at). The policy is a readable ordered list (LIST_ORDER / PRIMARY_ORDER),
//     not a formula. Reasoning:
//       – what is EXCLUDED (unvalued) comes first: it decides whether the totals mean
//         what they appear to;
//       – then HOW MUCH rests on assumptions: it qualifies every figure that follows;
//       – then the question of the page: Overview → composition; Exposure → rate
//         sensitivity; Quality → valuation basis.
//     Each dimension contributes its best finding first; extra findings only fill
//     remaining slots, in the same order. At most MAX_INSIGHTS are shown.
//
//  3. ORDER INVESTIGATION PROMPTS separately (INVESTIGATION_PRIORITY): an unvalued
//     holding has no value denominator yet is the first thing to look at, so
//     investigation order is a priority class, not the insight ranking.
//
// A conclusion is FACT → MEANING: the sentence says what is true and what it means
// arithmetically for this portfolio. It is never a recommendation.
// ---------------------------------------------------------------------------

import { valueTerms, type ValueTerms } from "../portfolio";
import { ghsCompact, ghsWhole, plural } from "../scenario-studio/format";
import { buildHoldings, buildMaturityProfile, inspectHref, type WorkspaceInput } from "./holdings";
import { rankComposition, rankConcentration, rankDataQuality, rankMaturity, rankRate, rankUnvalued, rankValuationBasis } from "./rank";
import { MATERIAL_SHARE_PCT, MAX_INSIGHTS, MAX_INVESTIGATIONS, NEAR_MATURITY_DAYS, type DecisionInsights, type EvidenceItem, type Insight, type InsightContext, type InsightDimension, type Investigation, type PrimaryConclusion } from "./types";

/**
 * Which dimensions open the INSIGHT LIST in each context. Order = priority. See the header for the reasoning.
 */
export const LIST_ORDER: Record<InsightContext, InsightDimension[]> = {
  OVERVIEW: ["UNVALUED", "VALUATION_BASIS", "COMPOSITION", "CONCENTRATION", "RATE_SENSITIVITY", "MATURITY", "DATA_QUALITY"],
  EXPOSURE: ["UNVALUED", "RATE_SENSITIVITY", "CONCENTRATION", "COMPOSITION", "MATURITY", "VALUATION_BASIS", "DATA_QUALITY"],
  QUALITY: ["VALUATION_BASIS", "UNVALUED", "DATA_QUALITY", "COMPOSITION", "CONCENTRATION", "RATE_SENSITIVITY", "MATURITY"],
  SCENARIO: ["UNVALUED", "VALUATION_BASIS", "DATA_QUALITY", "RATE_SENSITIVITY", "COMPOSITION", "CONCENTRATION", "MATURITY"],
};

/**
 * Which dimension answers the PRIMARY CONCLUSION in each context — the page's own question. The first dimension that has a
 * finding wins; if none does, the Overview order is used. Data hygiene (unvalued) is never the headline of a portfolio that
 * has valued holdings; it leads the list and the investigations instead.
 */
export const PRIMARY_ORDER: Record<InsightContext, InsightDimension[]> = {
  OVERVIEW: ["COMPOSITION", "CONCENTRATION", "RATE_SENSITIVITY", "MATURITY"],
  EXPOSURE: ["RATE_SENSITIVITY", "CONCENTRATION", "COMPOSITION", "MATURITY"],
  QUALITY: ["VALUATION_BASIS", "DATA_QUALITY", "UNVALUED", "COMPOSITION"],
  SCENARIO: ["COMPOSITION", "CONCENTRATION", "RATE_SENSITIVITY", "MATURITY"],
};

/**
 * Investigation priority classes (1 = look first). Separate from insight ranking: what most deserves a look is not the same
 * question as what is largest. Ties inside a class break on id.
 */
export const INVESTIGATION_PRIORITY = {
  UNVALUED: 1, // a holding with no value at all — the totals omit it
  SCENARIO_ASSUMPTION: 2, // the biggest scenario driver starts from an analyst assumption
  MATERIAL_ASSUMPTION: 3, // ≥ MATERIAL_SHARE_PCT of the analytical starting value is assumed
  STALE_MATERIAL: 4, // ≥ MATERIAL_SHARE_PCT of the value rests on older evidence
  RATE_LEADER: 5, // the largest rate-sensitive holding
  NEAR_MATURITY: 6, // capital due soon
  CONCENTRATION: 7, // a majority in one issuer or asset class
} as const;

export const fmtPct = (n: number) => `${n.toFixed(n >= 10 || Number.isInteger(n) ? 0 : 1)}%`;
const list = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`);
const lc = (s: string) => s.toLowerCase();

interface Conclusion {
  fact: string;
  interpretation: string | null;
}

interface Finding {
  dimension: InsightDimension;
  insight: Insight;
  investigation: Investigation | null;
  /** Context-specific FACT → MEANING sentences; falls back to the insight's own fact and interpretation. */
  conclusions: Partial<Record<InsightContext, Conclusion>>;
}

const portfolioHref = (portfolioId: string, view: string) => `/portfolios/${portfolioId}?view=${view}`;

/** Every finding the portfolio supports, grouped later by dimension and ranked within it. */
export function buildFindings(input: WorkspaceInput): Finding[] {
  const { summary, exposures } = input;
  const holdings = buildHoldings(input);
  const valued = holdings.filter((h) => h.status === "VALUED");
  const terms: ValueTerms = valueTerms(summary);
  const findings: Finding[] = [];

  // --- UNVALUED — no denominator; ordered by the principal still excluded -----------------------------
  const unvalued = rankUnvalued(holdings);
  if (unvalued.length > 0) {
    const first = unvalued[0];
    const anyAssumable = unvalued.some((h) => h.canAssume);
    findings.push({
      dimension: "UNVALUED",
      insight: {
        id: "unvalued",
        kind: "UNVALUED_EXPOSURE",
        dimension: "UNVALUED",
        share: null,
        shareBasis: "No value denominator — ordered by the contractual principal still excluded",
        title: "Holdings that cannot be valued",
        fact: `${unvalued.length} ${plural(unvalued.length, "holding")} (${list(unvalued.map((h) => h.label))}) cannot be valued and ${unvalued.length === 1 ? "is" : "are"} left out of every value-based figure.`,
        interpretation: `Totals describe the valued part of the portfolio only. Excluded holdings are not counted as zero.${anyAssumable ? " A holding that lacks market evidence can be brought into the analysis with an explicit analyst assumption, which is then labelled as one." : ""}`,
        investigationId: "inv-unvalued",
        positionId: first.positionId,
        evidence: unvalued.map((h) => ({ label: h.label, value: `${h.unvaluedReason ?? "No valuation"}${h.principalGhs !== null ? ` · ${ghsWhole(h.principalGhs)} principal excluded` : ""}`, href: h.inspectHref })),
      },
      investigation: {
        id: "inv-unvalued",
        kind: "UNVALUED_EXPOSURE",
        priority: INVESTIGATION_PRIORITY.UNVALUED,
        title: `Review ${first.label}`,
        prompt: `Review why ${first.label} cannot be valued${unvalued.length > 1 ? ` (and ${unvalued.length - 1} other ${plural(unvalued.length - 1, "holding")})` : ""}.`,
        reason: first.unvaluedReason ?? "No usable valuation input.",
        positionId: first.positionId,
        href: first.inspectHref,
        evidence: [{ label: first.label, value: first.unvaluedReason ?? "No valuation", href: first.inspectHref }],
      },
      conclusions: {
        QUALITY: {
          fact: `${unvalued.length === 1 ? "One holding remains" : `${unvalued.length} holdings remain`} excluded because neither Korbly nor an analyst assumption supplies a usable valuation.`,
          interpretation: "Excluded holdings are not counted as zero: every total and share describes the valued part of the portfolio only.",
        },
      },
    });
  }

  if (valued.length > 0) {
    // --- VALUATION_BASIS — how much of the analysis rests on assumptions? --------------------------
    const assumed = rankValuationBasis(holdings, summary.referenceValueGhs);
    if (assumed.length > 0 && summary.assumptionPct !== null) {
      const lead = assumed[0];
      const supportedPct = 100 - summary.assumptionPct;
      const material = summary.assumptionPct >= MATERIAL_SHARE_PCT;
      const leadText = `${lead.holding.label} is the largest assumption-based position (${lead.holding.assumptionSummary}, ${ghsCompact(lead.holding.referenceValueGhs ?? 0)})`;
      findings.push({
        dimension: "VALUATION_BASIS",
        insight: {
          id: "assumptions",
          kind: "ASSUMPTION_DEPENDENCE",
          dimension: "VALUATION_BASIS",
          share: summary.assumptionPct,
          shareBasis: `Share of ${terms.label} resting on analyst assumptions`,
          title: "Analyst assumptions in the valuation",
          fact: `${fmtPct(summary.assumptionPct)} of ${terms.label} (${ghsCompact(summary.basis.assumption.valueGhs)}) depends on analyst valuation assumptions.`,
          interpretation: `${leadText}. These are disclosed analytical inputs, not observed prices; the other ${fmtPct(supportedPct)} (${ghsCompact(summary.basis.supported.valueGhs)}) rests on Korbly-supported valuations.`,
          investigationId: material ? "inv-assumption" : null,
          positionId: lead.holding.positionId,
          evidence: assumed.map((a) => ({ label: a.holding.label, value: `${a.holding.assumptionSummary} · ${ghsWhole(a.holding.referenceValueGhs ?? 0)} · ${fmtPct(a.sharePct)} of ${terms.label}`, href: a.holding.inspectHref })),
        },
        investigation: material
          ? {
              id: "inv-assumption",
              kind: "ASSUMPTION_DEPENDENCE",
              priority: INVESTIGATION_PRIORITY.MATERIAL_ASSUMPTION,
              title: `Review the assumption behind ${lead.holding.label}`,
              prompt: `Review the ${lead.holding.assumptionSummary} assumed for ${lead.holding.label} — it is the largest assumption-based position (${fmtPct(lead.sharePct)} of ${terms.label}).`,
              reason: `${fmtPct(summary.assumptionPct)} of ${terms.label} depends on analyst assumptions.`,
              positionId: lead.holding.positionId,
              href: lead.holding.inspectHref,
              evidence: [{ label: lead.holding.label, value: `${lead.holding.assumptionSummary} · ${ghsWhole(lead.holding.referenceValueGhs ?? 0)}`, href: lead.holding.inspectHref }],
            }
          : null,
        conclusions: {
          QUALITY: {
            fact: supportedPct > 50 ? `Most of this portfolio uses Korbly-supported valuation, but ${fmtPct(summary.assumptionPct)} of ${terms.label} depends on analyst assumptions.` : `Most of the ${terms.label} (${fmtPct(summary.assumptionPct)}) depends on analyst assumptions; Korbly supports ${fmtPct(supportedPct)}.`,
            interpretation: `${leadText}. Assumptions are disclosed analytical inputs, not observed prices.`,
          },
        },
      });
    }

    // --- COMPOSITION — what dominates the portfolio? -----------------------------------------------
    const classes = rankComposition(exposures);
    const topClass = classes[0];
    if (topClass) {
      const majority = topClass.sharePct > 50;
      const top = valued[0];
      const inClass = valued.filter((h) => h.assetClass === topClass.assetClass);
      const leadHolding = inClass[0] && inClass.length > 1 ? inClass[0] : null;
      const assumedClause = summary.assumptionCount > 0 && summary.assumptionPct !== null ? ` ${fmtPct(summary.assumptionPct)} of this value rests on analyst assumptions.` : "";
      const interpretation = classes.length === 1 ? `The portfolio is invested in a single asset class: ${lc(topClass.label)}.` : majority ? `More than half of the portfolio is in ${lc(topClass.label)}, so it is the main driver of overall value.` : `No single asset class holds a majority; ${lc(topClass.label)} is the largest.`;
      findings.push({
        dimension: "COMPOSITION",
        insight: {
          id: `class:${topClass.assetClass}`,
          kind: "DOMINANT_ASSET_CLASS",
          dimension: "COMPOSITION",
          share: topClass.sharePct,
          shareBasis: `Share of ${terms.shareOf}`,
          title: "Largest asset class",
          fact: `${topClass.label} are ${fmtPct(topClass.sharePct)} of ${terms.shareOf} (${ghsCompact(topClass.valueGhs)}).`,
          interpretation,
          investigationId: majority ? "inv-class" : null,
          positionId: null,
          evidence: classes.map((c) => ({ label: c.label, value: `${fmtPct(c.sharePct)} · ${ghsWhole(c.valueGhs)}` })),
        },
        investigation: majority
          ? { id: "inv-class", kind: "DOMINANT_ASSET_CLASS", priority: INVESTIGATION_PRIORITY.CONCENTRATION, title: `Review the ${lc(topClass.label)} allocation`, prompt: `Review whether a ${fmtPct(topClass.sharePct)} allocation to ${lc(topClass.label)} matches the portfolio's intended mix.`, reason: `${topClass.label} are the majority of ${terms.shareOf}.`, positionId: null, href: portfolioHref(input.portfolioId, "exposure"), evidence: [{ label: topClass.label, value: `${fmtPct(topClass.sharePct)} of ${terms.shareOf}` }] }
          : null,
        conclusions: {
          OVERVIEW: {
            fact: classes.length === 1 ? `This portfolio is invested entirely in ${lc(topClass.label)}: ${fmtPct(topClass.sharePct)} (${ghsCompact(topClass.valueGhs)}) of ${terms.label}.` : majority ? `This portfolio is primarily invested in ${lc(topClass.label)}. ${topClass.label} are ${fmtPct(topClass.sharePct)} (${ghsCompact(topClass.valueGhs)}) of ${terms.label}${leadHolding ? `, and ${leadHolding.label} is the largest single holding` : ""}.` : `No single asset class dominates this portfolio: ${lc(topClass.label)} are the largest at ${fmtPct(topClass.sharePct)} (${ghsCompact(topClass.valueGhs)}) of ${terms.label}${top && classes.length > 1 ? `, and ${top.label} is the largest single holding` : ""}.`,
            interpretation: `${majority ? `So ${lc(topClass.label)} are the main driver of overall value.` : classes.length === 1 ? "There is no diversification across asset classes." : "Value is spread across several asset classes."}${assumedClause}`,
          },
        },
      });
    }

    // --- CONCENTRATION — where is exposure concentrated? ---------------------------------------------
    const issuers = rankConcentration(exposures);
    const topIssuer = issuers[0];
    if (topIssuer) {
      const majority = topIssuer.pct > 50;
      const issuerHoldings = valued.filter((h) => h.issuerName === topIssuer.issuer.name);
      findings.push({
        dimension: "CONCENTRATION",
        insight: {
          id: `issuer:${topIssuer.issuer.key}`,
          kind: "LARGEST_ISSUER",
          dimension: "CONCENTRATION",
          share: topIssuer.pct,
          shareBasis: `Share of ${terms.shareOf} held with one issuer`,
          title: "Largest issuer exposure",
          fact: `${topIssuer.issuer.name} is the largest issuer exposure: ${fmtPct(topIssuer.pct)} of ${terms.shareOf} (${ghsCompact(topIssuer.referenceValueGhs)}).`,
          interpretation: topIssuer.valuedCount === 1 ? `The exposure sits in a single holding${issuerHoldings[0] ? ` (${issuerHoldings[0].label})` : ""}.` : `The exposure runs through ${topIssuer.valuedCount} holdings across ${topIssuer.assetClasses.length} ${plural(topIssuer.assetClasses.length, "asset class", "asset classes")}, so it is one issuer's credit and rate environment, not several.`,
          investigationId: majority ? "inv-issuer" : null,
          positionId: topIssuer.valuedCount === 1 && issuerHoldings[0] ? issuerHoldings[0].positionId : null,
          evidence: issuers.slice(0, 4).map((r) => ({ label: r.issuer.name, value: `${fmtPct(r.pct)} · ${ghsWhole(r.referenceValueGhs)}` })),
        },
        investigation: majority
          ? { id: "inv-issuer", kind: "LARGEST_ISSUER", priority: INVESTIGATION_PRIORITY.CONCENTRATION, title: `Review ${topIssuer.issuer.name} exposure`, prompt: `Review whether ${fmtPct(topIssuer.pct)} exposure to ${topIssuer.issuer.name} matches the portfolio's intended exposure.`, reason: `${topIssuer.issuer.name} is the majority of ${terms.shareOf}.`, positionId: null, href: portfolioHref(input.portfolioId, "exposure"), evidence: [{ label: topIssuer.issuer.name, value: `${fmtPct(topIssuer.pct)} of ${terms.shareOf}` }] }
          : null,
        conclusions: {
          EXPOSURE: {
            fact: `${topIssuer.issuer.name} is the largest issuer exposure at ${fmtPct(topIssuer.pct)} of ${terms.label} (${ghsCompact(topIssuer.referenceValueGhs)}).`,
            interpretation: topIssuer.valuedCount === 1 ? `All of it sits in a single holding${issuerHoldings[0] ? ` (${issuerHoldings[0].label})` : ""}.` : `It runs through ${topIssuer.valuedCount} holdings across ${topIssuer.assetClasses.length} ${plural(topIssuer.assetClasses.length, "asset class", "asset classes")}, so it is one issuer's credit and rate environment, not several.`,
          },
        },
      });
      // Largest single holding — the same dimension, ranked after the issuer (an issuer's share is never smaller than its holding's).
      const top = valued[0];
      const redundant = topIssuer.valuedCount === 1 && topIssuer.issuer.name === top.issuerName;
      if (top && top.weightPct !== null && !redundant) {
        findings.push({
          dimension: "CONCENTRATION",
          insight: {
            id: `holding:${top.positionId}`,
            kind: "LARGEST_HOLDING",
            dimension: "CONCENTRATION",
            share: top.weightPct,
            shareBasis: `Share of ${terms.shareOf} in one holding`,
            title: "Largest holding",
            fact: `${top.label} is the largest holding: ${fmtPct(top.weightPct)} of ${terms.shareOf} (${ghsCompact(top.referenceValueGhs!)}).`,
            interpretation: `One holding accounts for ${fmtPct(top.weightPct)} of the valued portfolio.${top.basis === "ANALYST_ASSUMPTION" ? ` Its value uses an analyst assumption (${top.assumptionSummary}).` : ""}`,
            investigationId: null,
            positionId: top.positionId,
            evidence: [{ label: top.label, value: `${fmtPct(top.weightPct)} · ${ghsWhole(top.referenceValueGhs!)} · ${top.assetClassLabel}`, href: top.inspectHref }],
          },
          investigation: null,
          conclusions: {},
        });
      }
    }

    // --- RATE_SENSITIVITY — where does MEASURED rate sensitivity sit? ----------------------------
    const rate = rankRate(holdings);
    if (rate && rate.holdings.length > 0) {
      const lead = rate.holdings[0];
      const leadClass = rate.classes[0];
      const what = lead.holding.rate.kind === "BOND_YIELD" ? "yield" : "rate";
      const assumedRate = rate.assumptionSharePct > 0 ? ` ${fmtPct(rate.assumptionSharePct)} of it rests on an analyst-assumed starting yield or rate.` : "";
      findings.push({
        dimension: "RATE_SENSITIVITY",
        insight: {
          id: `rate:${lead.holding.positionId}`,
          kind: "RATE_DRIVER",
          dimension: "RATE_SENSITIVITY",
          share: lead.sharePct,
          shareBasis: "Share of the portfolio's measured rate sensitivity (each holding's estimated change for a 1 percentage-point move in its own rate)",
          title: "Largest source of rate sensitivity",
          fact: `${lead.holding.label} is ${rate.holdings.length === 1 ? "the only" : "the largest"} source of rate sensitivity: its value is estimated to change by about ${ghsCompact(lead.holding.rate.per1ppGhs)} for a 1 percentage-point move in its ${what}.`,
          interpretation: rate.holdings.length === 1 ? "No other holding is rate-sensitive." : `It carries ${fmtPct(lead.sharePct)} of the portfolio's measured rate sensitivity. Bond yields and Treasury-bill rates are measured separately and compared here on the same 1 percentage-point move.${assumedRate}`,
          investigationId: "inv-rate",
          positionId: lead.holding.positionId,
          evidence: [
            { label: "Estimated change per 1 percentage point", value: ghsWhole(lead.holding.rate.per1ppGhs), href: lead.holding.inspectHref },
            { label: "Value change per 0.01 percentage point (DV01)", value: `GHS ${lead.holding.rate.dv01Ghs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: "Rate sensitivity (modified duration)", value: `${lead.holding.rate.modifiedDurationYears.toFixed(2)} years` },
          ],
        },
        investigation: { id: "inv-rate", kind: "RATE_DRIVER", priority: INVESTIGATION_PRIORITY.RATE_LEADER, title: `Review ${lead.holding.label}`, prompt: `Review ${lead.holding.label} — it is the portfolio's largest rate-sensitive holding.`, reason: `About ${ghsCompact(lead.holding.rate.per1ppGhs)} of value per 1 percentage-point ${what} move.`, positionId: lead.holding.positionId, href: lead.holding.inspectHref, evidence: [{ label: lead.holding.label, value: `${ghsWhole(lead.holding.rate.per1ppGhs)} per 1 percentage point`, href: lead.holding.inspectHref }] },
        conclusions: {
          EXPOSURE: {
            fact: leadClass.sharePct > 50 ? `Most of the measured interest-rate sensitivity (${fmtPct(leadClass.sharePct)}) comes from ${lc(leadClass.label)}, led by ${lead.holding.label}.` : `Measured interest-rate sensitivity is spread across asset classes: ${lc(leadClass.label)} carry the most (${fmtPct(leadClass.sharePct)}), led by ${lead.holding.label}.`,
            interpretation: `For a 1 percentage-point rise in each holding's own rate, the portfolio's value is estimated to fall by about ${ghsCompact(rate.totalPer1ppGhs)} — a first-order estimate, not a forecast.${assumedRate}`,
          },
        },
      });
    }

    // --- MATURITY — what capital comes due soon? --------------------------------------------------
    const profile = buildMaturityProfile(input);
    const near = rankMaturity(holdings, profile.totalNominalGhs);
    if (near.length > 0 && profile.totalNominalGhs > 0) {
      const share = (profile.nearTermNominalGhs / profile.totalNominalGhs) * 100;
      const soonest = near[0].holding;
      findings.push({
        dimension: "MATURITY",
        insight: {
          id: "near-maturity",
          kind: "NEAR_MATURITY",
          dimension: "MATURITY",
          share,
          shareBasis: "Share of the portfolio's contractual fixed-income principal (bond nominal and Treasury-bill face)",
          title: "Maturing soon",
          fact: `${ghsCompact(profile.nearTermNominalGhs)} of principal across ${near.length} ${plural(near.length, "holding")} (${list(near.map((n) => n.holding.label))}) matures within ${NEAR_MATURITY_DAYS} days.`,
          interpretation: `That is ${fmtPct(share)} of the portfolio's contractual fixed-income principal; it will need to be repaid or reinvested.`,
          investigationId: "inv-maturity",
          positionId: soonest.positionId,
          evidence: near.map((n) => ({ label: n.holding.label, value: `matures in ${n.holding.daysToMaturity} days · ${n.holding.sizeText}`, href: n.holding.inspectHref })),
        },
        investigation: { id: "inv-maturity", kind: "NEAR_MATURITY", priority: INVESTIGATION_PRIORITY.NEAR_MATURITY, title: "Review near-term maturities", prompt: `${ghsCompact(profile.nearTermNominalGhs)} matures within ${NEAR_MATURITY_DAYS} days; review upcoming reinvestment needs.`, reason: `${soonest.label} is the soonest, in ${soonest.daysToMaturity} days.`, positionId: soonest.positionId, href: soonest.inspectHref, evidence: near.map((n) => ({ label: n.holding.label, value: `${n.holding.daysToMaturity} days`, href: n.holding.inspectHref })) },
        conclusions: {},
      });
    }

    // --- DATA_QUALITY — what weakens confidence in the evidence? ----------------------------------
    const stale = rankDataQuality(holdings, summary.referenceValueGhs);
    if (stale.length > 0 && summary.stalePct !== null) {
      const lead = stale[0].holding;
      const material = summary.stalePct >= MATERIAL_SHARE_PCT;
      findings.push({
        dimension: "DATA_QUALITY",
        insight: {
          id: "stale",
          kind: "STALE_EVIDENCE",
          dimension: "DATA_QUALITY",
          share: summary.stalePct,
          shareBasis: `Share of ${terms.shareOf} resting on older evidence`,
          title: "Older valuation evidence",
          fact: `${stale.length} of ${valued.length} valued ${plural(valued.length, "holding")} (${list(stale.map((s) => s.holding.label))}) ${stale.length === 1 ? "rests" : "rest"} on older evidence — ${fmtPct(summary.stalePct)} of ${terms.shareOf}.`,
          interpretation: "Their values reflect the last observation, which may not match today's market.",
          investigationId: material ? "inv-stale" : null,
          positionId: lead.positionId,
          evidence: stale.map((s) => ({ label: s.holding.label, value: s.holding.quality.label, href: s.holding.inspectHref })),
        },
        investigation: material ? { id: "inv-stale", kind: "STALE_EVIDENCE", priority: INVESTIGATION_PRIORITY.STALE_MATERIAL, title: `Review ${lead.label} valuation evidence`, prompt: `Review ${lead.label}'s valuation evidence — ${lead.quality.note ?? lead.quality.label}`, reason: lead.quality.label, positionId: lead.positionId, href: lead.inspectHref, evidence: [{ label: lead.label, value: lead.quality.label, href: lead.inspectHref }] } : null,
        conclusions: {},
      });
    }
  }
  return findings;
}

const KIND_TIE: Record<string, number> = { UNVALUED_EXPOSURE: 0, ASSUMPTION_DEPENDENCE: 1, DOMINANT_ASSET_CLASS: 2, LARGEST_ISSUER: 3, LARGEST_HOLDING: 4, RATE_DRIVER: 5, NEAR_MATURITY: 6, STALE_EVIDENCE: 7 };

/** Within a dimension: highest share first (the dimension's own denominator), then a fixed kind order, then id. */
const withinDimension = (a: Finding, b: Finding) => (b.insight.share ?? -1) - (a.insight.share ?? -1) || KIND_TIE[a.insight.kind] - KIND_TIE[b.insight.kind] || a.insight.id.localeCompare(b.insight.id);

/**
 * Chooses which findings are shown. Pass 1: each dimension's BEST finding, in the context's dimension order. Pass 2: any
 * remaining findings, same order. No cross-dimension comparison of shares is ever made.
 */
export function selectFindings(findings: Finding[], context: InsightContext, limit = MAX_INSIGHTS): Finding[] {
  const order = LIST_ORDER[context];
  const byDimension = new Map<InsightDimension, Finding[]>(order.map((d) => [d, findings.filter((f) => f.dimension === d).sort(withinDimension)]));
  const chosen: Finding[] = [];
  for (const d of order) {
    const best = byDimension.get(d)![0];
    if (best && chosen.length < limit) chosen.push(best);
  }
  for (const d of order) {
    for (const f of byDimension.get(d)!.slice(1)) if (chosen.length < limit) chosen.push(f);
  }
  return chosen;
}

/** Investigation prompts, in PRIORITY order — a separate rule from the insight list (see header). */
export function selectInvestigations(findings: Finding[], limit = MAX_INVESTIGATIONS): Investigation[] {
  const seen = new Set<string>();
  const out: Investigation[] = [];
  for (const inv of findings.flatMap((f) => (f.investigation ? [f.investigation] : [])).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    out.push(inv);
    if (out.length === limit) break;
  }
  return out;
}

export function buildDecisionInsights(input: WorkspaceInput, context: InsightContext = "OVERVIEW"): DecisionInsights {
  if (input.positions.length === 0) return { context, primary: null, insights: [], investigations: [] };
  const findings = buildFindings(input);
  const shown = selectFindings(findings, context);
  const investigations = selectInvestigations(findings);
  const keep = new Set(investigations.map((i) => i.id));
  // Insights keep their investigation link only if it survived the limit.
  const insights: Insight[] = shown.map((f) => ({ ...f.insight, investigationId: f.insight.investigationId && keep.has(f.insight.investigationId) ? f.insight.investigationId : null }));
  return { context, primary: primaryConclusion(input, context, findings), insights, investigations };
}

/** The headline for a context: the first dimension in PRIMARY_ORDER that has a finding, as FACT → MEANING. */
export function primaryConclusion(input: WorkspaceInput, context: InsightContext, findings: Finding[]): PrimaryConclusion | null {
  const { summary } = input;
  if (summary.positionCount === 0) return null;
  const terms = valueTerms(summary);
  if (summary.valuedCount === 0) return { kind: "NOT_VALUED", context, dimension: "UNVALUED", fact: `None of the ${summary.positionCount} ${plural(summary.positionCount, "holding")} can be valued yet, so the portfolio has no ${terms.label}.`, interpretation: "Open a holding to see what its valuation is missing, or provide an explicit valuation assumption where one can responsibly be made.", basedOn: ["unvalued"], evidence: [] };
  const dims = [...PRIMARY_ORDER[context], ...PRIMARY_ORDER.OVERVIEW];
  for (const d of dims) {
    const lead = findings.filter((f) => f.dimension === d).sort(withinDimension)[0];
    if (!lead) continue;
    const c: Conclusion = lead.conclusions[context] ?? { fact: lead.insight.fact, interpretation: lead.insight.interpretation };
    const evidence: EvidenceItem[] = lead.insight.evidence.slice(0, 3);
    return { kind: "PORTFOLIO", context, dimension: d, fact: c.fact, interpretation: c.interpretation, basedOn: [lead.insight.id], evidence };
  }
  return null;
}

export { inspectHref };
