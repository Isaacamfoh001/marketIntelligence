// ---------------------------------------------------------------------------
// Scenario decision insights (M9.0). Pure. Turns an EXISTING M8.3 result (and
// its M8.4 view) into a conclusion, a contribution breakdown and investigation
// prompts. It reads figures; it never reprices or re-shocks anything.
//
// Language: "under these assumptions" arithmetic only — a scenario is a
// hypothetical, not a forecast, and a contribution is arithmetic, not a cause
// in the market.
// ---------------------------------------------------------------------------

import { formatIsoDate } from "../fixed-income";
import type { OkResult, StudioView } from "../scenario-studio";
import { ghsCompact, plural, signedGhsWhole, signedPct } from "../scenario-studio/format";
import { INVESTIGATION_PRIORITY } from "./portfolio-insights";
import { MAX_INVESTIGATIONS, type EvidenceItem, type Investigation } from "./types";

export interface ContributionBar {
  id: string;
  label: string;
  sublabel: string;
  impactGhs: number;
  /** Share of the total move in the same direction (0–100); null when it moved the other way. */
  sharePct: number | null;
  /** "−GHS 94,120" — explicit sign, never colour alone. */
  impactText: string;
  /** Position id when the bar is one holding. */
  positionId: string | null;
  /** What kind of starting value the contributor used — a contribution from an assumed start must not look as well-evidenced as one from a Korbly valuation. */
  basis: "REFERENCE" | "INDICATIVE" | "ANALYST_ASSUMPTION" | null;
  /** "28.00% yield" when the contributor starts from an analyst assumption. */
  assumptionSummary: string | null;
}

/** How the scenario's starting value splits by valuation basis, for the disclosure beside every result. */
export interface ScenarioBasisView {
  /** "Reference Value" or "Analytical Starting Value". */
  label: string;
  analytical: boolean;
  supportedPct: number | null;
  assumptionPct: number | null;
  supportedGhs: number | null;
  assumptionGhs: number | null;
  assumptionCount: number;
  excludedCount: number;
  /** "76% Korbly-supported · 24% analyst assumptions" — null when there is no starting value. */
  line: string | null;
}

/** Natural basis of the SCENARIO dimension: each contributor's share of the net impact, in the direction of the move. Ranked here, never against another dimension. */
export function rankContributions(bars: ContributionBar[]): ContributionBar[] {
  return [...bars].sort((a, b) => Math.abs(b.impactGhs) - Math.abs(a.impactGhs) || a.label.localeCompare(b.label));
}

export interface ScenarioInsight {
  status: "RESULT" | "NO_CHANGE" | "NOT_AVAILABLE";
  name: string;
  /** The conclusion sentence. */
  fact: string;
  interpretation: string | null;
  assumptions: { technical: string; plain: string }[];
  startingGhs: number | null;
  scenarioGhs: number | null;
  impactGhs: number | null;
  impactPct: number | null;
  impactText: string | null;
  impactPctText: string | null;
  direction: "FALL" | "RISE" | "UNCHANGED";
  byClass: ContributionBar[];
  byHolding: ContributionBar[];
  /** Σ of the holdings not individually shown, so the bars always add to the total. */
  otherHoldings: { count: number; impactGhs: number; impactText: string } | null;
  mainClass: ContributionBar | null;
  mainHolding: ContributionBar | null;
  /** Valuation basis of the starting value this result was applied to. */
  basis: ScenarioBasisView;
  reconciles: boolean;
  quality: { statement: string; staleBasisPct: number | null; excluded: number; caution: boolean };
  investigations: Investigation[];
  evidence: EvidenceItem[];
}

const MAX_HOLDING_BARS = 6;
const cents = (n: number) => Math.round(n * 100);

