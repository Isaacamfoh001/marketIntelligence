// ---------------------------------------------------------------------------
// Mutations for thesis evidence, catalysts, invalidation flags and reviews (M9.2). Every write
// re-validates on the server. NOTHING here changes a thesis's status, confidence or content: evidence
// informs the analyst, who decides. Writes are refused on INVALIDATED and CLOSED theses, which are
// records of what was believed (M9.1).
//
// There is NO authentication (internal-MVP decision shared with portfolios and theses): do not expose
// these mutations on a public deployment without adding it.
// ---------------------------------------------------------------------------

import { getPrisma } from "./prisma";
import { describeObservation } from "./queries/thesis-evidence";
import {
  canTransitionCatalyst, canTransitionFlag, CATALYST_LIMITS, EVIDENCE_LIMITS, FLAG_NOTE_LIMIT, hasEvidenceErrors, isCatalystStatus, isFlag, isRefKind, isLive, normalizeManualEvidence, parseHttpUrl, snapshotTitle,
  validateCatalystInput, validateInterpretation, validateManualEvidence, validateOccurrence,
  type CatalystStatus, type EvidenceRefKind, type EvidenceRelevance, type EvidenceStance,
} from "./thesis";

export type ResearchResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };
const fail = (error: string, fieldErrors?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } => ({ ok: false, error, fieldErrors });
const asDate = (iso: string | null) => (iso === null ? null : new Date(`${iso}T00:00:00.000Z`));
const READ_ONLY = "An invalidated or closed thesis is a record of what was believed and is no longer changed.";

async function writableThesis(thesisId: string): Promise<{ ok: true; status: "DRAFT" | "ACTIVE" | "CHALLENGED" | "INVALIDATED" | "CLOSED" } | { ok: false; error: string }> {
  const t = await getPrisma().thesis.findUnique({ where: { id: thesisId }, select: { status: true } });
  if (!t) return { ok: false, error: "Thesis not found." };
  if (t.status === "INVALIDATED" || t.status === "CLOSED") return { ok: false, error: READ_ONLY };
  return { ok: true, status: t.status };
}

/** A target is optional; when given it must be a live condition or a catalyst of THIS thesis, and never both. */
async function resolveTarget(thesisId: string, conditionId: unknown, catalystId: unknown): Promise<{ ok: true; conditionId: string | null; catalystId: string | null } | { ok: false; error: string }> {
  const c = typeof conditionId === "string" && conditionId !== "" ? conditionId : null;
  const k = typeof catalystId === "string" && catalystId !== "" ? catalystId : null;
  if (c && k) return { ok: false, error: "Link evidence to a condition or to a catalyst, not both." };
  const prisma = getPrisma();
  if (c && (await prisma.thesisCondition.count({ where: { id: c, thesisId, retiredAt: null } })) === 0) return { ok: false, error: "That condition does not belong to this thesis." };
  if (k && (await prisma.thesisCatalyst.count({ where: { id: k, thesisId } })) === 0) return { ok: false, error: "That catalyst does not belong to this thesis." };
  return { ok: true, conditionId: c, catalystId: k };
}

// --- Evidence ----------------------------------------------------------------------------------------

export async function addManualEvidence(thesisId: string, raw: Record<string, unknown>, now: Date = new Date()): Promise<ResearchResult<{ id: string }>> {
  const w = await writableThesis(thesisId);
  if (!w.ok) return fail(w.error);
  const input = normalizeManualEvidence(raw);
  const errors = validateManualEvidence(input, now);
  if (hasEvidenceErrors(errors)) return fail("Fix the highlighted fields to save.", errors as Record<string, string>);
  const target = await resolveTarget(thesisId, raw.conditionId, raw.catalystId);
  if (!target.ok) return fail(target.error, { target: target.error });
  const created = await getPrisma().thesisEvidence.create({
    data: {
      thesisId, conditionId: target.conditionId, catalystId: target.catalystId,
      stance: input.stance!, relevance: input.relevance!, sourceType: input.sourceType!,
      title: input.title, detail: input.detail || null, note: input.note || null,
      observedAt: asDate(input.observedAt), sourceName: input.sourceName || null, sourceUrl: input.sourceUrl ? parseHttpUrl(input.sourceUrl) : null,
    },
  });
  return { ok: true, id: created.id };
}

