// ---------------------------------------------------------------------------
// Portfolio decision insights (M9.0). Pure and deterministic: same portfolio →
// same insights, same order, same words. No LLM, no thresholds that call
// anything "dangerous", no recommendation vocabulary.
//
// MATERIALITY. Every candidate is scored 0–100 as a SHARE of something real and
// stated on the insight (`materialityBasis`):
//   asset class / issuer / holding  share of valued Reference Value
//   rate driver                     share of estimated 1-percentage-point rate sensitivity
//   near maturity                   share of contractual fixed-income principal
//   stale evidence                  share of valued Reference Value on stale inputs
// Integrity findings (holdings that cannot be valued) outrank everything: a
// total that silently omits a holding is the first thing to know.
// Ties break on a fixed kind order, then on id — never on insertion order.
// ---------------------------------------------------------------------------

import { ghsCompact, ghsWhole, plural } from "../scenario-studio/format";
import { buildHoldings, buildMaturityProfile, inspectHref, type WorkspaceInput } from "./holdings";
import { MAX_INSIGHTS, MAX_INVESTIGATIONS, NEAR_MATURITY_DAYS, type DecisionInsights, type EvidenceItem, type HoldingView, type Insight, type InsightKind, type Investigation, type PrimaryConclusion } from "./types";

const KIND_ORDER: InsightKind[] = ["UNVALUED_EXPOSURE", "DOMINANT_ASSET_CLASS", "LARGEST_ISSUER", "RATE_DRIVER", "NEAR_MATURITY", "LARGEST_HOLDING", "STALE_EVIDENCE"];
/** Kinds the primary conclusion may be drawn from — structure, not data hygiene. */
const STRUCTURAL: InsightKind[] = ["DOMINANT_ASSET_CLASS", "LARGEST_ISSUER", "RATE_DRIVER", "NEAR_MATURITY", "LARGEST_HOLDING"];