export function buildScenarioInsight(input: { name: string; portfolioId: string; view: StudioView; result: OkResult }): ScenarioInsight {
  const { name, portfolioId, view, result } = input;
  const p = result.portfolio;
  const h = view.headline;
  const assumptions = view.assumptions.map((a) => ({ technical: a.technical, plain: a.plain }));
  const q = view.confidence;
  const quality = {
    statement: `${q.coverageLine}${q.assumptionLine ? `; ${q.assumptionLine}` : ""}${q.staleBasisPct !== null && q.staleBasisPct > 0 ? `; ${q.staleBasisPct.toFixed(0)}% of the starting value rests on older evidence` : q.primary === "RECENT_INPUTS" ? "; starting values use recent evidence" : ""}.`,
    staleBasisPct: q.staleBasisPct,
    excluded: q.excluded,
    caution: q.primary !== "RECENT_INPUTS",
  };
  const b = p.byBasis;
  const analytical = b.assumption.count > 0;
  const basisView: ScenarioBasisView = {
    label: h.startingLabel,
    analytical,
    supportedPct: p.referenceBasisGhs === null ? null : b.supported.startingPct,
    assumptionPct: p.assumptionBasisPct,
    supportedGhs: p.referenceBasisGhs === null ? null : b.supported.startingValueGhs,
    assumptionGhs: p.referenceBasisGhs === null ? null : b.assumption.startingValueGhs,
    assumptionCount: b.assumption.count,
    excludedCount: p.unvaluedCount,
    line: p.referenceBasisGhs === null || p.assumptionBasisPct === null ? null : analytical ? `${(100 - p.assumptionBasisPct).toFixed(0)}% Korbly-supported · ${p.assumptionBasisPct.toFixed(0)}% analyst assumptions` : "100% Korbly-supported",
  };
  const base = { name, assumptions, quality, basis: basisView, byClass: [] as ContributionBar[], byHolding: [] as ContributionBar[], otherHoldings: null, mainClass: null, mainHolding: null, reconciles: p.reconciles, investigations: [] as Investigation[], evidence: [] as EvidenceItem[], startingGhs: h.startingValueGhs, scenarioGhs: h.scenarioValueGhs, impactGhs: h.impactGhs, impactPct: h.impactPct, impactText: h.impactWhole, impactPctText: h.impactPctText, direction: h.direction };

  if (h.status !== "RESULT") return { ...base, status: "NOT_AVAILABLE", fact: h.sentence, interpretation: null };

  const total = p.impactGhs ?? 0;
  const dirSign = Math.sign(total);
  const share = (impact: number) => (dirSign !== 0 && Math.sign(impact) === dirSign ? (impact / total) * 100 : null);
  const byClass: ContributionBar[] = view.byClass.map((c) => ({ id: c.assetClass, label: c.label, sublabel: `${c.positions} ${plural(c.positions, "holding")}`, impactGhs: c.impactGhs, sharePct: c.sharePct, impactText: signedGhsWhole(c.impactGhs), positionId: null, basis: null, assumptionSummary: null }));

  const moved = result.positions
    .filter((r): r is Extract<typeof r, { status: "PARTICIPATING" }> => r.status === "PARTICIPATING" && r.impactGhs !== 0)
    .sort((a, b) => Math.abs(b.impactGhs) - Math.abs(a.impactGhs) || a.label.localeCompare(b.label) || a.positionId.localeCompare(b.positionId));
  const shown = moved.slice(0, MAX_HOLDING_BARS);
  const rest = moved.slice(MAX_HOLDING_BARS);
  const byHolding: ContributionBar[] = shown.map((r) => ({ id: r.positionId, label: r.label, sublabel: view.positions.find((v) => v.positionId === r.positionId)?.assetClassLabel ?? "", impactGhs: r.impactGhs, sharePct: share(r.impactGhs), impactText: signedGhsWhole(r.impactGhs), positionId: r.positionId, basis: r.basis, assumptionSummary: r.startingAssumption ? r.startingAssumption.summary : null }));
  const otherSum = rest.reduce((s, r) => s + cents(r.impactGhs), 0) / 100;
  const otherHoldings = rest.length > 0 ? { count: rest.length, impactGhs: otherSum, impactText: signedGhsWhole(otherSum) } : null;

  const mainClass = rankContributions(byClass.filter((c) => c.impactGhs !== 0))[0] ?? null;
  const mainHolding = byHolding[0] ?? null;

  // Investigation PRIORITY classes (see INVESTIGATION_PRIORITY): holdings left out first, then a main driver that starts from an
  // analyst assumption, then the rest in the order the studio view produced them.
  const investigations: Investigation[] = view.investigations
    .map((i, idx) => {
      const assumed = i.kind === "LARGEST_DRIVER" && i.dependsOnAssumption === true;
      const excluded = i.kind === "MISSING_VALUATION" || i.kind === "REPRICING_ERROR";
      const priority = excluded ? INVESTIGATION_PRIORITY.UNVALUED : assumed ? INVESTIGATION_PRIORITY.SCENARIO_ASSUMPTION : 10 + idx;
      const out: Investigation = {
        id: `scn-${i.kind}-${i.positionId}-${idx}`,
        kind: i.kind === "RATE_SENSITIVE" ? "SCENARIO_RATE" : i.kind === "STALE_INPUT" ? "SCENARIO_STALE" : excluded ? "SCENARIO_EXCLUDED" : assumed ? "SCENARIO_ASSUMPTION" : "SCENARIO_DRIVER",
        priority,
        title: `Review ${i.positionLabel}`,
        prompt: assumed ? `Review the starting assumption behind ${i.positionLabel}: it is the largest scenario contributor, so this result depends on that assumption.` : `Review ${i.positionLabel}: ${i.headline}`,
        reason: i.why,
        positionId: i.positionId,
        href: i.link && i.link.href !== "#" ? i.link.href : `/portfolios/${portfolioId}?view=holdings&position=${i.positionId}#inspect`,
        evidence: [{ label: i.positionLabel, value: i.title }],
      };
      return { out, idx };
    })
    .sort((a, b) => a.out.priority - b.out.priority || a.idx - b.idx)
    // Excluded holdings are ONE finding ("N holdings left out"), not one prompt each — otherwise several of them would crowd out
    // the prompt that matters most for the result, such as a main driver that starts from an assumption.
    .reduce<{ out: Investigation; idx: number }[]>((acc, x) => {
      if (x.out.kind !== "SCENARIO_EXCLUDED") return [...acc, x];
      const first = acc.find((a) => a.out.kind === "SCENARIO_EXCLUDED");
      if (!first) return [...acc, x];
      first.out.evidence = [...first.out.evidence, ...x.out.evidence];
      return acc;
    }, [])
    .map((x) => {
      if (x.out.kind === "SCENARIO_EXCLUDED" && x.out.evidence.length > 1) x.out.prompt = `${x.out.prompt} (and ${x.out.evidence.length - 1} other excluded ${x.out.evidence.length - 1 === 1 ? "holding" : "holdings"}).`;
      return x;
    })
    .slice(0, MAX_INVESTIGATIONS)
    .map((x) => x.out);

  const evidence: EvidenceItem[] = [
    { label: h.analytical ? h.startingLabel : `Starting ${h.startingLabel}`, value: h.startingCompact ?? "—" },
    ...(basisView.line ? [{ label: "Valuation basis of the starting value", value: basisView.line }] : []),
    { label: "Value under this scenario", value: h.scenarioCompact ?? "—" },
    { label: "Valuation date", value: formatIsoDate(result.valuationDate) },
    ...assumptions.map((a) => ({ label: "Assumption", value: `${a.technical} — ${a.plain}` })),
  ];

  if (h.direction === "UNCHANGED" || total === 0) {
    return { ...base, status: "NO_CHANGE", byClass, byHolding, otherHoldings, mainClass: null, mainHolding: null, investigations, evidence, fact: `Under ${name}, no holding changes in value, so ${h.startingLabel} stays at ${h.startingCompact}.`, interpretation: "None of the assumptions reaches a valued holding in this portfolio." };
  }

  const verb = h.direction === "FALL" ? "falls" : "rises";
  const noun = h.direction === "FALL" ? "decline" : "increase";
  const classPart = mainClass && mainClass.sharePct !== null ? ` ${mainClass.label} account for ${mainClass.sharePct.toFixed(0)}% of the ${noun}` : "";
  const holdPart = mainHolding ? `${classPart ? "; " : " "}${mainHolding.label} is the largest single contributor (${mainHolding.impactText})` : "";
  const fact = `Under ${name}, ${h.startingLabel} ${verb} by about ${ghsCompact(total)} (${signedPct(h.impactPct)}).${classPart}${holdPart}${classPart || holdPart ? "." : ""}`;
  const majority = mainClass && mainClass.sharePct !== null && mainClass.sharePct > 50;
  const rateClass = mainClass && (mainClass.id === "TREASURY_BILL" || mainClass.id === "GOVERNMENT_BOND" || mainClass.id === "CORPORATE_BOND");
  const driverAssumed = mainHolding && mainHolding.basis === "ANALYST_ASSUMPTION" && mainHolding.assumptionSummary;
  const interpretationCore = majority ? (rateClass ? `Under these assumptions, interest-rate movements on ${mainClass!.label.toLowerCase()} account for most of the ${noun}.` : `Under these assumptions, the equity price assumption accounts for most of the ${noun}.`) : "Under these assumptions, no single asset class accounts for most of the change.";

  const interpretation = `${interpretationCore}${driverAssumed ? ` ${mainHolding!.label} is the largest contributor, and its starting valuation uses an analyst-supplied ${mainHolding!.assumptionSummary} — so this result depends on that assumption.` : analytical ? ` ${basisView.assumptionPct!.toFixed(0)}% of the starting value rests on analyst assumptions.` : ""}`;
  return { ...base, status: "RESULT", byClass, byHolding, otherHoldings, mainClass, mainHolding, investigations, evidence, fact, interpretation };
}
