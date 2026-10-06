// ---------------------------------------------------------------------------
// Evidence summary and REVIEW SIGNAL (M9.2). Pure and deterministic.
//
// This is a WORKFLOW signal, not an investment conclusion. It answers "why might an analyst want to
// look at this thesis again?" and always says why. It never scores a thesis, never counts supporting
// against challenging to call a winner, and never changes status or confidence.
//
// Baseline: "since" means since the last review, or since the thesis was created if it has never been
// reviewed. Evidence is dated by when it was ADDED (createdAt), not by when the observation was made.
//
// Two kinds of reason (a review suggestion lists every one that applies, in this fixed order):
//
//   PERSISTENT — a current state that is still true until the analyst changes it. REVIEWED ≠ RESOLVED:
//     1 INVALIDATION_TRIGGERED   a condition is currently marked triggered
//     2 INVALIDATION_POTENTIAL   a condition is currently marked potentially triggered
//   Marking the thesis reviewed does NOT clear these; resetting the flag does.
//
//   NEW-SINCE-REVIEW — news the analyst acknowledges by reviewing (baseline-relative):
//     3 HIGH_CHALLENGE           high-relevance challenging evidence was added since the baseline
//     4 CATALYST_OCCURRED        a catalyst was recorded as occurred since the baseline
//     5 MATERIAL_EVIDENCE        a high-relevance supporting/context item, or 3+ items of any kind,
//                                were added since the baseline
//   Marking reviewed moves the baseline, so these clear. The evidence itself stays.
//
// A catalyst window passing is shown on the catalyst, not as a review reason.
// ---------------------------------------------------------------------------

import { isLive } from "./status";
import type { ThesisStatus } from "./types";
import type { EvidenceRelevance, EvidenceStance } from "./evidence";
import type { CatalystStatus, CatalystWindow } from "./catalyst";
import type { InvalidationFlag } from "./condition";

export interface EvidenceLite {
  id: string;
  stance: EvidenceStance;
  relevance: EvidenceRelevance;
  /** YYYY-MM-DD, when the observation was made/published. */
  observedAt: string | null;
  /** ISO timestamp it was added to the thesis. */
  createdAt: string;
}
export interface ConditionLite {
  id: string;
  kind: "MUST_BE_TRUE" | "INVALIDATION";
  flag: InvalidationFlag;
  flagChangedAt: string | null;
  retired: boolean;
}
export interface CatalystLite {
  id: string;
  status: CatalystStatus;
  statusChangedAt: string;
  window: CatalystWindow;
}
export interface ResearchInput {
  status: ThesisStatus;
  createdAt: string;
  /** Non-archived evidence only. */
  evidence: readonly EvidenceLite[];
  conditions: readonly ConditionLite[];
  catalysts: readonly CatalystLite[];
  /** ISO timestamps of every review. */
  reviewedAt: readonly string[];
  now?: Date;
}

export type ReviewReasonCode = "INVALIDATION_TRIGGERED" | "INVALIDATION_POTENTIAL" | "HIGH_CHALLENGE" | "CATALYST_OCCURRED" | "MATERIAL_EVIDENCE";
export interface ReviewReason {
  code: ReviewReasonCode;
  text: string;
  /** ISO timestamp of the newest thing behind the reason. */
  at: string;
  /** True for a current state that review does not clear (flagged invalidation conditions). */
  persistent: boolean;
}

export interface EvidenceCounts {
  supports: number;
  challenges: number;
  context: number;
  total: number;
  high: number;
}
export interface ResearchState {
  counts: EvidenceCounts;
  lastReviewedAt: string | null;
  baseline: string;
  neverReviewed: boolean;
  since: EvidenceCounts & { mostImportantId: string | null };
  reasons: ReviewReason[];
  reviewSuggested: boolean;
  /** Factual statements about what is recorded. None is a verdict. */
  summary: string[];
  nextCatalystId: string | null;
}

const RELEVANCE_RANK: Record<EvidenceRelevance, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const STANCE_RANK: Record<EvidenceStance, number> = { CHALLENGES: 3, SUPPORTS: 2, CONTEXT: 1 };

export const evidenceDay = (e: Pick<EvidenceLite, "observedAt" | "createdAt">) => e.observedAt ?? e.createdAt.slice(0, 10);

