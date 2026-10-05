// ---------------------------------------------------------------------------
// Scenario comparison view-model (M8.4). Pure.
//
// Compares up to three scenario RESULTS that the caller computed in ONE
// request against ONE portfolio snapshot (one valuation date, one set of
// reference valuations). This module verifies that — if the results do not
// share a starting basis it says so instead of presenting a clean comparison.
// ---------------------------------------------------------------------------

import { EXPOSURE_ASSET_CLASS_LABEL, EXPOSURE_ASSET_CLASS_ORDER, type ExposureAssetClass } from "../portfolio";
import { selectorIdentity, type ScenarioShockRule } from "../scenarios";
import { COMPARED_SAME_INPUTS, type OkResult } from "./view-model";
import { ghsCompact, ghsWhole, plural, signedGhsWhole, signedPct } from "./format";
import { LEVEL_LABEL, technicalLabel } from "./language";

export const MAX_COMPARED = 3;
export const MIN_COMPARED = 2;

export interface CompareInput {
  id: string;
  name: string;
  result: OkResult;
}

export interface CompareClassCell {
  assetClass: ExposureAssetClass;
  label: string;
  /** The assumption in effect for this class at class level, e.g. "+100 bps" — or null when none was set. */
  assumption: string | null;
  impactGhs: number;
}

export interface CompareColumn {
  id: string;
  name: string;
  /** The class-level assumptions, per class. */
  classAssumptions: Record<ExposureAssetClass, string | null>;
  startingValueGhs: number | null;
  scenarioValueGhs: number | null;
  impactGhs: number | null;
  impactPct: number | null;
  scenarioValueText: string;
  impactText: string;
  impactPctText: string;
  mainClassDriver: string | null;
  largestPosition: string | null;
  largestPositionImpactText: string | null;
  staleBasisPct: number | null;
  /** Share of this scenario's net impact that comes from holdings whose input is stale. */
  staleImpactSharePct: number | null;
  excludedCount: number;
  repricingErrors: number;
  classImpacts: CompareClassCell[];
  /** 1 = the largest decline (or smallest gain). */
  rank: number;
}

/** One semantic assumption (a target in a domain), with one cell per compared scenario in column order. */
export interface AssumptionRow {
  /** Engine identity: ASSET_CLASS|<class>, ISSUER|<issuerKey>|<type>, SECURITY|<BOND|EQUITY>|<id>. Never positional. */
  key: string;
  level: "ASSET_CLASS" | "ISSUER" | "SECURITY";
  levelLabel: string;
  /** One canonical label per key, the same for every column. */
  label: string;
  /** "+100 bps" / "0%" for a stated assumption (an explicit zero is a stated assumption); null = no assumption at this level. */
  cells: (string | null)[];
}

export const NO_ASSUMPTION_TEXT = "No specific assumption at this level.";

export interface Comparison {
  /** True only when every scenario starts from the same valuation date and starting value. */
  commonBasis: boolean;
  valuationDate: string | null;
  startingValueGhs: number | null;
  basisNote: string;
  columns: CompareColumn[];
  /** Assumptions aligned by semantic identity across all columns. */
  assumptionRows: AssumptionRow[];
  /** "Which view hurts more, and why". */
  summary: string[];
  /** Largest absolute class impact across all columns — for scaling bars. */
  maxAbsClassImpact: number;
}

const classAssumption = (rules: ScenarioShockRule[], c: ExposureAssetClass): string | null => {
  const r = rules.find((x) => x.selector.kind === "ASSET_CLASS" && x.selector.assetClass === c);
  return r ? technicalLabel(r) : null;
};

