"use server";

// ---------------------------------------------------------------------------
// Server Actions for thesis evidence, catalysts, invalidation flags and reviews (M9.2). Thin: read
// FormData, call src/lib/thesis-research-service.ts (which owns validation and persistence).
// NO AUTHENTICATION (internal-MVP decision shared with theses and portfolios).
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { addCatalyst, addManualEvidence, archiveEvidence, changeCatalystStatus, deleteCatalyst, linkKorblyEvidence, markReviewed, setInvalidationFlag, updateCatalyst, updateEvidence, type ResearchResult } from "@/lib/thesis-research-service";

export interface EvidenceFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const toRaw = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));

/** Redirects back to the thesis with either a confirmation or the reason the change was refused. */
function back(thesisId: string, result: ResearchResult, saved: string, anchor = ""): never {
  if (!result.ok) {
    const detail = result.fieldErrors ? ` ${Object.values(result.fieldErrors).join(" ")}` : "";
    redirect(`/theses/${thesisId}?error=${encodeURIComponent(result.error + detail)}${anchor}`);
  }
  redirect(`/theses/${thesisId}?saved=${saved}${anchor}`);
}

export async function addEvidenceAction(thesisId: string, _prev: EvidenceFormState, fd: FormData): Promise<EvidenceFormState> {
  const result =
    text(fd, "mode") === "link"
      ? await linkKorblyEvidence(thesisId, { refKind: text(fd, "refKind"), refId: text(fd, "refId"), stance: text(fd, "stance"), relevance: text(fd, "relevance"), note: text(fd, "note"), conditionId: text(fd, "conditionId"), catalystId: text(fd, "catalystId") })
      : await addManualEvidence(thesisId, toRaw(fd));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/theses/${thesisId}?saved=evidence#evidence`);
}

export async function updateEvidenceAction(thesisId: string, evidenceId: string, _prev: EvidenceFormState, fd: FormData): Promise<EvidenceFormState> {
  const result = await updateEvidence(evidenceId, toRaw(fd));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/theses/${thesisId}?saved=evidence-edited#evidence-${evidenceId}`);
}

export async function archiveEvidenceAction(thesisId: string, evidenceId: string): Promise<void> {
  back(thesisId, await archiveEvidence(evidenceId), "evidence-removed", "#evidence");
}

export async function addCatalystAction(thesisId: string, fd: FormData): Promise<void> {
  back(thesisId, await addCatalyst(thesisId, { description: text(fd, "description"), windowKind: text(fd, "windowKind"), windowValue: text(fd, `window-${text(fd, "windowKind")}`) }), "catalyst", "#catalysts");
}

export async function updateCatalystAction(thesisId: string, catalystId: string, fd: FormData): Promise<void> {
  back(thesisId, await updateCatalyst(catalystId, { description: text(fd, "description"), windowKind: text(fd, "windowKind"), windowValue: text(fd, `window-${text(fd, "windowKind")}`) }), "catalyst-edited", `#catalyst-${catalystId}`);
}

export async function changeCatalystStatusAction(thesisId: string, catalystId: string, fd: FormData): Promise<void> {
  back(thesisId, await changeCatalystStatus(catalystId, text(fd, "to"), { occurredOn: text(fd, "occurredOn"), outcomeNote: text(fd, "outcomeNote") }), "catalyst-status", `#catalyst-${catalystId}`);
}

export async function deleteCatalystAction(thesisId: string, catalystId: string): Promise<void> {
  back(thesisId, await deleteCatalyst(catalystId), "catalyst-removed", "#catalysts");
}

export async function setFlagAction(thesisId: string, conditionId: string, fd: FormData): Promise<void> {
  back(thesisId, await setInvalidationFlag(conditionId, text(fd, "to"), text(fd, "note")), "flag", `#condition-${conditionId}`);
}

export async function markReviewedAction(thesisId: string, fd: FormData): Promise<void> {
  back(thesisId, await markReviewed(thesisId, text(fd, "note")), "reviewed");
}
