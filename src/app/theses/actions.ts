"use server";

// ---------------------------------------------------------------------------
// Server Actions for investment theses (M9.1). Thin: parse FormData, call
// src/lib/thesis-service.ts (which owns validation and persistence). NO AUTHENTICATION
// (internal-MVP decision shared with portfolios) — do not expose publicly without it.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { changeThesisStatus, createThesis, updateThesis } from "@/lib/thesis-service";
import { parseLines, type ThesisErrors, type ThesisSubjectRef } from "@/lib/thesis";

export interface ThesisFormState {
  error?: string;
  fieldErrors?: ThesisErrors;
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

function readContent(formData: FormData) {
  return {
    title: text(formData, "title"),
    belief: text(formData, "belief"),
    rationale: text(formData, "rationale"),
    mustBeTrue: parseLines(text(formData, "mustBeTrue")),
    risks: parseLines(text(formData, "risks")),
    invalidation: parseLines(text(formData, "invalidation")),
    catalysts: parseLines(text(formData, "catalysts")),
    watching: parseLines(text(formData, "watching")),
    confidence: text(formData, "confidence"),
    horizon: text(formData, "horizon"),
  };
}

function readSubject(formData: FormData): ThesisSubjectRef | null {
  const type = text(formData, "subjectType");
  const id = text(formData, "subjectId");
  if (id === "" || (type !== "SECURITY" && type !== "FIXED_INCOME" && type !== "TREASURY_INSTRUMENT")) return null;
  return { type, id };
}

export async function createThesisAction(_prev: ThesisFormState, formData: FormData): Promise<ThesisFormState> {
  const subject = readSubject(formData);
  if (!subject) return { error: "Choose what the thesis is about.", fieldErrors: {} };
  const result = await createThesis({ subject, content: readContent(formData), activate: text(formData, "intent") === "activate" });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/theses/${result.id}?saved=${result.status === "ACTIVE" ? "activated" : "draft"}`);
}

export async function updateThesisAction(id: string, _prev: ThesisFormState, formData: FormData): Promise<ThesisFormState> {
  const result = await updateThesis(id, readContent(formData));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/theses/${id}?saved=edited`);
}

export async function changeThesisStatusAction(id: string, formData: FormData): Promise<void> {
  const to = text(formData, "to");
  const result = await changeThesisStatus(id, to, text(formData, "note"));
  if (!result.ok) redirect(`/theses/${id}?error=${encodeURIComponent(result.fieldErrors ? `${result.error} ${Object.values(result.fieldErrors).join(" ")}` : result.error)}`);
  redirect(`/theses/${id}?saved=${to.toLowerCase()}`);
}
