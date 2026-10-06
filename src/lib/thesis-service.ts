// ---------------------------------------------------------------------------
// Thesis mutations (M9.1). Every write re-validates on the server: the subject must
// exist, the content must satisfy the draft or activation rules, and a status change
// must be an allowed transition. The CHECK constraint on Thesis is the backstop for
// "exactly one subject".
//
// There is NO authentication (internal-MVP decision shared with portfolios): do not
// expose these mutations on a public deployment without adding it.
// ---------------------------------------------------------------------------

import { getPrisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import { canTransition, isEditable, LIMITS, normalizeContent, reconcileConditions, validateActivation, validateDraft, hasErrors, type ThesisContent, type ThesisErrors, type ThesisStatus, type ThesisSubjectRef } from "./thesis";

export type ThesisResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: ThesisErrors };

const fail = (error: string, fieldErrors?: ThesisErrors): { ok: false; error: string; fieldErrors?: ThesisErrors } => ({ ok: false, error, fieldErrors });

async function subjectExists(ref: ThesisSubjectRef): Promise<boolean> {
  const prisma = getPrisma();
  if (ref.type === "SECURITY") return (await prisma.security.count({ where: { id: ref.id } })) > 0;
  if (ref.type === "FIXED_INCOME") return (await prisma.fixedIncomeSecurity.count({ where: { id: ref.id } })) > 0;
  return (await prisma.treasuryInstrument.count({ where: { id: ref.id } })) > 0;
}

const subjectColumns = (ref: ThesisSubjectRef) => ({
  securityId: ref.type === "SECURITY" ? ref.id : null,
  fixedIncomeSecurityId: ref.type === "FIXED_INCOME" ? ref.id : null,
  treasuryInstrumentId: ref.type === "TREASURY_INSTRUMENT" ? ref.id : null,
});

const contentColumns = (c: ThesisContent) => ({ title: c.title, belief: c.belief, rationale: c.rationale, risks: c.risks, watching: c.watching, confidence: c.confidence, horizon: c.horizon });

type Tx = Prisma.TransactionClient;
const KINDS = [["MUST_BE_TRUE", "mustBeTrue"], ["INVALIDATION", "invalidation"]] as const;

/**
 * Makes the thesis's condition rows match the analyst's lists. A condition whose wording is unchanged keeps
 * its row (and so its evidence and flag). One that is removed or reworded is DELETED if nothing hangs off
 * it, and otherwise RETIRED (kept, hidden from the live lists) so evidence and flag history stay traceable.
 */
async function syncConditions(tx: Tx, thesisId: string, c: ThesisContent): Promise<void> {
  for (const [kind, field] of KINDS) {
    const existing = await tx.thesisCondition.findMany({ where: { thesisId, kind, retiredAt: null }, select: { id: true, text: true, flag: true, _count: { select: { evidence: true } } } });
    const { keep, add, remove } = reconcileConditions(existing, c[field]);
    for (const k of keep) await tx.thesisCondition.update({ where: { id: k.id }, data: { position: k.position } });
    if (add.length) await tx.thesisCondition.createMany({ data: add.map((a) => ({ thesisId, kind, text: a.text, position: a.position })) });
    for (const id of remove) {
      const row = existing.find((e) => e.id === id)!;
      if (row._count.evidence > 0 || row.flag !== "NOT_OBSERVED") await tx.thesisCondition.update({ where: { id }, data: { retiredAt: new Date() } });
      else await tx.thesisCondition.delete({ where: { id } });
    }
  }
}

/** Saves a new thesis as a draft, or activates it straight away when `activate` is set and it is complete. */
export async function createThesis(input: { subject: ThesisSubjectRef; content: Partial<Record<keyof ThesisContent, unknown>>; activate?: boolean }): Promise<ThesisResult<{ id: string; status: ThesisStatus }>> {
  const content = normalizeContent(input.content);
  const errors = input.activate ? validateActivation(content) : validateDraft(content);
  if (hasErrors(errors)) return fail(input.activate ? "This thesis is not ready to activate yet." : "Fix the highlighted fields to save.", errors);
  if (!(await subjectExists(input.subject))) return fail("Choose a subject for the thesis.");
  const status: ThesisStatus = input.activate ? "ACTIVE" : "DRAFT";
  const created = await getPrisma().$transaction(async (tx) => {
    const t = await tx.thesis.create({ data: { ...subjectColumns(input.subject), ...contentColumns(content), status } });
    await syncConditions(tx, t.id, content);
    return t;
  });
  return { ok: true, id: created.id, status };
}

/** Edits the analyst's words. A live thesis must stay complete; a retired one (invalidated/closed) is a record and is not edited. The subject and status never change here. */
export async function updateThesis(id: string, rawContent: Partial<Record<keyof ThesisContent, unknown>>): Promise<ThesisResult> {
  const prisma = getPrisma();
  const existing = await prisma.thesis.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return fail("Thesis not found.");
  if (!isEditable(existing.status)) return fail("An invalidated or closed thesis is a record of what was believed and is no longer edited. Write a new thesis instead.");
  const content = normalizeContent(rawContent);
  const errors = existing.status === "DRAFT" ? validateDraft(content) : validateActivation(content);
  if (hasErrors(errors)) return fail(existing.status === "DRAFT" ? "Fix the highlighted fields to save." : "A live thesis has to stay complete — fix the highlighted fields.", errors);
  const saved = await prisma.$transaction(async (tx) => {
    const res = await tx.thesis.updateMany({ where: { id, status: existing.status }, data: contentColumns(content) });
    if (res.count === 0) return false;
    await syncConditions(tx, id, content);
    return true;
  });
  if (!saved) return fail("The thesis changed while you were editing. Reload and try again.");
  return { ok: true };
}

/** Analyst-controlled status change. Validates the transition; activation re-checks completeness. */
export async function changeThesisStatus(id: string, to: unknown, note?: string | null): Promise<ThesisResult<{ status: ThesisStatus }>> {
  const prisma = getPrisma();
  const existing = await prisma.thesis.findUnique({ where: { id } });
  if (!existing) return fail("Thesis not found.");
  if (!canTransition(existing.status, to)) return fail(`A thesis cannot move from ${existing.status.toLowerCase()} to ${String(to).toLowerCase()}.`);
  const trimmed = (note ?? "").trim();
  if (trimmed.length > LIMITS.statusNote) return fail(`Keep the note within ${LIMITS.statusNote} characters.`);
  if (to === "ACTIVE") {
    const [must, invalid] = await Promise.all(KINDS.map(([kind]) => prisma.thesisCondition.findMany({ where: { thesisId: id, kind, retiredAt: null }, orderBy: { position: "asc" }, select: { text: true } })));
    const errors = validateActivation(normalizeContent({ ...existing, mustBeTrue: must.map((c) => c.text), invalidation: invalid.map((c) => c.text) }));
    if (hasErrors(errors)) return fail("This thesis is not ready to activate yet.", errors);
  }
  const res = await prisma.thesis.updateMany({ where: { id, status: existing.status }, data: { status: to, statusNote: trimmed === "" ? null : trimmed, statusChangedAt: new Date() } });
  if (res.count === 0) return fail("The thesis changed while you were working. Reload and try again.");
  return { ok: true, status: to };
}
