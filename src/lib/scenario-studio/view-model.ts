// ---------------------------------------------------------------------------
// Scenario Studio view-model (M8.4). Pure — no I/O, no React, no Prisma.
//
// Interprets an EXISTING M8.3 ScenarioResult into human-facing structure. It
// NEVER recomputes a financial result: every money figure, yield, price,
// impact, stale share and DV01 is read straight off the result. The only
// numbers derived here are presentation ratios (a class's share of the total
// move, a stale holding's share of gross movement) used to choose and phrase
// what to show — and they are computed from the result's own figures.
//
// Language rules: describe assumptions and arithmetic consequences only. No
// recommendation, probability, forecast or value-judgement wording.
// ---------------------------------------------------------------------------

import { formatIsoDate } from "../fixed-income";
import { EXPOSURE_ASSET_CLASS_LABEL, type ExposureAssetClass } from "../portfolio";
import type { ParticipatingPositionResult, ScenarioResult, ScenarioShockRule, UnavailablePositionResult } from "../scenarios";
import { countWord, ghsCompact, ghsExact, ghsWhole, plural, signedGhsExact, signedGhsWhole, signedPct, signOf } from "./format";
import { describeAssumptionPlain, LEVEL_LABEL, shortAssumption, technicalLabel } from "./language";

export type OkResult = Extract<ScenarioResult, { ok: true }>;

export const HYPOTHETICAL_NOTICE = "Hypothetical scenario — not a forecast.";
export const ESTIMATE_NOTICE = "Scenario values are analytical estimates, not executable market quotes.";
export const REFERENCE_INPUTS_NOTE = "Calculated using current reference inputs.";
export const COMPARED_SAME_INPUTS = "Compared using the same current reference inputs.";
export const STARTING_VALUE_HELP = "The value Korbly uses before applying this scenario.";
export const EXCLUSION_PRINCIPLE = "Korbly would rather exclude a holding than make up a number.";

/** A stale holding is worth a look when it carries at least this share of the gross scenario movement. */
export const MATERIAL_GROSS_SHARE_PCT = 10;
export const MAX_INVESTIGATIONS = 5;

/** Where the analyst can go next for a position. Supplied by the query layer from the routes that really exist — the view-model never invents a URL. */
export interface PositionLink {
  href: string;
  label: string;
}
export interface PositionLinks {
  /** Instrument/company analysis page (fixed-income security, company). */
  analysis: PositionLink | null;
  /** The underlying market evidence for the observation behind the value. */
  evidence: PositionLink | null;
  /** The portfolio's own position inspector — always exists. */
  inspect: PositionLink;
}

export interface Provenance {
  sourceName: string;
  ingestionRunId: string;
  retrievedAt: string;
  facts: { label: string; value: string }[];
}

