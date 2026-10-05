// ---------------------------------------------------------------------------
// Deterministic factual explanations (M8.3). Plain templates over the result
// the engine already computed — no recommendations, no probabilities, no LLM.
// Wording is conditional ("were increased by", "if these assumptions held"),
// never predictive.
// ---------------------------------------------------------------------------

import { GOVERNMENT_OF_GHANA } from "../treasury-bills";
import type { ParticipatingPositionResult, ScenarioPortfolioResult, ScenarioPositionResult, ScenarioShockRule } from "./types";

const fmtGhs = (n: number) => `GHS ${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** "were increased by 200 bps" / "were decreased by 10%" / "were left unchanged (0 bps)". */
export function describeShockChange(rule: Pick<ScenarioShockRule, "shockType" | "value">, plural: boolean): string {
  const unit = rule.shockType === "YIELD_BPS" ? " bps" : "%";
  const be = plural ? "were" : "was";
  if (rule.value === 0) return `${be} explicitly held unchanged (0${unit})`;
  return `${be} ${rule.value > 0 ? "increased" : "decreased"} by ${fmtNum(rule.value)}${unit}`;
}

const ASSET_CLASS_SUBJECT = { TREASURY_BILL: "Treasury-bill rates", GOVERNMENT_BOND: "Government bond yields", CORPORATE_BOND: "Corporate bond yields", EQUITY: "Equity prices" } as const;

export function describeRule(rule: ScenarioShockRule): string {
  const noun = rule.shockType === "YIELD_BPS" ? "yield / rate" : "price";
  const plural = rule.selector.kind === "ASSET_CLASS";
  const subject = rule.selector.kind === "ASSET_CLASS" ? ASSET_CLASS_SUBJECT[rule.selector.assetClass] : rule.selector.kind === "ISSUER" ? `${rule.targetLabel} ${rule.shockType === "YIELD_BPS" ? (rule.targetLabel === GOVERNMENT_OF_GHANA ? "bond yields and Treasury-bill rates" : "bond yields") : "equity price"}` : `${rule.targetLabel} ${noun}`;
  const issuerPlural = rule.selector.kind === "ISSUER" && rule.shockType === "YIELD_BPS";
  return `${subject} ${describeShockChange(rule, plural || issuerPlural)}.`;
}

export function explainScenario(rules: ScenarioShockRule[], positions: ScenarioPositionResult[], p: ScenarioPortfolioResult): string[] {
  const out: string[] = [];
  if (rules.length === 0) out.push("This scenario has no assumptions, so every valued position is unchanged.");
  for (const r of rules) out.push(describeRule(r));

  for (const pos of positions) {
    if (pos.status !== "PARTICIPATING" || pos.resolution.matchedRules.length < 2 || !pos.resolution.winner) continue;
    const w = pos.resolution.winner;
    const lower = pos.resolution.matchedRules.slice(1).map((r) => `${r.targetLabel} ${r.value > 0 ? "+" : ""}${r.value}${r.shockType === "YIELD_BPS" ? "bps" : "%"}`).join(", ");
    out.push(`${pos.label} used the ${w.selector.kind === "SECURITY" ? "security-specific" : "issuer-specific"} ${w.value > 0 ? "+" : ""}${w.value}${w.shockType === "YIELD_BPS" ? "bps" : "%"} assumption instead of ${lower}.`);
  }

  if (p.impactGhs !== null && p.referenceBasisGhs !== null) {
    const n = `${p.participatingCount} valued position${p.participatingCount === 1 ? "" : "s"}`;
    out.push(
      p.impactGhs === 0
        ? `If these assumptions held, the scenario value of the ${n} would equal their reference value (no change).`
        : `If these assumptions held, the scenario value of the ${n} would be ${fmtGhs(p.impactGhs)} ${p.impactGhs < 0 ? "lower" : "higher"} than their reference value.`,
    );
  }
  const top: ParticipatingPositionResult[] = p.largestNegative.slice(0, 3);
  if (top.length > 0) {
    const sum = top.reduce((s, x) => s + x.impactGhs, 0);
    out.push(`${top.length} position${top.length === 1 ? "" : "s"} (${top.map((x) => x.label).join(", ")}) account${top.length === 1 ? "s" : ""} for ${fmtGhs(sum)} of negative scenario impact.`);
  }
  if (p.unvaluedCount > 0) out.push(`${p.unvaluedCount} unvalued position${p.unvaluedCount === 1 ? " is" : "s are"} excluded from the scenario result — there is no reference value to start from.`);
  if (p.scenarioErrorCount > 0) out.push(`${p.scenarioErrorCount} valued position${p.scenarioErrorCount === 1 ? "" : "s"} could not be repriced under these assumptions and ${p.scenarioErrorCount === 1 ? "is" : "are"} excluded.`);
  if (p.staleBasisPct !== null && p.staleBasis.count > 0) out.push(`${p.staleBasisPct.toFixed(0)}% of the scenario reference basis rests on stale market inputs; applying an assumption does not make those inputs current.`);
  return out;
}