function column(input: CompareInput): Omit<CompareColumn, "rank"> {
  const { result } = input;
  const p = result.portfolio;
  const sign = p.impactGhs === null || p.impactGhs === 0 ? 0 : Math.sign(p.impactGhs);
  const sameWayClasses = p.byAssetClass.filter((c) => sign !== 0 && Math.sign(c.impactGhs) === sign);
  const mainClass = sameWayClasses.sort((a, b) => sign * (b.impactGhs - a.impactGhs))[0];
  const topPos = (sign < 0 ? p.largestNegative : sign > 0 ? p.largestPositive : [])[0];
  return {
    id: input.id,
    name: input.name,
    classAssumptions: Object.fromEntries(EXPOSURE_ASSET_CLASS_ORDER.map((c) => [c, classAssumption(result.rules, c)])) as Record<ExposureAssetClass, string | null>,
    startingValueGhs: p.referenceBasisGhs,
    scenarioValueGhs: p.scenarioValueGhs,
    impactGhs: p.impactGhs,
    impactPct: p.impactPct,
    scenarioValueText: p.scenarioValueGhs === null ? "—" : ghsCompact(p.scenarioValueGhs),
    impactText: p.impactGhs === null ? "—" : signedGhsWhole(p.impactGhs),
    impactPctText: signedPct(p.impactPct),
    mainClassDriver: mainClass ? EXPOSURE_ASSET_CLASS_LABEL[mainClass.assetClass] : null,
    largestPosition: topPos ? topPos.label : null,
    largestPositionImpactText: topPos ? signedGhsWhole(topPos.impactGhs) : null,
    staleBasisPct: p.staleBasisPct,
    staleImpactSharePct: p.impactGhs !== null && p.impactGhs !== 0 ? (p.staleBasis.impactGhs / p.impactGhs) * 100 : null,
    excludedCount: p.unvaluedCount,
    repricingErrors: p.scenarioErrorCount,
    classImpacts: p.byAssetClass.map((c) => ({ assetClass: c.assetClass, label: EXPOSURE_ASSET_CLASS_LABEL[c.assetClass], assumption: classAssumption(result.rules, c.assetClass), impactGhs: c.impactGhs })),
  };
}

const LEVEL_ORDER = { ASSET_CLASS: 0, ISSUER: 1, SECURITY: 2 } as const;

/** Canonical row label: fixed for asset classes; otherwise the alphabetically first label any scenario used, so a differing source label can never split one identity into two rows. */
function canonicalLabel(rule: ScenarioShockRule, labels: string[]): string {
  if (rule.selector.kind === "ASSET_CLASS") return EXPOSURE_ASSET_CLASS_LABEL[rule.selector.assetClass];
  const base = [...labels].sort((a, b) => a.localeCompare(b))[0];
  return rule.selector.kind === "ISSUER" ? `${base} \u2014 ${rule.shockType === "YIELD_BPS" ? "bonds" : "equity"}` : base;
}

export function buildAssumptionRows(inputs: CompareInput[]): AssumptionRow[] {
  const rows = new Map<string, { rule: ScenarioShockRule; labels: Set<string>; cells: (string | null)[] }>();
  inputs.forEach((input, col) => {
    for (const rule of input.result.rules) {
      const key = selectorIdentity(rule);
      const row = rows.get(key) ?? { rule, labels: new Set<string>(), cells: inputs.map(() => null) };
      row.labels.add(rule.targetLabel);
      row.cells[col] = technicalLabel(rule);
      rows.set(key, row);
    }
  });
  return [...rows.entries()]
    .map(([key, r]) => ({ key, level: r.rule.selector.kind, levelLabel: LEVEL_LABEL[r.rule.selector.kind], label: canonicalLabel(r.rule, [...r.labels]), cells: r.cells }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.level === "ASSET_CLASS" ? EXPOSURE_ASSET_CLASS_ORDER.findIndex((c) => `ASSET_CLASS|${c}` === a.key) - EXPOSURE_ASSET_CLASS_ORDER.findIndex((c) => `ASSET_CLASS|${c}` === b.key) : a.label.localeCompare(b.label) || a.key.localeCompare(b.key)));
}