export async function linkKorblyEvidence(thesisId: string, raw: { refKind: unknown; refId: unknown; stance: unknown; relevance: unknown; note?: unknown; conditionId?: unknown; catalystId?: unknown }, now: Date = new Date()): Promise<ResearchResult<{ id: string }>> {
  const w = await writableThesis(thesisId);
  if (!w.ok) return fail(w.error);
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  const errors = validateInterpretation({ stance: raw.stance, relevance: raw.relevance, note });
  if (hasEvidenceErrors(errors)) return fail("Fix the highlighted fields to save.", errors as Record<string, string>);
  if (!isRefKind(raw.refKind) || typeof raw.refId !== "string" || raw.refId === "") return fail("Choose a Korbly observation to link.");
  const target = await resolveTarget(thesisId, raw.conditionId, raw.catalystId);
  if (!target.ok) return fail(target.error, { target: target.error });
  const d = await describeObservation(raw.refKind, raw.refId, now);
  if (!d.ok) return fail(d.error);
  const prisma = getPrisma();
  if ((await prisma.thesisEvidence.count({ where: { thesisId, refKind: raw.refKind, refId: d.refId, archivedAt: null } })) > 0) return fail("That observation is already linked to this thesis.");
  try {
    const created = await prisma.thesisEvidence.create({
      data: {
        thesisId, conditionId: target.conditionId, catalystId: target.catalystId,
        stance: raw.stance as EvidenceStance, relevance: raw.relevance as EvidenceRelevance, sourceType: "KORBLY_DATA",
        title: snapshotTitle(d.snapshot), note: note || null, observedAt: asDate(d.observationDate),
        refKind: raw.refKind as EvidenceRefKind, refId: d.refId, snapshot: JSON.parse(JSON.stringify(d.snapshot)),
      },
    });
    return { ok: true, id: created.id };
  } catch (e) {
    // The partial unique index is the backstop for a concurrent duplicate link.
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") return fail("That observation is already linked to this thesis.");
    throw e;
  }
}

/** Manual evidence: every field is editable. Linked evidence: only stance, relevance, note and target — the observation is frozen. */
export async function updateEvidence(evidenceId: string, raw: Record<string, unknown>, now: Date = new Date()): Promise<ResearchResult> {
  const prisma = getPrisma();
  const ev = await prisma.thesisEvidence.findUnique({ where: { id: evidenceId } });
  if (!ev || ev.archivedAt) return fail("Evidence not found.");
  const w = await writableThesis(ev.thesisId);
  if (!w.ok) return fail(w.error);
  const target = await resolveTarget(ev.thesisId, raw.conditionId, raw.catalystId);
  if (!target.ok) return fail(target.error, { target: target.error });
  if (ev.sourceType === "KORBLY_DATA") {
    const note = typeof raw.note === "string" ? raw.note.trim() : "";
    const errors = validateInterpretation({ stance: raw.stance, relevance: raw.relevance, note });
    if (hasEvidenceErrors(errors)) return fail("Fix the highlighted fields to save.", errors as Record<string, string>);
    await prisma.thesisEvidence.update({ where: { id: evidenceId }, data: { stance: raw.stance as EvidenceStance, relevance: raw.relevance as EvidenceRelevance, note: note || null, conditionId: target.conditionId, catalystId: target.catalystId } });
    return { ok: true };
  }
  const input = normalizeManualEvidence(raw);
  const errors = validateManualEvidence(input, now);
  if (hasEvidenceErrors(errors)) return fail("Fix the highlighted fields to save.", errors as Record<string, string>);
  await prisma.thesisEvidence.update({
    where: { id: evidenceId },
    data: { stance: input.stance!, relevance: input.relevance!, sourceType: input.sourceType!, title: input.title, detail: input.detail || null, note: input.note || null, observedAt: asDate(input.observedAt), sourceName: input.sourceName || null, sourceUrl: input.sourceUrl ? parseHttpUrl(input.sourceUrl) : null, conditionId: target.conditionId, catalystId: target.catalystId },
  });
  return { ok: true };
}

