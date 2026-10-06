// ---------------------------------------------------------------------------
// Thesis conditions (M9.2): "what must be true" and "what could prove us wrong" as rows with a stable
// id, so evidence can point at one without relying on its position in a list.
//
// INVALIDATION FLAG — the analyst's record. TRIGGERED means "the analyst has recorded that this
// condition occurred". It never changes the thesis status; the analyst does that.
// ---------------------------------------------------------------------------

export const INVALIDATION_FLAGS = ["NOT_OBSERVED", "POTENTIALLY_TRIGGERED", "TRIGGERED"] as const;
export type InvalidationFlag = (typeof INVALIDATION_FLAGS)[number];

export const FLAG_LABEL: Record<InvalidationFlag, string> = { NOT_OBSERVED: "Not observed", POTENTIALLY_TRIGGERED: "Potentially triggered", TRIGGERED: "Triggered" };
export const FLAG_MEANING: Record<InvalidationFlag, string> = {
  NOT_OBSERVED: "Nothing has been recorded against this condition.",
  POTENTIALLY_TRIGGERED: "The analyst has recorded that this may be happening and needs a look.",
  TRIGGERED: "The analyst has recorded that this condition occurred. The thesis status is unchanged until the analyst changes it.",
};
export const FLAG_NOTE_LIMIT = 500;

// Moving away from TRIGGERED goes through POTENTIALLY_TRIGGERED, so a recorded occurrence is never
// wiped out in one click.
const FLAG_TRANSITIONS: Record<InvalidationFlag, readonly InvalidationFlag[]> = {
  NOT_OBSERVED: ["POTENTIALLY_TRIGGERED", "TRIGGERED"],
  POTENTIALLY_TRIGGERED: ["NOT_OBSERVED", "TRIGGERED"],
  TRIGGERED: ["POTENTIALLY_TRIGGERED"],
};
export const allowedFlagTransitions = (from: InvalidationFlag): readonly InvalidationFlag[] => FLAG_TRANSITIONS[from];
export const isFlag = (v: unknown): v is InvalidationFlag => typeof v === "string" && (INVALIDATION_FLAGS as readonly string[]).includes(v);
export const canTransitionFlag = (from: InvalidationFlag, to: unknown): to is InvalidationFlag => isFlag(to) && FLAG_TRANSITIONS[from].includes(to);
/** A flag that asks for the analyst's attention. */
export const isRaised = (f: InvalidationFlag) => f !== "NOT_OBSERVED";

export interface ExistingCondition {
  id: string;
  text: string;
}
const key = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Reconciles an edited list of condition texts with the rows that exist. A text that matches an
 * existing row (ignoring case and spacing) keeps that row — and so its evidence and flag — wherever
 * it moved to. Anything new is added; anything no longer listed is returned in `remove`, for the
 * caller to retire or delete. Rewording is therefore "remove + add": nothing is silently re-pointed.
 */
export function reconcileConditions(existing: readonly ExistingCondition[], next: readonly string[]): { keep: { id: string; position: number }[]; add: { text: string; position: number }[]; remove: string[] } {
  const byKey = new Map(existing.map((c) => [key(c.text), c.id]));
  const used = new Set<string>();
  const keep: { id: string; position: number }[] = [];
  const add: { text: string; position: number }[] = [];
  next.forEach((text, position) => {
    const id = byKey.get(key(text));
    if (id && !used.has(id)) {
      used.add(id);
      keep.push({ id, position });
    } else add.push({ text, position });
  });
  return { keep, add, remove: existing.filter((c) => !used.has(c.id)).map((c) => c.id) };
}