export function buildComparison(inputs: CompareInput[]): Comparison {
  const cols = inputs.map(column);
  const dates = new Set(inputs.map((i) => i.result.valuationDate));
  const bases = new Set(inputs.map((i) => i.result.portfolio.m81ValuedReferenceValueGhs));
  const participating = new Set(inputs.map((i) => i.result.portfolio.referenceBasisGhs));
  // Starting ASSUMPTIONS are part of the basis (M9.0.1): two results with the same total but different assumed yields did not start
  // from the same place, so they must not be presented as "only the shocks differ".
  const assumptionSets = new Set(inputs.map((i) => i.result.portfolio.startingBasisFingerprint));
  const sameAssumptions = assumptionSets.size === 1;
  const commonBasis = dates.size === 1 && bases.size === 1 && participating.size === 1 && sameAssumptions;

  const ranked = [...cols].sort((a, b) => (a.impactGhs ?? 0) - (b.impactGhs ?? 0) || a.name.localeCompare(b.name));
  const columns: CompareColumn[] = cols.map((c) => ({ ...c, rank: ranked.findIndex((r) => r.id === c.id) + 1 }));

  const summary: string[] = [];
  const withImpact = ranked.filter((c) => c.impactGhs !== null);
  if (withImpact.length >= 2) {
    const worst = withImpact[0];
    const mildest = withImpact[withImpact.length - 1];
    if (worst.impactGhs === mildest.impactGhs) {
      summary.push("These views have the same scenario impact on the valued portfolio.");
    } else {
      const gap = Math.abs((mildest.impactGhs ?? 0) - (worst.impactGhs ?? 0));
      summary.push(`"${worst.name}" has the larger effect on the valued portfolio: ${worst.impactText} (${worst.impactPctText}) versus ${mildest.impactText} (${mildest.impactPctText}) for "${mildest.name}" — a difference of ${ghsWhole(gap)}.`);
      const diffs = EXPOSURE_ASSET_CLASS_ORDER.map((c) => {
        const w = worst.classImpacts.find((x) => x.assetClass === c)?.impactGhs ?? 0;
        const m = mildest.classImpacts.find((x) => x.assetClass === c)?.impactGhs ?? 0;
        return { c, diff: w - m };
      })
        .filter((d) => d.diff !== 0)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      const top = diffs[0];
      if (top) summary.push(`Most of that difference comes from ${EXPOSURE_ASSET_CLASS_LABEL[top.c].toLowerCase()}: ${signedGhsWhole(worst.classImpacts.find((x) => x.assetClass === top.c)!.impactGhs)} under "${worst.name}" versus ${signedGhsWhole(mildest.classImpacts.find((x) => x.assetClass === top.c)!.impactGhs)} under "${mildest.name}".`);
      if (worst.mainClassDriver && mildest.mainClassDriver && worst.mainClassDriver !== mildest.mainClassDriver) summary.push(`The main driver differs: ${worst.mainClassDriver.toLowerCase()} lead under "${worst.name}", ${mildest.mainClassDriver.toLowerCase()} under "${mildest.name}".`);
    }
  }
  const staleVals = new Set(cols.map((c) => c.staleBasisPct));
  if (cols.some((c) => (c.staleBasisPct ?? 0) > 0) && staleVals.size === 1) summary.push(`${(cols[0].staleBasisPct ?? 0).toFixed(1)}% of the starting value rests on stale reference observations in every view, because all views use the same inputs.`);

  const first = inputs[0]?.result;
  const maxAbs = Math.max(0, ...columns.flatMap((c) => c.classImpacts.map((x) => Math.abs(x.impactGhs))));
  return {
    commonBasis,
    valuationDate: commonBasis && first ? first.valuationDate : null,
    startingValueGhs: commonBasis && first ? first.portfolio.referenceBasisGhs : null,
    basisNote: commonBasis
      ? first && first.portfolio.byBasis.assumption.count > 0
        ? `${COMPARED_SAME_INPUTS} Every view uses the same ${first.portfolio.byBasis.assumption.count} starting valuation ${plural(first.portfolio.byBasis.assumption.count, "assumption")}, so only the scenario assumptions differ.`
        : COMPARED_SAME_INPUTS
      : !sameAssumptions && dates.size === 1 && bases.size === 1 && participating.size === 1
        ? "These views start from different valuation assumptions, so differences do not come only from the scenario assumptions. Compare them only after aligning the starting assumptions."
        : !sameAssumptions
          ? `These views do not share an identical starting basis (${plural(dates.size, "valuation date")}: ${[...dates].join(", ")}) and their starting valuation assumptions differ. Differences may not come only from the scenario assumptions — treat this comparison with caution.`
          : `These views do not share an identical starting basis (${plural(dates.size, "valuation date")}: ${[...dates].join(", ")}). Differences may not come only from the assumptions — treat this comparison with caution.`,
    columns,
    assumptionRows: buildAssumptionRows(inputs),
    summary,
    maxAbsClassImpact: maxAbs,
  };
}