/** Removes evidence from the thesis's working view. It is kept (archived), never destroyed — M9.5 asks "what evidence existed?". */
export async function archiveEvidence(evidenceId: string): Promise<ResearchResult<{ thesisId: string }>> {
  const prisma = getPrisma();
  const ev = await prisma.thesisEvidence.findUnique({ where: { id: evidenceId }, select: { thesisId: true, archivedAt: true } });
  if (!ev || ev.archivedAt) return fail("Evidence not found.");
  const w = await writableThesis(ev.thesisId);
  if (!w.ok) return fail(w.error);
  await prisma.thesisEvidence.update({ where: { id: evidenceId }, data: { archivedAt: new Date() } });
  return { ok: true, thesisId: ev.thesisId };
}

// --- Catalysts ---------------------------------------------------------------------------------------

export async function addCatalyst(thesisId: string, raw: { description?: unknown; windowKind?: unknown; windowValue?: unknown }): Promise<ResearchResult<{ id: string }>> {
  const w = await writableThesis(thesisId);
  if (!w.ok) return fail(w.error);
  const { errors, window } = validateCatalystInput({ description: typeof raw.description === "string" ? raw.description : "", windowKind: raw.windowKind, windowValue: raw.windowValue });
  if (Object.keys(errors).length) return fail("Fix the highlighted fields to save.", errors as Record<string, string>);
  const prisma = getPrisma();
  const position = await prisma.thesisCatalyst.count({ where: { thesisId } });
  const description = (raw.description as string).replace(/\s+/g, " ").trim();
  const created = await prisma.thesisCatalyst.create({ data: { thesisId, description, position, windowKind: window.kind, windowStart: asDate(window.start), windowEnd: asDate(window.end) } });
  return { ok: true, id: created.id };
}

export async function updateCatalyst(catalystId: string, raw: { description?: unknown; windowKind?: unknown; windowValue?: unknown }): Promise<ResearchResult> {
  const prisma = getPrisma();
  const c = await prisma.thesisCatalyst.findUnique({ where: { id: catalystId }, select: { thesisId: true } });
  if (!c) return fail("Catalyst not found.");
  const w = await writableThesis(c.thesisId);
  if (!w.ok) return fail(w.error);
  const { errors, window } = validateCatalystInput({ description: typeof raw.description === "string" ? raw.description : "", windowKind: raw.windowKind, windowValue: raw.windowValue });
  if (Object.keys(errors).length) return fail("Fix the highlighted fields to save.", errors as Record<string, string>);
  await prisma.thesisCatalyst.update({ where: { id: catalystId }, data: { description: (raw.description as string).replace(/\s+/g, " ").trim(), windowKind: window.kind, windowStart: asDate(window.start), windowEnd: asDate(window.end) } });
  return { ok: true };
}

/** Records what happened to a catalyst. Never touches the thesis: an occurrence is a fact, not a verdict. */
export async function changeCatalystStatus(catalystId: string, to: unknown, raw: { occurredOn?: unknown; outcomeNote?: unknown } = {}, now: Date = new Date()): Promise<ResearchResult<{ status: CatalystStatus }>> {
  const prisma = getPrisma();
  const c = await prisma.thesisCatalyst.findUnique({ where: { id: catalystId }, select: { thesisId: true, status: true } });
  if (!c) return fail("Catalyst not found.");
  const w = await writableThesis(c.thesisId);
  if (!w.ok) return fail(w.error);
  if (!isCatalystStatus(to) || !canTransitionCatalyst(c.status, to)) return fail(`A catalyst cannot move from ${c.status.toLowerCase().replace(/_/g, " ")} to ${String(to).toLowerCase().replace(/_/g, " ")}.`);
  const note = typeof raw.outcomeNote === "string" ? raw.outcomeNote.trim() : "";
  if (note.length > CATALYST_LIMITS.outcomeNote) return fail("Fix the highlighted fields to save.", { outcomeNote: `Keep the note within ${CATALYST_LIMITS.outcomeNote} characters.` });
  let occurredOn: string | null = null;
  if (to === "OCCURRED") {
    const o = validateOccurrence({ occurredOn: raw.occurredOn, outcomeNote: note }, now);
    if (Object.keys(o.errors).length) return fail("Fix the highlighted fields to save.", o.errors as Record<string, string>);
    occurredOn = o.occurredOn;
  }
  const res = await prisma.thesisCatalyst.updateMany({ where: { id: catalystId, status: c.status }, data: { status: to, occurredOn: asDate(occurredOn), outcomeNote: to === "WATCHING" ? null : note || null, statusChangedAt: now } });
  if (res.count === 0) return fail("The catalyst changed while you were working. Reload and try again.");
  return { ok: true, status: to };
}

