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
    statement: `${q.coverageLine}${q.staleBasisPct !== null && q.staleBasisPct > 0 ? `; ${q.staleBasisPct.toFixed(0)}% of the starting value rests on older evidence` : q.primary === "RECENT_INPUTS" ? "; starting values use recent evidence" : ""}.`,
    staleBasisPct: q.staleBasisPct,
    excluded: q.excluded,
    caution: q.primary !== "RECENT_INPUTS",
  };
  const base = { name, assumptions, quality, byClass: [] as ContributionBar[], byHolding: [] as ContributionBar[], otherHoldings: null, mainClass: null, mainHolding: null, reconciles: p.reconciles, investigations: [] as Investigation[], evidence: [] as EvidenceItem[], startingGhs: h.startingValueGhs, scenarioGhs: h.scenarioValueGhs, impactGhs: h.impactGhs, impactPct: h.impactPct, impactText: h.impactWhole, impactPctText: h.impactPctText, direction: h.direction };

  if (h.status !== "RESULT") return { ...base, status: "NOT_AVAILABLE", fact: h.sentence, interpretation: null };

  const total = p.impactGhs ?? 0;
  const dirSign = Math.sign(total);
  const share = (impact: number) => (dirSign !== 0 && Math.sign(impact) === dirSign ? (impact / total) * 100 : null);
  const byClass: ContributionBar[] = view.byClass.map((c) => ({ id: c.assetClass, label: c.label, sublabel: `${c.positions} ${plural(c.positions, "holding")}`, impactGhs: c.impactGhs, sharePct: c.sharePct, impactText: signedGhsWhole(c.impactGhs), positionId: null }));

  const moved = result.positions
    .filter((r): r is Extract<typeof r, { status: "PARTICIPATING" }> => r.status === "PARTICIPATING" && r.impactGhs !== 0)
    .sort((a, b) => Math.abs(b.impactGhs) - Math.abs(a.impactGhs) || a.label.localeCompare(b.label) || a.positionId.localeCompare(b.positionId));
  const shown = moved.slice(0, MAX_HOLDING_BARS);
  const rest = moved.slice(MAX_HOLDING_BARS);
  const byHolding: ContributionBar[] = shown.map((r) => ({ id: r.positionId, label: r.label, sublabel: view.positions.find((v) => v.positionId === r.positionId)?.assetClassLabel ?? "", impactGhs: r.impactGhs, sharePct: share(r.impactGhs), impactText: signedGhsWhole(r.impactGhs), positionId: r.positionId }));
  const otherSum = rest.reduce((s, r) => s + cents(r.impactGhs), 0) / 100;
  const otherHoldings = rest.length > 0 ? { count: rest.length, impactGhs: otherSum, impactText: signedGhsWhole(otherSum) } : null;

  const mainClass = byClass.filter((c) => c.impactGhs !== 0).sort((a, b) => Math.abs(b.impactGhs) - Math.abs(a.impactGhs) || a.label.localeCompare(b.label))[0] ?? null;
  const mainHolding = byHolding[0] ?? null;

  const investigations: Investigation[] = view.investigations.slice(0, MAX_INVESTIGATIONS).map((i, idx) => ({
    id: `scn-${i.kind}-${i.positionId}-${idx}`,
    kind: i.kind === "RATE_SENSITIVE" ? "SCENARIO_RATE" : i.kind === "STALE_INPUT" ? "SCENARIO_STALE" : i.kind === "MISSING_VALUATION" || i.kind === "REPRICING_ERROR" ? "SCENARIO_EXCLUDED" : "SCENARIO_DRIVER",
    title: `Review ${i.positionLabel}`,
    prompt: `Review ${i.positionLabel}: ${i.headline}`,
    reason: i.why,
    positionId: i.positionId,
    href: i.link && i.link.href !== "#" ? i.link.href : `/portfolios/${portfolioId}?view=holdings&position=${i.positionId}#inspect`,
    evidence: [{ label: i.positionLabel, value: i.title }],
  }));

  const evidence: EvidenceItem[] = [
    { label: "Starting Reference Value", value: h.startingCompact ?? "—" },
    { label: "Value under this scenario", value: h.scenarioCompact ?? "—" },
    { label: "Valuation date", value: formatIsoDate(result.valuationDate) },
    ...assumptions.map((a) => ({ label: "Assumption", value: `${a.technical} — ${a.plain}` })),
  ];

  if (h.direction === "UNCHANGED" || total === 0) {
    return { ...base, status: "NO_CHANGE", byClass, byHolding, otherHoldings, mainClass: null, mainHolding: null, investigations, evidence, fact: `Under ${name}, no holding changes in value, so Reference Value stays at ${h.startingCompact}.`, interpretation: "None of the assumptions reaches a valued holding in this portfolio." };
  }

  const verb = h.direction === "FALL" ? "falls" : "rises";
  const noun = h.direction === "FALL" ? "decline" : "increase";
  const classPart = mainClass && mainClass.sharePct !== null ? ` ${mainClass.label} account for ${mainClass.sharePct.toFixed(0)}% of the ${noun}` : "";
  const holdPart = mainHolding ? `${classPart ? "; " : " "}${mainHolding.label} is the largest single contributor (${mainHolding.impactText})` : "";
  const fact = `Under ${name}, Reference Value ${verb} by about ${ghsCompact(total)} (${signedPct(h.impactPct)}).${classPart}${holdPart}${classPart || holdPart ? "." : ""}`;
  const majority = mainClass && mainClass.sharePct !== null && mainClass.sharePct > 50;
  const rateClass = mainClass && (mainClass.id === "TREASURY_BILL" || mainClass.id === "GOVERNMENT_BOND" || mainClass.id === "CORPORATE_BOND");
  const interpretation = majority ? (rateClass ? `Under these assumptions, interest-rate movements on ${mainClass!.label.toLowerCase()} account for most of the ${noun}.` : `Under these assumptions, the equity price assumption accounts for most of the ${noun}.`) : "Under these assumptions, no single asset class accounts for most of the change.";

  return { ...base, status: "RESULT", byClass, byHolding, otherHoldings, mainClass, mainHolding, investigations, evidence, fact, interpretation };
}
