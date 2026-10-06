// ---------------------------------------------------------------------------
// The thesis research timeline (M9.2): "what information arrived, and when?" Entries are ordered by the
// date that MEANS something (when the observation was made, the catalyst occurred, the condition was
// flagged, the review happened) — recorded-at is only a tiebreaker. Not a generic activity log.
// ---------------------------------------------------------------------------

export type TimelineKind = "SUPPORTING_EVIDENCE" | "CHALLENGING_EVIDENCE" | "CONTEXT_EVIDENCE" | "CATALYST_OCCURRED" | "INVALIDATION_FLAGGED" | "THESIS_REVIEWED" | "THESIS_CREATED";

export interface TimelineEntry {
  kind: TimelineKind;
  /** The meaningful date, YYYY-MM-DD. */
  date: string;
  /** ISO timestamp it was recorded in Korbly (tiebreaker, secondary). */
  recordedAt: string;
  title: string;
  detail?: string;
  /** In-page anchor. */
  href?: string;
}

export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  SUPPORTING_EVIDENCE: "Supporting evidence",
  CHALLENGING_EVIDENCE: "Challenging evidence",
  CONTEXT_EVIDENCE: "Context evidence",
  CATALYST_OCCURRED: "Catalyst occurred",
  INVALIDATION_FLAGGED: "Invalidation condition flagged",
  THESIS_REVIEWED: "Thesis reviewed",
  THESIS_CREATED: "Thesis created",
};

export const sortTimeline = (entries: readonly TimelineEntry[]): TimelineEntry[] =>
  [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt) || a.title.localeCompare(b.title));