/** A catalyst with linked evidence is kept — mark it no longer relevant instead. */
export async function deleteCatalyst(catalystId: string): Promise<ResearchResult> {
  const prisma = getPrisma();
  const c = await prisma.thesisCatalyst.findUnique({ where: { id: catalystId }, select: { thesisId: true, _count: { select: { evidence: true } } } });
  if (!c) return fail("Catalyst not found.");
  const w = await writableThesis(c.thesisId);
  if (!w.ok) return fail(w.error);
  if (c._count.evidence > 0) return fail("This catalyst has evidence linked to it. Mark it “no longer relevant” instead of deleting it.");
  await prisma.thesisCatalyst.delete({ where: { id: catalystId } });
  return { ok: true };
}

// --- Invalidation flags ------------------------------------------------------------------------------

/** The analyst's record about a "could prove us wrong" condition. Never changes the thesis status. */
export async function setInvalidationFlag(conditionId: string, to: unknown, note?: unknown, now: Date = new Date()): Promise<ResearchResult<{ flag: string }>> {
  const prisma = getPrisma();
  const c = await prisma.thesisCondition.findUnique({ where: { id: conditionId }, select: { thesisId: true, kind: true, flag: true, retiredAt: true } });
  if (!c) return fail("Condition not found.");
  if (c.kind !== "INVALIDATION" || c.retiredAt) return fail("Only a current “could prove us wrong” condition can be flagged.");
  const w = await writableThesis(c.thesisId);
  if (!w.ok) return fail(w.error);
  if (!isFlag(to) || !canTransitionFlag(c.flag, to)) return fail(`A condition cannot move from ${c.flag.toLowerCase().replace(/_/g, " ")} to ${String(to).toLowerCase().replace(/_/g, " ")}.`);
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > FLAG_NOTE_LIMIT) return fail(`Keep the note within ${FLAG_NOTE_LIMIT} characters.`);
  const res = await prisma.thesisCondition.updateMany({ where: { id: conditionId, flag: c.flag }, data: { flag: to, flagNote: text || null, flagChangedAt: now } });
  if (res.count === 0) return fail("The condition changed while you were working. Reload and try again.");
  return { ok: true, flag: to };
}

// --- Review ------------------------------------------------------------------------------------------

/** "I have looked at the thesis and its evidence as of now." Sets a new baseline; deletes and changes nothing. */
export async function markReviewed(thesisId: string, note?: unknown, now: Date = new Date()): Promise<ResearchResult<{ id: string }>> {
  const prisma = getPrisma();
  const t = await prisma.thesis.findUnique({ where: { id: thesisId }, select: { status: true, confidence: true } });
  if (!t) return fail("Thesis not found.");
  if (!isLive(t.status)) return fail("Only an active or challenged thesis is reviewed.");
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > EVIDENCE_LIMITS.note) return fail(`Keep the note within ${EVIDENCE_LIMITS.note} characters.`);
  const r = await prisma.thesisReview.create({ data: { thesisId, reviewedAt: now, note: text || null, statusAtReview: t.status, confidenceAtReview: t.confidence } });
  return { ok: true, id: r.id };
}

