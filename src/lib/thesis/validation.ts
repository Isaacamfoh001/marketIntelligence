// Validation of what the analyst wrote. Drafts are cheap (a subject, a title and a belief);
// ACTIVATING needs the parts that make a thesis falsifiable: reasoning, what must be true, and
// what would prove us wrong — plus the analyst's own confidence and horizon.

import { isConfidence, isHorizon, LIMITS, LIST_FIELDS, type ThesisContent, type ThesisListField } from "./types";

export type ThesisErrors = Partial<Record<keyof ThesisContent, string>>;

/** Trim, drop blanks, collapse case-insensitive duplicates, keep order. */
export function normalizeList(raw: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw ?? []) {
    const t = item.replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (t === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** "one item per line" textarea → list. Leading bullets/dashes are stripped. */
export const parseLines = (text: string): string[] => normalizeList(text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-•*–]|\d+[.)])\s+/, "")));

export const emptyContent = (): ThesisContent => ({ title: "", belief: "", rationale: "", mustBeTrue: [], risks: [], invalidation: [], watching: [], confidence: null, horizon: null });

/** Cleans analyst input into a ThesisContent (no judgement about completeness). */
export function normalizeContent(input: Partial<Record<keyof ThesisContent, unknown>>): ThesisContent {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => normalizeList(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    title: str(input.title).replace(/\s+/g, " "),
    belief: str(input.belief),
    rationale: str(input.rationale),
    mustBeTrue: list(input.mustBeTrue),
    risks: list(input.risks),
    invalidation: list(input.invalidation),
    watching: list(input.watching),
    confidence: isConfidence(input.confidence) ? input.confidence : null,
    horizon: isHorizon(input.horizon) ? input.horizon : null,
  };
}

const FIELD_NAME: Record<ThesisListField, string> = { mustBeTrue: "What must be true", risks: "What could go wrong", invalidation: "What could prove us wrong", watching: "What we’re watching" };

/** Limits that apply to every save, draft or not. */
export function validateDraft(c: ThesisContent): ThesisErrors {
  const e: ThesisErrors = {};
  if (c.title === "") e.title = "Give the thesis a short title.";
  else if (c.title.length > LIMITS.title) e.title = `Keep the title within ${LIMITS.title} characters.`;
  if (c.belief === "") e.belief = "State what you believe, in a sentence or two.";
  else if (c.belief.length > LIMITS.belief) e.belief = `Keep the core belief within ${LIMITS.belief} characters.`;
  if (c.rationale.length > LIMITS.rationale) e.rationale = `Keep the reasoning within ${LIMITS.rationale} characters.`;
  for (const f of LIST_FIELDS) {
    if (c[f].length > LIMITS.items) e[f] = `${FIELD_NAME[f]}: at most ${LIMITS.items} items.`;
    else if (c[f].some((i) => i.length > LIMITS.item)) e[f] = `${FIELD_NAME[f]}: keep each item within ${LIMITS.item} characters.`;
  }
  return e;
}

/** What a thesis needs before it can be an ACTIVE view. Includes every draft rule. */
export function validateActivation(c: ThesisContent): ThesisErrors {
  const e = validateDraft(c);
  if (!e.rationale && c.rationale === "") e.rationale = "Explain why you believe it before activating.";
  if (!e.mustBeTrue && c.mustBeTrue.length === 0) e.mustBeTrue = "Name at least one thing that must be true.";
  if (!e.invalidation && c.invalidation.length === 0) e.invalidation = "Say what would make you reconsider — a thesis with no way to be wrong is not yet a thesis.";
  if (c.confidence === null) e.confidence = "Choose your confidence in the thesis.";
  if (c.horizon === null) e.horizon = "Choose the time horizon.";
  return e;
}

export const hasErrors = (e: ThesisErrors) => Object.keys(e).length > 0;

/** What is still missing to activate — for a readiness hint on a draft. Empty when ready. */
export const activationGaps = (c: ThesisContent): string[] => Object.values(validateActivation(c));