/** Evidence ordering inside a section: analyst-declared relevance, then the date of the evidence, then when it was added, then id. */
export function compareEvidence(a: EvidenceLite, b: EvidenceLite): number {
  return RELEVANCE_RANK[b.relevance] - RELEVANCE_RANK[a.relevance] || evidenceDay(b).localeCompare(evidenceDay(a)) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/** "What deserves a look first" among new evidence: relevance, then challenging before supporting before context, then recency. */
export function compareImportance(a: EvidenceLite, b: EvidenceLite): number {
  return RELEVANCE_RANK[b.relevance] - RELEVANCE_RANK[a.relevance] || STANCE_RANK[b.stance] - STANCE_RANK[a.stance] || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

export function countEvidence(list: readonly EvidenceLite[]): EvidenceCounts {
  return {
    supports: list.filter((e) => e.stance === "SUPPORTS").length,
    challenges: list.filter((e) => e.stance === "CHALLENGES").length,
    context: list.filter((e) => e.stance === "CONTEXT").length,
    total: list.length,
    high: list.filter((e) => e.relevance === "HIGH").length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ago = (iso: string, now: Date) => {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
const newest = (xs: readonly string[]) => xs.reduce((a, b) => (b > a ? b : a));

export function computeResearch(input: ResearchInput): ResearchState {
  const now = input.now ?? new Date();
  const reviews = [...input.reviewedAt].sort();
  const lastReviewedAt = reviews.length ? reviews[reviews.length - 1] : null;
  const baseline = lastReviewedAt ?? input.createdAt;
  const neverReviewed = lastReviewedAt === null;
  const since = neverReviewed ? "since this thesis was created" : "since the last review";

  const counts = countEvidence(input.evidence);
  const fresh = input.evidence.filter((e) => e.createdAt > baseline);
  const freshCounts = countEvidence(fresh);
  const mostImportantId = [...fresh].sort(compareImportance)[0]?.id ?? null;

  const reasons: ReviewReason[] = [];
  if (isLive(input.status)) {
    const flagged = (f: InvalidationFlag) => input.conditions.filter((c) => !c.retired && c.kind === "INVALIDATION" && c.flag === f);
    const at = (cs: ConditionLite[]) => newest(cs.map((c) => c.flagChangedAt ?? input.createdAt));
    const trig = flagged("TRIGGERED");
    if (trig.length) reasons.push({ code: "INVALIDATION_TRIGGERED", persistent: true, at: at(trig), text: `${plural(trig.length, "invalidation condition is", "invalidation conditions are")} currently marked as triggered.` });
    const pot = flagged("POTENTIALLY_TRIGGERED");
    if (pot.length) reasons.push({ code: "INVALIDATION_POTENTIAL", persistent: true, at: at(pot), text: `${plural(pot.length, "invalidation condition is", "invalidation conditions are")} currently marked as potentially triggered.` });
    const hc = fresh.filter((e) => e.stance === "CHALLENGES" && e.relevance === "HIGH");
    if (hc.length) {
      const at = newest(hc.map((e) => e.createdAt));
      reasons.push({ code: "HIGH_CHALLENGE", persistent: false, at, text: hc.length === 1 ? `High-relevance challenging evidence was added ${ago(at, now)}.` : `${hc.length} high-relevance challenging evidence items were added ${since}; the latest ${ago(at, now)}.` });
    }
    const cat = input.catalysts.filter((c) => c.status === "OCCURRED" && c.statusChangedAt > baseline);
    if (cat.length) reasons.push({ code: "CATALYST_OCCURRED", persistent: false, at: newest(cat.map((c) => c.statusChangedAt)), text: `${plural(cat.length, "catalyst has", "catalysts have")} been recorded as occurred ${since}.` });
    const material = fresh.filter((e) => e.relevance === "HIGH" && e.stance !== "CHALLENGES");
    if (material.length || fresh.length >= 3) {
      const high = freshCounts.high;
      reasons.push({ code: "MATERIAL_EVIDENCE", persistent: false, at: newest(fresh.map((e) => e.createdAt)), text: `${plural(fresh.length, "new evidence item has", "new evidence items have")} been added ${since}${high ? ` (${high} high-relevance)` : ""}.` });
    }
  }

  const summary: string[] = [];
  if (counts.total === 0) summary.push("No evidence has been recorded yet.");
  else {
    const parts = [`${counts.supports} supporting`, `${counts.challenges} challenging`];
    summary.push(`${parts.join(" and ")} evidence ${counts.total === 1 ? "item is" : "items are"} recorded${counts.context ? `, plus ${counts.context} context` : ""}.`);
    const lead = [...input.evidence].filter((e) => e.relevance === "HIGH" && e.stance !== "CONTEXT").sort((a, b) => evidenceDay(b).localeCompare(evidenceDay(a)) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
    if (lead) summary.push(`The most recent high-relevance evidence ${lead.stance === "CHALLENGES" ? "challenges" : "supports"} the thesis.`);
    if (freshCounts.high > 0) summary.push(`${plural(freshCounts.high, "high-relevance evidence item has", "high-relevance evidence items have")} been added ${since}.`);
  }

  const upcoming = input.catalysts
    .filter((c) => c.status === "WATCHING")
    .sort((a, b) => (a.window.start ?? "9999-12-31").localeCompare(b.window.start ?? "9999-12-31") || a.statusChangedAt.localeCompare(b.statusChangedAt));
  const nextCatalystId = upcoming[0]?.id ?? null;

  return { counts, lastReviewedAt, baseline, neverReviewed, since: { ...freshCounts, mostImportantId }, reasons, reviewSuggested: reasons.length > 0, summary, nextCatalystId };
}
