// Library filtering and search — pure, over the already-loaded thesis list.

import type { ThesisConfidence, ThesisStatus, ThesisSubjectKind } from "./types";

export interface ThesisFilterable {
  title: string;
  status: ThesisStatus;
  confidence: ThesisConfidence | null;
  subjectKind: ThesisSubjectKind;
  subjectLabel: string;
  subjectCode: string;
  updatedAt: string;
}

export interface ThesisFilters {
  q?: string;
  status?: ThesisStatus | "LIVE" | null;
  subjectKind?: ThesisSubjectKind | null;
  confidence?: ThesisConfidence | null;
  /** A specific subject (e.g. the instrument code) — exact match on `subjectCode`. */
  subjectCode?: string | null;
}

export function filterTheses<T extends ThesisFilterable>(all: readonly T[], f: ThesisFilters): T[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const out = all.filter((t) => {
    if (f.status === "LIVE" ? t.status !== "ACTIVE" && t.status !== "CHALLENGED" : f.status && t.status !== f.status) return false;
    if (f.subjectKind && t.subjectKind !== f.subjectKind) return false;
    if (f.confidence && t.confidence !== f.confidence) return false;
    if (f.subjectCode && t.subjectCode !== f.subjectCode) return false;
    if (q && !`${t.title} ${t.subjectLabel} ${t.subjectCode}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