export const fmtPct = (n: number) => `${n.toFixed(n >= 10 || Number.isInteger(n) ? 0 : 1)}%`;
const list = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`);

interface Candidate {
  insight: Insight;
  investigation: Investigation | null;
}

export function buildDecisionInsights(input: WorkspaceInput): DecisionInsights {
  const { summary, exposures } = input;
  if (input.positions.length === 0) return { primary: null, insights: [], investigations: [] };

  const holdings = buildHoldings(input);
  const valued = holdings.filter((h) => h.status === "VALUED");
  const candidates: Candidate[] = [];

  // --- Integrity: holdings that cannot be valued -------------------------------------------------
  const unvalued = holdings.filter((h) => h.status === "UNVALUED");
  if (unvalued.length > 0) {
    const first = unvalued[0];
    candidates.push({
      insight: {
        id: "unvalued",
        kind: "UNVALUED_EXPOSURE",
        materiality: 100,
        materialityBasis: "Data integrity — outranks share-based insights",
        title: "Holdings that cannot be valued",
        fact: `${unvalued.length} ${plural(unvalued.length, "holding")} (${list(unvalued.map((h) => h.label))}) cannot be valued and ${unvalued.length === 1 ? "is" : "are"} left out of every value-based figure.`,
        interpretation: "Totals describe the valued part of the portfolio only. Excluded holdings are not counted as zero.",
        investigationId: "inv-unvalued",
        positionId: first.positionId,
        evidence: unvalued.map((h) => ({ label: h.label, value: h.unvaluedReason ?? "No valuation", href: h.inspectHref })),
      },
      investigation: {
        id: "inv-unvalued",
        kind: "UNVALUED_EXPOSURE",
        title: `Review ${first.label}`,
        prompt: `Review why ${first.label} cannot be valued${unvalued.length > 1 ? ` (and ${unvalued.length - 1} other ${plural(unvalued.length - 1, "holding")})` : ""}.`,
        reason: first.unvaluedReason ?? "No usable valuation input.",
        positionId: first.positionId,
        href: first.inspectHref,
        evidence: [{ label: first.label, value: first.unvaluedReason ?? "No valuation", href: first.inspectHref }],
      },
    });
  }

  if (valued.length > 0) {
    // --- Dominant asset class ---------------------------------------------------------------------
    const classes = exposures.allocation.rows;
    const topClass = [...classes].sort((a, b) => b.pct - a.pct || ORDER.indexOf(a.assetClass) - ORDER.indexOf(b.assetClass))[0];
    if (topClass) {
      const majority = topClass.pct > 50;
      candidates.push({
        insight: {
          id: `class:${topClass.assetClass}`,
          kind: "DOMINANT_ASSET_CLASS",
          materiality: topClass.pct,
          materialityBasis: "Share of valued Reference Value",
          title: "Largest asset class",
          fact: `${topClass.label} are ${fmtPct(topClass.pct)} of valued Reference Value (${ghsCompact(topClass.referenceValueGhs)}).`,
          interpretation: classes.length === 1 ? `The portfolio is invested in a single asset class: ${topClass.label.toLowerCase()}.` : majority ? `More than half of the portfolio is in ${topClass.label.toLowerCase()}, so it is the main driver of overall value.` : `No single asset class holds a majority; ${topClass.label.toLowerCase()} is the largest.`,
          investigationId: majority ? "inv-class" : null,
          positionId: null,
          evidence: classes.map((c) => ({ label: c.label, value: `${fmtPct(c.pct)} · ${ghsWhole(c.referenceValueGhs)}` })),
        },
        investigation: majority
          ? { id: "inv-class", kind: "DOMINANT_ASSET_CLASS", title: `Review the ${topClass.label.toLowerCase()} allocation`, prompt: `Review whether a ${fmtPct(topClass.pct)} allocation to ${topClass.label.toLowerCase()} matches the portfolio's intended mix.`, reason: `${topClass.label} are the majority of valued Reference Value.`, positionId: null, href: `/portfolios/${input.portfolioId}?view=exposure`, evidence: [{ label: topClass.label, value: `${fmtPct(topClass.pct)} of valued Reference Value` }] }
          : null,
      });
    }

    // --- Largest issuer ---------------------------------------------------------------------------
    const topIssuer = exposures.issuers.rows[0];
    if (topIssuer) {
      const majority = topIssuer.pct > 50;
      const issuerHoldings = valued.filter((h) => h.issuerName === topIssuer.issuer.name);
      candidates.push({
        insight: {
          id: `issuer:${topIssuer.issuer.key}`,
          kind: "LARGEST_ISSUER",
          materiality: topIssuer.pct,
          materialityBasis: "Share of valued Reference Value",
          title: "Largest issuer exposure",
          fact: `${topIssuer.issuer.name} is the largest issuer exposure: ${fmtPct(topIssuer.pct)} of valued Reference Value (${ghsCompact(topIssuer.referenceValueGhs)}).`,
          interpretation: topIssuer.valuedCount === 1 ? `The exposure sits in a single holding${issuerHoldings[0] ? ` (${issuerHoldings[0].label})` : ""}.` : `The exposure runs through ${topIssuer.valuedCount} holdings across ${topIssuer.assetClasses.length} ${plural(topIssuer.assetClasses.length, "asset class", "asset classes")}, so it is one issuer's credit and rate environment, not several.`,
          investigationId: majority ? "inv-issuer" : null,
          positionId: topIssuer.valuedCount === 1 && issuerHoldings[0] ? issuerHoldings[0].positionId : null,
          evidence: exposures.issuers.rows.slice(0, 4).map((r) => ({ label: r.issuer.name, value: `${fmtPct(r.pct)} · ${ghsWhole(r.referenceValueGhs)}` })),
        },
        investigation: majority
          ? { id: "inv-issuer", kind: "LARGEST_ISSUER", title: `Review ${topIssuer.issuer.name} exposure`, prompt: `Review whether ${fmtPct(topIssuer.pct)} exposure to ${topIssuer.issuer.name} matches the portfolio's intended exposure.`, reason: `${topIssuer.issuer.name} is the majority of valued Reference Value.`, positionId: null, href: `/portfolios/${input.portfolioId}?view=exposure`, evidence: [{ label: topIssuer.issuer.name, value: `${fmtPct(topIssuer.pct)} of valued Reference Value` }] }
          : null,
      });
    }

    // --- Largest holding (suppressed when the largest issuer already says it) -----------------------
    const top = valued[0];
    const redundant = topIssuer && topIssuer.valuedCount === 1 && topIssuer.issuer.name === top.issuerName;
    if (top && top.weightPct !== null && !redundant) {
      candidates.push({
        insight: {
          id: `holding:${top.positionId}`,
          kind: "LARGEST_HOLDING",
          materiality: top.weightPct,
          materialityBasis: "Share of valued Reference Value",
          title: "Largest holding",
          fact: `${top.label} is the largest holding: ${fmtPct(top.weightPct)} of valued Reference Value (${ghsCompact(top.referenceValueGhs!)}).`,
          interpretation: `One holding accounts for ${fmtPct(top.weightPct)} of the valued portfolio.`,
          investigationId: null,
          positionId: top.positionId,
          evidence: [{ label: top.label, value: `${fmtPct(top.weightPct)} · ${ghsWhole(top.referenceValueGhs!)} · ${top.assetClassLabel}`, href: top.inspectHref }],
        },
        investigation: null,
      });
    }

    // --- Largest rate driver ------------------------------------------------------------------------
    // Rate and maturity shares are shares of the fixed-income sleeve; scaling by the sleeve's share of
    // valued Reference Value puts them on the same whole-portfolio footing as the value-share insights.
    const sleeveHoldings = valued.filter((h) => h.assetClass !== "EQUITY");
    const sleeveFactor = summary.referenceValueGhs ? sleeveHoldings.reduce((s, h) => s + (h.referenceValueGhs ?? 0), 0) / summary.referenceValueGhs : 0;
    const rateHoldings = holdings.filter((h): h is HoldingView & { rate: NonNullable<HoldingView["rate"]> } => h.rate !== null);
    if (rateHoldings.length > 0) {
      const total = rateHoldings.reduce((s, h) => s + h.rate.per1ppGhs, 0);
      const ranked = [...rateHoldings].sort((a, b) => b.rate.per1ppGhs - a.rate.per1ppGhs || a.label.localeCompare(b.label));
      const lead = ranked[0];
      const share = total > 0 ? (lead.rate.per1ppGhs / total) * 100 : 0;
      const what = lead.rate.kind === "BOND_YIELD" ? "yield" : "rate";
      candidates.push({
        insight: {
          id: `rate:${lead.positionId}`,
          kind: "RATE_DRIVER",
          materiality: share * sleeveFactor,
          materialityBasis: "Share of the portfolio's estimated rate sensitivity (rate-sensitive holdings compared on the same 1 percentage-point move, scaled by their share of Reference Value)",
          title: "Largest source of rate sensitivity",
          fact: `${lead.label} is ${ranked.length === 1 ? "the only" : "the largest"} source of rate sensitivity: its value is estimated to change by about ${ghsCompact(lead.rate.per1ppGhs)} for a 1 percentage-point move in its ${what}.`,
          interpretation: ranked.length === 1 ? "No other holding is rate-sensitive." : `It carries ${fmtPct(share)} of the portfolio's estimated rate sensitivity. Bond yields and Treasury-bill rates are measured separately and compared here on the same 1 percentage-point move.`,
          investigationId: `inv-rate`,
          positionId: lead.positionId,
          evidence: [
            { label: "Estimated change per 1 percentage point", value: ghsWhole(lead.rate.per1ppGhs), href: lead.inspectHref },
            { label: "Value change per 0.01 percentage point (DV01)", value: `GHS ${lead.rate.dv01Ghs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: "Rate sensitivity (modified duration)", value: `${lead.rate.modifiedDurationYears.toFixed(2)} years` },
          ],
        },
        investigation: { id: "inv-rate", kind: "RATE_DRIVER", title: `Review ${lead.label}`, prompt: `Review ${lead.label} — it is the portfolio's largest rate-sensitive holding.`, reason: `About ${ghsCompact(lead.rate.per1ppGhs)} of value per 1 percentage-point ${what} move.`, positionId: lead.positionId, href: lead.inspectHref, evidence: [{ label: lead.label, value: `${ghsWhole(lead.rate.per1ppGhs)} per 1 percentage point`, href: lead.inspectHref }] },
      });
    }

    // --- Near maturity ------------------------------------------------------------------------------
    const profile = buildMaturityProfile(input);
    const near = holdings.filter((h) => h.daysToMaturity !== null && h.daysToMaturity <= NEAR_MATURITY_DAYS).sort((a, b) => (a.daysToMaturity! - b.daysToMaturity!) || a.label.localeCompare(b.label));
    if (near.length > 0 && profile.totalNominalGhs > 0) {
      const share = (profile.nearTermNominalGhs / profile.totalNominalGhs) * 100;
      const soonest = near[0];
      candidates.push({
        insight: {
          id: "near-maturity",
          kind: "NEAR_MATURITY",
          materiality: share * sleeveFactor,
          materialityBasis: "Share of contractual fixed-income principal (scaled by the fixed-income share of Reference Value)",
          title: "Maturing soon",
          fact: `${ghsCompact(profile.nearTermNominalGhs)} of principal across ${near.length} ${plural(near.length, "holding")} (${list(near.map((h) => h.label))}) matures within ${NEAR_MATURITY_DAYS} days.`,
          interpretation: `That is ${fmtPct(share)} of the portfolio's contractual fixed-income principal; it will need to be repaid or reinvested.`,
          investigationId: "inv-maturity",
          positionId: soonest.positionId,
          evidence: near.map((h) => ({ label: h.label, value: `matures in ${h.daysToMaturity} days · ${h.sizeText}`, href: h.inspectHref })),
        },
        investigation: { id: "inv-maturity", kind: "NEAR_MATURITY", title: "Review near-term maturities", prompt: `${ghsCompact(profile.nearTermNominalGhs)} matures within ${NEAR_MATURITY_DAYS} days; review upcoming reinvestment needs.`, reason: `${soonest.label} is the soonest, in ${soonest.daysToMaturity} days.`, positionId: soonest.positionId, href: soonest.inspectHref, evidence: near.map((h) => ({ label: h.label, value: `${h.daysToMaturity} days`, href: h.inspectHref })) },
      });
    }

    // --- Stale evidence -----------------------------------------------------------------------------
    const stale = valued.filter((h) => h.quality.recency === "STALE");
    if (stale.length > 0 && summary.stalePct !== null) {
      const lead = stale[0];
      candidates.push({
        insight: {
          id: "stale",
          kind: "STALE_EVIDENCE",
          materiality: summary.stalePct,
          materialityBasis: "Share of valued Reference Value on stale inputs",
          title: "Older valuation evidence",
          fact: `${stale.length} of ${valued.length} valued ${plural(valued.length, "holding")} (${list(stale.map((h) => h.label))}) ${stale.length === 1 ? "rests" : "rest"} on older evidence — ${fmtPct(summary.stalePct)} of valued Reference Value.`,
          interpretation: "Their reference values reflect the last observation, which may not match today's market.",
          investigationId: "inv-stale",
          positionId: lead.positionId,
          evidence: stale.map((h) => ({ label: h.label, value: h.quality.label, href: h.inspectHref })),
        },
        investigation: { id: "inv-stale", kind: "STALE_EVIDENCE", title: `Review ${lead.label} valuation evidence`, prompt: `Review ${lead.label}'s valuation evidence — ${lead.quality.note ?? lead.quality.label}`, reason: lead.quality.label, positionId: lead.positionId, href: lead.inspectHref, evidence: [{ label: lead.label, value: lead.quality.label, href: lead.inspectHref }] },
      });
    }
  }

  // --- Rank, limit, derive -----------------------------------------------------------------------
  const ranked = [...candidates].sort((a, b) => b.insight.materiality - a.insight.materiality || KIND_ORDER.indexOf(a.insight.kind) - KIND_ORDER.indexOf(b.insight.kind) || a.insight.id.localeCompare(b.insight.id));
  const shown = ranked.slice(0, MAX_INSIGHTS);
  const seen = new Set<string>();
  const investigations: Investigation[] = [];
  for (const c of shown) {
    if (!c.investigation || seen.has(c.investigation.id)) continue;
    seen.add(c.investigation.id);
    investigations.push(c.investigation);
    if (investigations.length === MAX_INVESTIGATIONS) break;
  }
  // Insights keep their investigation link only if it survived the limit.
  const insights = shown.map((c) => ({ ...c.insight, investigationId: c.insight.investigationId && investigations.some((i) => i.id === c.insight.investigationId) ? c.insight.investigationId : null }));

  return { primary: primaryConclusion(summary.valuedCount, summary.positionCount, ranked.map((c) => c.insight)), insights, investigations };
}

const ORDER = ["TREASURY_BILL", "GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"];

function primaryConclusion(valuedCount: number, positionCount: number, rankedAll: Insight[]): PrimaryConclusion | null {
  if (positionCount === 0) return null;
  if (valuedCount === 0) return { kind: "NOT_VALUED", fact: `None of the ${positionCount} ${plural(positionCount, "holding")} can be valued yet, so the portfolio has no Reference Value.`, interpretation: "Open a holding to see what its valuation is missing.", basedOn: ["unvalued"], evidence: [] };
  const lead = rankedAll.find((i) => STRUCTURAL.includes(i.kind));
  if (!lead) return null;
  const evidence: EvidenceItem[] = lead.evidence.slice(0, 3);
  return { kind: "PORTFOLIO", fact: lead.fact, interpretation: lead.interpretation, basedOn: [lead.id], evidence };
}

export { inspectHref };