export interface StudioInputs {
  result: OkResult;
  links: Record<string, PositionLinks>;
  provenance: Record<string, Provenance | null>;
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type MoveDirection = "FALL" | "RISE" | "UNCHANGED";

export interface HeadlineView {
  status: "RESULT" | "NO_VALUED_POSITIONS" | "NO_POSITIONS";
  startingValueGhs: number | null;
  scenarioValueGhs: number | null;
  impactGhs: number | null;
  impactPct: number | null;
  direction: MoveDirection;
  /** "Under these assumptions, the valued portfolio falls by 5.75% (about GHS 394,866)." */
  sentence: string;
  startingCompact: string | null;
  scenarioCompact: string | null;
  impactWhole: string | null;
  impactPctText: string | null;
}

export interface AssumptionView {
  id: string;
  levelLabel: string;
  targetLabel: string;
  technical: string;
  plain: string;
  /** How many holdings this assumption is the one that applies to. */
  appliesTo: number;
  /** "Replaces the broader … assumption for this holding" — specific rules override, never add. */
  replacesNote: string | null;
  /** When nothing in the portfolio is reached by it. */
  noEffectNote: string | null;
}

export interface ClassDriver {
  assetClass: ExposureAssetClass;
  label: string;
  impactGhs: number;
  impactPct: number | null;
  /** Share of the total move in the same direction (0–100); null when this class did not move that way. */
  sharePct: number | null;
  positions: number;
}

export interface PositionDriver {
  positionId: string;
  label: string;
  assetClassLabel: string;
  impactGhs: number;
  sharePct: number | null;
}

export type ConfidenceFlagCode = "REPRICING_ERROR" | "INCOMPLETE" | "STALE_DEPENDENCE" | "RECENT_INPUTS";
export interface ConfidenceFlag {
  code: ConfidenceFlagCode;
  label: string;
  message: string;
}
export interface ConfidenceView {
  primary: ConfidenceFlagCode;
  flags: ConfidenceFlag[];
  /** "5 of 6 positions included" */
  coverageLine: string;
  /** "GHS 6.87m valued" or null when nothing is valued. */
  valuedLine: string | null;
  staleLine: string | null;
  staleBasisPct: number | null;
  excludedLine: string | null;
  included: number;
  total: number;
  excluded: number;
  repricingErrors: number;
}

export type InvestigationKind = "LARGEST_DRIVER" | "RATE_SENSITIVE" | "STALE_INPUT" | "MISSING_VALUATION" | "REPRICING_ERROR" | "SPECIFIC_ASSUMPTION";
export interface InvestigationItem {
  kind: InvestigationKind;
  title: string;
  positionId: string;
  positionLabel: string;
  headline: string;
  why: string;
  link: PositionLink | null;
}

export interface TechRow {
  label: string;
  value: string;
  /** Plain-English gloss for the technical term. */
  note?: string;
}
export interface TechGroup {
  title: string;
  rows: TechRow[];
}

export interface PositionView {
  positionId: string;
  label: string;
  assetClassLabel: string;
  status: "PARTICIPATING" | "UNAVAILABLE";
  outcome: "SHOCKED" | "UNCHANGED" | null;
  recency: "RECENT" | "STALE" | null;
  /** "Government bond yields rise by 2.0 percentage points" — or why nothing applies. */
  assumptionPlain: string;
  startingGhs: number | null;
  scenarioGhs: number | null;
  impactGhs: number | null;
  impactPct: number | null;
  startingText: string | null;
  scenarioText: string | null;
  impactText: string | null;
  impactPctText: string | null;
  /** Simple, non-technical explanation — paragraphs. */
  simple: string[];
  /** The plain freshness sentence for a stale input; null when recent. */
  freshnessNote: string | null;
  technical: TechGroup[];
  links: PositionLinks;
}

export interface MethodologyStatement {
  text: string;
}

export interface StudioView {
  headline: HeadlineView;
  assumptions: AssumptionView[];
  byClass: ClassDriver[];
  mainClass: ClassDriver | null;
  topPositions: PositionDriver[];
  confidence: ConfidenceView;
  meaning: string[];
  investigations: InvestigationItem[];
  positions: PositionView[];
  /** The tag line that must stay visible beside any result. */
  notices: string[];
}

export const METHODOLOGY: MethodologyStatement[] = [
  { text: "This scenario is hypothetical, not a forecast. It shows the arithmetic effect of assumptions you chose." },
  { text: "Starting values come from each holding's Reference Value on the portfolio page (the most recent reliable observed input)." },
  { text: "Bonds are repriced by full cash-flow repricing at the scenario yield, on the same valuation date." },
  { text: "Equities apply the explicit percentage assumption to the reference price." },
  { text: "A security-specific assumption overrides an issuer assumption, which overrides an asset-class assumption." },
  { text: "Rules replace each other; they never stack." },
  { text: "Stale observations remain stale — an assumption does not make an old input current." },
  { text: "Holdings without a reliable starting value are excluded, not estimated." },
  { text: "Results are scenario estimates, not executable liquidation prices." },
];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

type Participating = ParticipatingPositionResult;
const isPart = (p: OkResult["positions"][number]): p is Participating => p.status === "PARTICIPATING";
const isUnavail = (p: OkResult["positions"][number]): p is UnavailablePositionResult => p.status === "UNAVAILABLE";

const dirOf = (impact: number | null): MoveDirection => (impact === null || impact === 0 ? "UNCHANGED" : impact < 0 ? "FALL" : "RISE");
const NOUN: Record<Exclude<MoveDirection, "UNCHANGED">, string> = { FALL: "decline", RISE: "increase" };

const num6 = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const num4 = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pct4 = (n: number) => `${n.toFixed(4)}%`;
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const intFmt = (n: number) => n.toLocaleString("en-GB");
const age = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day old" : `${days} days old`);

/** Presentation ratio: part ÷ whole × 100, null when the whole is zero. */
const ratioPct = (part: number, whole: number): number | null => (whole === 0 ? null : (part / whole) * 100);

export const STALE_SENTENCE = "The latest reliable market observation for this holding is older than our freshness threshold.";
export const UNVALUED_SENTENCE = "We do not have a sufficiently reliable reference value for this holding, so it is excluded rather than estimated.";

// --------------------------------------------------------------------------
// Assumptions
// --------------------------------------------------------------------------

function buildAssumptions(result: OkResult): AssumptionView[] {
  const winnersOf = new Map<string, Participating[]>();
  const reachedBy = new Map<string, number>();
  for (const p of result.positions) {
    for (const m of p.resolution.matchedRules) reachedBy.set(m.id, (reachedBy.get(m.id) ?? 0) + 1);
    if (isPart(p) && p.resolution.winner) winnersOf.set(p.resolution.winner.id, [...(winnersOf.get(p.resolution.winner.id) ?? []), p]);
  }
  return result.rules.map((rule): AssumptionView => {
    const winners = winnersOf.get(rule.id) ?? [];
    const overridden = new Map<string, ScenarioShockRule>();
    for (const w of winners) for (const m of w.resolution.matchedRules.slice(1)) overridden.set(m.id, m);
    let replacesNote: string | null = null;
    if (overridden.size > 0) {
      const names = [...overridden.values()].map((m) => `${m.targetLabel} (${technicalLabel(m)})`).join(", ");
      const where = winners.length === 1 ? winners[0].label : `${winners.length} holdings`;
      replacesNote = `For ${where}, this replaces the broader ${names} assumption — it does not add to it.`;
    }
    const reached = reachedBy.get(rule.id) ?? 0;
    const noEffectNote = reached === 0 ? "No holding in this portfolio is reached by this assumption." : winners.length === 0 ? "A more specific assumption applies to every holding this one reaches." : null;
    return { id: rule.id, levelLabel: LEVEL_LABEL[rule.selector.kind], targetLabel: rule.targetLabel, technical: technicalLabel(rule), plain: describeAssumptionPlain(rule), appliesTo: winners.length, replacesNote, noEffectNote };
  });
}

// --------------------------------------------------------------------------
// Headline
// --------------------------------------------------------------------------

function buildHeadline(result: OkResult): HeadlineView {
  const p = result.portfolio;
  if (p.positionCount === 0) {
    return { status: "NO_POSITIONS", startingValueGhs: null, scenarioValueGhs: null, impactGhs: null, impactPct: null, direction: "UNCHANGED", sentence: "This portfolio has no positions yet, so there is nothing to test.", startingCompact: null, scenarioCompact: null, impactWhole: null, impactPctText: null };
  }
  if (p.referenceBasisGhs === null || p.scenarioValueGhs === null || p.impactGhs === null) {
    return { status: "NO_VALUED_POSITIONS", startingValueGhs: null, scenarioValueGhs: null, impactGhs: null, impactPct: null, direction: "UNCHANGED", sentence: "No holding has a sufficiently reliable reference value, so there is no scenario result. Korbly excludes holdings it cannot value rather than estimating them.", startingCompact: null, scenarioCompact: null, impactWhole: null, impactPctText: null };
  }
  const direction = dirOf(p.impactGhs);
  const pctTxt = p.impactPct === null ? null : `${Math.abs(p.impactPct).toFixed(2)}%`;
  const sentence =
    direction === "UNCHANGED"
      ? "Under these assumptions, the valued portfolio is unchanged."
      : `Under these assumptions, the valued portfolio ${direction === "FALL" ? "falls" : "rises"}${pctTxt ? ` by ${pctTxt}` : ""} (about ${ghsWhole(p.impactGhs)}).`;
  return {
    status: "RESULT",
    startingValueGhs: p.referenceBasisGhs,
    scenarioValueGhs: p.scenarioValueGhs,
    impactGhs: p.impactGhs,
    impactPct: p.impactPct,
    direction,
    sentence,
    startingCompact: ghsCompact(p.referenceBasisGhs),
    scenarioCompact: ghsCompact(p.scenarioValueGhs),
    impactWhole: signedGhsWhole(p.impactGhs),
    impactPctText: signedPct(p.impactPct),
  };
}

// --------------------------------------------------------------------------
// Drivers
// --------------------------------------------------------------------------

function buildDrivers(result: OkResult, direction: MoveDirection) {
  const p = result.portfolio;
  const sign = direction === "FALL" ? -1 : direction === "RISE" ? 1 : 0;
  const sameWay = (n: number) => sign !== 0 && Math.sign(n) === sign;
  const grossSameWay = p.byAssetClass.filter((c) => sameWay(c.impactGhs)).reduce((s, c) => s + c.impactGhs, 0);
  const byClass: ClassDriver[] = p.byAssetClass
    .filter((c) => c.participatingCount > 0)
    .map((c) => ({ assetClass: c.assetClass, label: EXPOSURE_ASSET_CLASS_LABEL[c.assetClass], impactGhs: c.impactGhs, impactPct: c.impactPct, sharePct: sameWay(c.impactGhs) ? ratioPct(c.impactGhs, grossSameWay) : null, positions: c.participatingCount }))
    .sort((a, b) => (sign === 0 ? Math.abs(b.impactGhs) - Math.abs(a.impactGhs) : sign * (b.impactGhs - a.impactGhs)) || a.label.localeCompare(b.label));
  const mainClass = byClass.find((c) => sameWay(c.impactGhs)) ?? null;

  const part = result.positions.filter(isPart);
  const grossPos = part.filter((x) => sameWay(x.impactGhs)).reduce((s, x) => s + x.impactGhs, 0);
  const topPositions: PositionDriver[] = part
    .filter((x) => sameWay(x.impactGhs))
    .sort((a, b) => sign * (b.impactGhs - a.impactGhs) || a.label.localeCompare(b.label))
    .slice(0, 5)
    .map((x) => ({ positionId: x.positionId, label: x.label, assetClassLabel: EXPOSURE_ASSET_CLASS_LABEL[x.assetClass], impactGhs: x.impactGhs, sharePct: ratioPct(x.impactGhs, grossPos) }));
  return { byClass, mainClass, topPositions, sameWay };
}

// --------------------------------------------------------------------------
// Confidence
// --------------------------------------------------------------------------

function buildConfidence(result: OkResult): ConfidenceView {
  const p = result.portfolio;
  const excluded = p.unvaluedCount;
  const included = p.participatingCount;
  const flags: ConfidenceFlag[] = [];
  if (p.scenarioErrorCount > 0) flags.push({ code: "REPRICING_ERROR", label: "Repricing error", message: `${countWord(p.scenarioErrorCount)} valued ${plural(p.scenarioErrorCount, "position")} could not be repriced under these assumptions and ${p.scenarioErrorCount === 1 ? "is" : "are"} excluded.` });
  if (excluded > 0) flags.push({ code: "INCOMPLETE", label: "Incomplete", message: `${countWord(excluded)} ${plural(excluded, "holding is", "holdings are")} excluded because Korbly does not have a sufficiently reliable reference value.` });
  const stalePct = p.staleBasisPct;
  const staleLine = stalePct !== null && stalePct > 0 ? `${stalePct.toFixed(1)}% of the scenario basis uses stale reference observations` : null;
  if (stalePct !== null && stalePct > 0) {
    flags.push({ code: "STALE_DEPENDENCE", label: "Stale dependence", message: stalePct < 50 ? `Most reference inputs are recent, but ${stalePct.toFixed(1)}% of the scenario uses stale reference observations.` : `${stalePct.toFixed(1)}% of the scenario uses stale reference observations.` });
  }
  if (flags.length === 0 && p.referenceBasisGhs !== null) flags.push({ code: "RECENT_INPUTS", label: "Recent inputs", message: "All reference inputs behind this result are recent." });
  const total = p.positionCount;
  return {
    primary: flags[0]?.code ?? "RECENT_INPUTS",
    flags,
    coverageLine: `${included} of ${total} ${plural(total, "position")} included`,
    valuedLine: p.referenceBasisGhs === null ? null : `${ghsCompact(p.referenceBasisGhs)} valued`,
    staleLine,
    staleBasisPct: stalePct,
    excludedLine: excluded > 0 ? `${excluded} ${plural(excluded, "position")} excluded — no reliable reference value is available` : null,
    included,
    total,
    excluded,
    repricingErrors: p.scenarioErrorCount,
  };
}

// --------------------------------------------------------------------------
// What this means
// --------------------------------------------------------------------------

function buildMeaning(result: OkResult, headline: HeadlineView, drivers: ReturnType<typeof buildDrivers>, confidence: ConfidenceView): string[] {
  const out: string[] = [];
  const p = result.portfolio;
  if (result.rules.length === 0) {
    out.push("This scenario has no assumptions yet, so every valued holding keeps its starting value.");
  } else if (headline.status === "RESULT") {
    out.push(headline.sentence);
    if (headline.direction === "UNCHANGED" && p.shockedPositionCount === 0) out.push("None of the holdings is reached by these assumptions.");
    if (headline.direction === "UNCHANGED" && p.shockedPositionCount > 0) out.push("The assumptions are applied, but their effects offset or are zero.");
  }
  if (headline.direction !== "UNCHANGED" && headline.status === "RESULT") {
    const noun = NOUN[headline.direction];
    const main = drivers.mainClass;
    if (main && main.sharePct !== null) {
      out.push(main.sharePct > 50 ? `${main.label} account for more than half of the ${noun}.` : `${main.label} are the largest source of the ${noun}, at ${main.sharePct.toFixed(0)}%.`);
      for (const c of drivers.byClass.filter((x) => x !== main && drivers.sameWay(x.impactGhs)).slice(0, 2)) out.push(`${c.label} account for ${ghsCompact(c.impactGhs)} of the scenario impact.`);
    }
    const top = drivers.topPositions[0];
    if (top) out.push(`${top.label} is the largest individual contributor to the ${noun}.`);
    const opposite = result.positions.filter(isPart).filter((x) => x.impactGhs !== 0 && !drivers.sameWay(x.impactGhs));
    if (opposite.length > 0) {
      const offset = opposite.reduce((s, x) => s + x.impactGhs, 0);
      out.push(`${countWord(opposite.length)} ${plural(opposite.length, "holding moves", "holdings move")} the other way, offsetting ${ghsCompact(offset)} of the ${noun}.`);
    }
  }
  // Specific assumptions overriding broader ones.
  for (const pos of result.positions.filter(isPart)) {
    const matched = pos.resolution.matchedRules;
    const w = pos.resolution.winner;
    if (!w || matched.length < 2 || w.selector.kind === "ASSET_CLASS") continue;
    const broader = matched[matched.length - 1];
    const level = w.selector.kind === "SECURITY" ? "security-specific" : "issuer-specific";
    const same = Math.sign(w.value) === Math.sign(broader.value) && w.value !== 0;
    const how = !same || w.value === broader.value ? (w.value === broader.value ? "the same as" : "differently from") : Math.abs(w.value) > Math.abs(broader.value) ? "more heavily than" : "less heavily than";
    out.push(how === "the same as" ? `${pos.label} has its own ${level} assumption, which matches the broader ${broader.targetLabel} assumption.` : `${pos.label} is stressed ${how === "more heavily than" ? "more heavily" : how === "less heavily than" ? "less heavily" : "differently"} than the broader ${broader.targetLabel} assumption because this scenario contains a ${level} assumption for it.`);
  }
  // An issuer assumption that reaches one asset type but not the issuer's other holding.
  for (const pos of result.positions.filter(isPart)) {
    if (pos.outcome !== "UNCHANGED") continue;
    const issuerRule = result.rules.find((r) => r.selector.kind === "ISSUER" && r.selector.issuerKey === pos.issuer.key);
    if (issuerRule) out.push(`${pos.label} is unchanged: the ${issuerRule.targetLabel} assumption applies to its ${issuerRule.shockType === "YIELD_BPS" ? "bonds" : "shares"} only, not to ${pos.assetClass === "EQUITY" ? "its shares" : "its bonds"}. Set a separate assumption to test that.`);
  }
  if (confidence.staleBasisPct !== null && confidence.staleBasisPct > 0) {
    const s = confidence.staleBasisPct;
    out.push(`${s >= 99.5 ? "All" : `About ${Math.round(s)}% of`} the scenario basis relies on stale market observations; an assumption does not make those observations current.`);
  }
  if (confidence.excluded > 0) out.push(`${countWord(confidence.excluded)} ${plural(confidence.excluded, "holding is", "holdings are")} excluded because Korbly does not have a sufficiently reliable reference value.`);
  if (confidence.repricingErrors > 0) out.push(`${countWord(confidence.repricingErrors)} valued ${plural(confidence.repricingErrors, "holding", "holdings")} could not be repriced under these assumptions.`);
  return out;
}

// --------------------------------------------------------------------------
// Investigation
// --------------------------------------------------------------------------

function buildInvestigations(result: OkResult, headline: HeadlineView, drivers: ReturnType<typeof buildDrivers>, links: Record<string, PositionLinks>): InvestigationItem[] {
  const items: InvestigationItem[] = [];
  const part = result.positions.filter(isPart);
  const linkFor = (id: string, prefer: "analysis" | "evidence" | "inspect"): PositionLink | null => {
    const l = links[id];
    if (!l) return null;
    return (prefer === "analysis" ? l.analysis : prefer === "evidence" ? l.evidence : null) ?? l.inspect;
  };
  const noun = headline.direction === "RISE" ? "increase" : "decline";
  const used = new Set<string>();
  // A holding already listed that also rests on a stale input gets the fact added to its card, not a second card.
  const staleNote = (x: Participating) => (x.recency === "STALE" ? ` Its reference observation is stale (${formatIsoDate(x.inputDate)}, ${age(x.inputAgeDays)}).` : "");

  // 1. Largest portfolio driver.
  const top = drivers.topPositions[0];
  if (top && headline.direction !== "UNCHANGED") {
    const pos = part.find((x) => x.positionId === top.positionId)!;
    items.push({
      kind: "LARGEST_DRIVER",
      title: "Largest portfolio driver",
      positionId: pos.positionId,
      positionLabel: pos.label,
      headline: `Scenario impact: ${signedGhsWhole(pos.impactGhs)}${top.sharePct !== null ? ` · ${top.sharePct.toFixed(0)}% of the ${noun}` : ""}`,
      why: `It contributes more to the scenario ${noun} than any other holding.${staleNote(pos)}`,
      link: linkFor(pos.positionId, "analysis"),
    });
    used.add(pos.positionId);
  }

  // 2. Most rate-sensitive bond: the largest moving bond not already shown.
  const bond = part
    .filter((x) => x.assetClass !== "EQUITY" && x.impactGhs !== 0 && !used.has(x.positionId))
    .sort((a, b) => Math.abs(b.impactGhs) - Math.abs(a.impactGhs) || a.label.localeCompare(b.label))[0];
  if (bond) {
    const cls = EXPOSURE_ASSET_CLASS_LABEL[bond.assetClass].toLowerCase().replace(/s$/, "");
    const isLargestOfClass = !part.some((x) => x.assetClass === bond.assetClass && Math.abs(x.impactGhs) > Math.abs(bond.impactGhs));
    items.push({
      kind: "RATE_SENSITIVE",
      title: "Rate-sensitive holding",
      positionId: bond.positionId,
      positionLabel: bond.label,
      headline: `Scenario impact: ${signedGhsWhole(bond.impactGhs)}`,
      why: `${isLargestOfClass ? `It is the largest ${cls} contributor under this scenario.` : "It is the largest bond contributor not already listed above."}${staleNote(bond)}`,
      link: linkFor(bond.positionId, "analysis"),
    });
    used.add(bond.positionId);
  }

  // 3. A stale input that carries a material share of the movement.
  const gross = part.reduce((s, x) => s + Math.abs(x.impactGhs), 0);
  const stale = part
    .filter((x) => x.recency === "STALE" && !used.has(x.positionId) && x.impactGhs !== 0 && gross > 0 && (Math.abs(x.impactGhs) / gross) * 100 >= MATERIAL_GROSS_SHARE_PCT)
    .sort((a, b) => Math.abs(b.impactGhs) - Math.abs(a.impactGhs) || a.label.localeCompare(b.label))[0];
  if (stale) {
    items.push({
      kind: "STALE_INPUT",
      title: "Stale input to review",
      positionId: stale.positionId,
      positionLabel: stale.label,
      headline: `Reference observation is stale (${formatIsoDate(stale.inputDate)}, ${age(stale.inputAgeDays)}). Scenario impact: ${signedGhsWhole(stale.impactGhs)}`,
      why: "An assumption does not make an old observation current, so this part of the result deserves a second look.",
      link: linkFor(stale.positionId, "evidence"),
    });
  }

  // 4. Holdings Korbly could not value or reprice.
  for (const u of result.positions.filter(isUnavail)) {
    const missing = u.code === "UNVALUED_REFERENCE";
    items.push({
      kind: missing ? "MISSING_VALUATION" : "REPRICING_ERROR",
      title: missing ? "Missing valuation" : "Could not be repriced",
      positionId: u.positionId,
      positionLabel: u.label,
      headline: missing ? "Korbly excluded this holding because there is no sufficiently reliable current reference value." : "This valued holding could not be repriced under these assumptions, so it is excluded from the result.",
      why: u.reason,
      link: linkFor(u.positionId, "inspect"),
    });
  }

  // 5. A specific assumption that changes a holding differently from the broader one.
  const specific = part.find((x) => x.resolution.winner && x.resolution.winner.selector.kind !== "ASSET_CLASS" && x.resolution.matchedRules.length > 1 && x.resolution.winner.value !== x.resolution.matchedRules[x.resolution.matchedRules.length - 1].value && !used.has(x.positionId));
  if (specific && specific.resolution.winner) {
    const w = specific.resolution.winner;
    const b = specific.resolution.matchedRules[specific.resolution.matchedRules.length - 1];
    items.push({
      kind: "SPECIFIC_ASSUMPTION",
      title: "Specific assumption",
      positionId: specific.positionId,
      positionLabel: specific.label,
      headline: `${shortAssumption(w)} instead of ${shortAssumption(b)}. Scenario impact: ${signedGhsWhole(specific.impactGhs)}`,
      why: `Its own assumption replaces the broader one, so it moves differently from other ${EXPOSURE_ASSET_CLASS_LABEL[specific.assetClass].toLowerCase()}.`,
      link: linkFor(specific.positionId, "analysis"),
    });
  }

  return items.slice(0, MAX_INVESTIGATIONS);
}

// --------------------------------------------------------------------------
// Positions
// --------------------------------------------------------------------------

function assumptionPlainFor(result: OkResult, pos: OkResult["positions"][number]): string {
  const w = pos.resolution.winner;
  if (w) return describeAssumptionPlain(w).replace(/\.$/, "");
  const issuerRule = result.rules.find((r) => r.selector.kind === "ISSUER" && r.selector.issuerKey === pos.issuer.key);
  return issuerRule ? `The ${issuerRule.targetLabel} assumption does not reach this holding` : "No assumption reaches this holding";
}

function simpleBond(pos: Participating, d: Extract<Participating["detail"], { assetClass: "BOND" }>): string[] {
  if (pos.outcome === "UNCHANGED") return [`No assumption reaches this holding, so it keeps its starting value of ${ghsCompact(pos.referenceValueGhs)} (yield ${pct2(d.referenceYieldPct)}).`];
  const rising = d.scenarioYieldPct > d.referenceYieldPct;
  const same = d.scenarioYieldPct === d.referenceYieldPct;
  const dirText = same ? "stays at" : rising ? "rises from" : "falls from";
  const first = same ? `Under this scenario, its assumed yield stays at ${pct2(d.referenceYieldPct)}.` : `Under this scenario, its assumed yield ${dirText} ${pct2(d.referenceYieldPct)} to ${pct2(d.scenarioYieldPct)}.`;
  const second = same ? "" : `Because bond prices move in the opposite direction to yields, its value ${rising ? "falls" : "rises"} from ${ghsCompact(pos.referenceValueGhs)} to ${ghsCompact(pos.scenarioValueGhs)}.`;
  const third = pos.impactGhs === 0 ? "That leaves the portfolio unchanged." : `That ${pos.impactGhs < 0 ? "reduces" : "increases"} the portfolio by approximately ${ghsCompact(pos.impactGhs)}.`;
  return [[first, second, third].filter(Boolean).join(" ")];
}

function simpleEquity(pos: Participating, d: Extract<Participating["detail"], { assetClass: "EQUITY" }>): string[] {
  if (pos.outcome === "UNCHANGED") return [`No assumption reaches this holding, so it keeps its starting value of ${ghsCompact(pos.referenceValueGhs)} (share price GHS ${d.referencePriceGhs.toFixed(2)}).`];
  const verb = d.appliedShockPct === 0 ? "is held at" : d.appliedShockPct < 0 ? "falls" : "rises";
  const first = d.appliedShockPct === 0 ? `Under this scenario, its share price is held at GHS ${d.referencePriceGhs.toFixed(2)}.` : `Under this scenario, its share price ${verb} ${Math.abs(d.appliedShockPct)}%, from GHS ${d.referencePriceGhs.toFixed(2)} to GHS ${d.scenarioPriceGhs.toFixed(2)}.`;
  const second = d.appliedShockPct === 0 ? "" : `Its value moves from ${ghsCompact(pos.referenceValueGhs)} to ${ghsCompact(pos.scenarioValueGhs)}.`;
  const third = pos.impactGhs === 0 ? "That leaves the portfolio unchanged." : `That ${pos.impactGhs < 0 ? "reduces" : "increases"} the portfolio by approximately ${ghsCompact(pos.impactGhs)}.`;
  return [[first, second, third].filter(Boolean).join(" ")];
}

function ruleLines(pos: OkResult["positions"][number]): TechRow[] {
  const r = pos.resolution;
  const rows: TechRow[] = [];
  if (r.winner) {
    rows.push({ label: "Winning rule", value: `${LEVEL_LABEL[r.winner.selector.kind]}: ${shortAssumption(r.winner)}`, note: "The one assumption applied to this holding." });
    if (r.matchedRules.length > 1) rows.push({ label: "Also matched (overridden)", value: r.matchedRules.slice(1).map(shortAssumption).join("; "), note: "Higher precedence wins: security, then issuer, then asset class. Rules never stack." });
  } else rows.push({ label: "Winning rule", value: "None — no assumption reaches this holding" });
  rows.push({ label: "Why this rule", value: r.reason });
  return rows;
}

function provenanceGroup(prov: Provenance | null | undefined): TechGroup | null {
  if (!prov) return null;
  return { title: "Source and provenance", rows: [{ label: "Source", value: prov.sourceName }, { label: "Retrieved", value: formatIsoDate(prov.retrievedAt.slice(0, 10)) }, { label: "Ingestion run", value: prov.ingestionRunId }, ...prov.facts.map((f) => ({ label: f.label, value: f.value }))] };
}

function buildPosition(result: OkResult, pos: OkResult["positions"][number], links: PositionLinks, provenance: Provenance | null | undefined): PositionView {
  const base = { positionId: pos.positionId, label: pos.label, assetClassLabel: EXPOSURE_ASSET_CLASS_LABEL[pos.assetClass], assumptionPlain: assumptionPlainFor(result, pos), links };
  if (isUnavail(pos)) {
    const missing = pos.code === "UNVALUED_REFERENCE";
    return {
      ...base,
      status: "UNAVAILABLE",
      outcome: null,
      recency: null,
      startingGhs: null,
      scenarioGhs: null,
      impactGhs: null,
      impactPct: null,
      startingText: null,
      scenarioText: null,
      impactText: null,
      impactPctText: null,
      simple: [missing ? UNVALUED_SENTENCE : "This holding has a reference value but could not be repriced under these assumptions, so it is excluded from the result rather than estimated."],
      freshnessNote: null,
      technical: [{ title: "Why it is excluded", rows: [{ label: "Reason", value: pos.reason }, { label: "Code", value: pos.upstreamCode ? `${pos.code} (${pos.upstreamCode})` : pos.code }, ...ruleLines(pos)] }],
    };
  }
  const d = pos.detail;
  const groups: TechGroup[] = [];
  if (d.assetClass === "BOND") {
    groups.push({
      title: "Yield and price",
      rows: [
        { label: "Reference yield", value: pct4(d.referenceYieldPct), note: "The last reliable observed yield." },
        { label: "Applied assumption", value: d.appliedShockBps === 0 && !pos.resolution.winner ? "None" : `${signOf(d.appliedShockBps)}${Math.abs(d.appliedShockBps)} bps` },
        { label: "Scenario yield", value: pct4(d.scenarioYieldPct) },
        { label: "Reference dirty price", value: num6(d.referenceDirtyPrice), note: "Dirty price includes accrued interest; per 100 of face value. Simple view: the reference bond price." },
        { label: "Scenario dirty price", value: num6(d.scenarioDirtyPrice) },
        { label: "Reference clean price", value: num4(d.referenceCleanPrice) },
        { label: "Scenario clean price", value: num4(d.scenarioCleanPrice) },
        { label: "Accrued interest", value: num6(d.accruedInterest), note: "Per 100 of face value. Unchanged by a yield assumption, so it is the same before and after." },
        { label: "Nominal", value: ghsExact(d.nominalGhs) },
      ],
    });
    groups.push({
      title: "Value",
      rows: [
        { label: "Reference value", value: ghsExact(pos.referenceValueGhs), note: STARTING_VALUE_HELP },
        { label: "Scenario value", value: ghsExact(pos.scenarioValueGhs), note: "Exact cash-flow repricing at the scenario yield." },
        { label: "Exact impact", value: signedGhsExact(pos.impactGhs) },
      ],
    });
    groups.push({
      title: "Rate sensitivity (DV01)",
      rows:
        d.dv01Ghs === null || d.firstOrderImpactGhs === null || d.firstOrderErrorGhs === null
          ? [{ label: "DV01", value: "Not available", note: "Korbly could not compute the small-move sensitivity for this bond. The exact repricing above is unaffected." }]
          : [
              { label: "DV01", value: `${ghsExact(d.dv01Ghs)}/bp`, note: "For a very small increase in yields, this position changes by roughly this much per basis point." },
              { label: "First-order DV01 estimate", value: signedGhsExact(d.firstOrderImpactGhs), note: "−DV01 × shock. A small-move approximation shown for comparison only." },
              { label: "Exact repricing difference", value: signedGhsExact(d.firstOrderErrorGhs), note: "Exact impact minus the first-order estimate. Exact cash-flow repricing is used for the scenario result; DV01 is shown only as an approximation of small rate changes." },
            ],
    });
  } else {
    groups.push({
      title: "Price and value",
      rows: [
        { label: "Shares", value: intFmt(d.shares) },
        { label: "Reference price", value: `GHS ${num4(d.referencePriceGhs)}` },
        { label: "Applied assumption", value: pos.resolution.winner ? `${signOf(d.appliedShockPct)}${Math.abs(d.appliedShockPct)}%` : "None" },
        { label: "Scenario price", value: `GHS ${num4(d.scenarioPriceGhs)}` },
        { label: "Reference value", value: ghsExact(pos.referenceValueGhs), note: STARTING_VALUE_HELP },
        { label: "Scenario value", value: ghsExact(pos.scenarioValueGhs) },
        { label: "Exact impact", value: signedGhsExact(pos.impactGhs) },
      ],
    });
  }
  groups.push({ title: "Which assumption applied", rows: ruleLines(pos) });
  groups.push({ title: "Observation and quality", rows: [{ label: "Observation date", value: formatIsoDate(pos.inputDate) }, { label: "Age at valuation date", value: age(pos.inputAgeDays) }, { label: "Recent or stale", value: pos.recency === "RECENT" ? "Recent" : "Stale", note: pos.recency === "STALE" ? STALE_SENTENCE : undefined }, ...pos.warnings.map((w) => ({ label: "Note", value: w }))] });
  const prov = provenanceGroup(provenance);
  if (prov) groups.push(prov);
  return {
    ...base,
    status: "PARTICIPATING",
    outcome: pos.outcome,
    recency: pos.recency,
    startingGhs: pos.referenceValueGhs,
    scenarioGhs: pos.scenarioValueGhs,
    impactGhs: pos.impactGhs,
    impactPct: pos.impactPct,
    startingText: ghsWhole(pos.referenceValueGhs),
    scenarioText: ghsWhole(pos.scenarioValueGhs),
    impactText: signedGhsWhole(pos.impactGhs),
    impactPctText: signedPct(pos.impactPct),
    simple: d.assetClass === "BOND" ? simpleBond(pos, d) : simpleEquity(pos, d),
    freshnessNote: pos.recency === "STALE" ? STALE_SENTENCE : null,
    technical: groups,
  };
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

export function buildStudioView(input: StudioInputs): StudioView {
  const { result, links, provenance } = input;
  const headline = buildHeadline(result);
  const drivers = buildDrivers(result, headline.direction);
  const confidence = buildConfidence(result);
  const fallbackLink = (id: string): PositionLinks => links[id] ?? { analysis: null, evidence: null, inspect: { href: "#", label: "Inspect position" } };
  const positions = result.positions.map((p) => buildPosition(result, p, fallbackLink(p.positionId), provenance[p.positionId]));
  return {
    headline,
    assumptions: buildAssumptions(result),
    byClass: drivers.byClass,
    mainClass: drivers.mainClass,
    topPositions: drivers.topPositions,
    confidence,
    meaning: buildMeaning(result, headline, drivers, confidence),
    investigations: buildInvestigations(result, headline, drivers, links),
    positions,
    notices: [HYPOTHETICAL_NOTICE, ESTIMATE_NOTICE],
  };
}

/** Plain explanation of an assumption set for lists: "Government bonds +200 bps · Equities −10%". */
export function summariseAssumptions(rules: ScenarioShockRule[], limit = 3): string {
  if (rules.length === 0) return "No assumptions yet";
  const shown = rules.slice(0, limit).map(shortAssumption);
  return rules.length > limit ? `${shown.join(" · ")} · +${rules.length - limit} more` : shown.join(" · ");
}
