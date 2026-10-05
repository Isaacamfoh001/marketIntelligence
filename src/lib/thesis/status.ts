// Status workflow. Analyst-controlled — nothing in Korbly changes a status. Small on
// purpose: a lookup table, not a state-machine framework.
//
//   DRAFT       → ACTIVE | CLOSED
//   ACTIVE      → CHALLENGED | INVALIDATED | CLOSED
//   CHALLENGED  → ACTIVE | INVALIDATED | CLOSED
//   INVALIDATED → CLOSED          (retire it from tracking; the record of the belief stays)
//   CLOSED      → (terminal)      (write a new thesis rather than reviving an old one)

import { isStatus, type ThesisStatus } from "./types";

const TRANSITIONS: Record<ThesisStatus, readonly ThesisStatus[]> = {
  DRAFT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["CHALLENGED", "INVALIDATED", "CLOSED"],
  CHALLENGED: ["ACTIVE", "INVALIDATED", "CLOSED"],
  INVALIDATED: ["CLOSED"],
  CLOSED: [],
};

export const allowedTransitions = (from: ThesisStatus): readonly ThesisStatus[] => TRANSITIONS[from];

export function canTransition(from: ThesisStatus, to: unknown): to is ThesisStatus {
  return isStatus(to) && TRANSITIONS[from].includes(to);
}

/** INVALIDATED and CLOSED are the analyst's record of what was believed: their content is no longer edited. */
export const isEditable = (status: ThesisStatus): boolean => status === "DRAFT" || status === "ACTIVE" || status === "CHALLENGED";

/** A thesis still being tracked as a live view. */
export const isLive = (status: ThesisStatus): boolean => status === "ACTIVE" || status === "CHALLENGED";

/** What a transition is called on a button — verbs, never BUY/SELL/HOLD. */
export const TRANSITION_ACTION: Record<ThesisStatus, string> = {
  DRAFT: "Return to draft",
  ACTIVE: "Activate",
  CHALLENGED: "Mark as challenged",
  INVALIDATED: "Mark as invalidated",
  CLOSED: "Close thesis",
};
