// ---------------------------------------------------------------------------
// Catalyst domain (M9.2). Pure. A catalyst is a development the thesis is WAITING for — not a task.
// Recording that one occurred records a fact; it never concludes the thesis succeeded. Timing is a
// window (exact date / month / quarter / none) so analysts never have to invent precision, and a
// passed window is a prompt to look, never a verdict that the catalyst failed.
// ---------------------------------------------------------------------------

import { parseIsoDate, todayIso } from "./evidence";

export const CATALYST_STATUSES = ["WATCHING", "OCCURRED", "MISSED", "NO_LONGER_RELEVANT"] as const;
export type CatalystStatus = (typeof CATALYST_STATUSES)[number];
export const CATALYST_WINDOW_KINDS = ["NONE", "DATE", "MONTH", "QUARTER"] as const;
export type CatalystWindowKind = (typeof CATALYST_WINDOW_KINDS)[number];

export const CATALYST_STATUS_LABEL: Record<CatalystStatus, string> = { WATCHING: "Watching", OCCURRED: "Occurred", MISSED: "Did not occur", NO_LONGER_RELEVANT: "No longer relevant" };
export const CATALYST_STATUS_MEANING: Record<CatalystStatus, string> = {
  WATCHING: "Still waiting for this.",
  OCCURRED: "The analyst has recorded that this happened.",
  MISSED: "The analyst has recorded that this did not happen as expected.",
  NO_LONGER_RELEVANT: "The analyst no longer expects it to matter to the thesis.",
};
export const CATALYST_LIMITS = { description: 200, outcomeNote: 1000 } as const;

const TRANSITIONS: Record<CatalystStatus, readonly CatalystStatus[]> = {
  WATCHING: ["OCCURRED", "MISSED", "NO_LONGER_RELEVANT"],
  OCCURRED: ["WATCHING"],
  MISSED: ["WATCHING", "OCCURRED"],
  NO_LONGER_RELEVANT: ["WATCHING"],
};
export const allowedCatalystTransitions = (from: CatalystStatus): readonly CatalystStatus[] => TRANSITIONS[from];
export const isCatalystStatus = (v: unknown): v is CatalystStatus => typeof v === "string" && (CATALYST_STATUSES as readonly string[]).includes(v);
export const canTransitionCatalyst = (from: CatalystStatus, to: unknown): to is CatalystStatus => isCatalystStatus(to) && TRANSITIONS[from].includes(to);
export const isCatalystKind = (v: unknown): v is CatalystWindowKind => typeof v === "string" && (CATALYST_WINDOW_KINDS as readonly string[]).includes(v);

export type CatalystWindow = { kind: "NONE"; start: null; end: null } | { kind: Exclude<CatalystWindowKind, "NONE">; start: string; end: string };
export const NO_WINDOW: CatalystWindow = { kind: "NONE", start: null, end: null };

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based → day 0 of next month
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Turns the form's value into a window. DATE "2026-11-20"; MONTH "2026-11"; QUARTER "2027-Q1".
 * Returns null when the value is not valid for the kind.
 */
export function parseWindow(kind: unknown, value: unknown): CatalystWindow | null {
  if (kind === "NONE" || kind === "" || kind === undefined || kind === null) return NO_WINDOW;
  const v = typeof value === "string" ? value.trim() : "";
  if (kind === "DATE") {
    const d = parseIsoDate(v);
    return d ? { kind: "DATE", start: d, end: d } : null;
  }
  if (kind === "MONTH") {
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
    return { kind: "MONTH", start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
  }
  if (kind === "QUARTER") {
    const m = /^(\d{4})-Q([1-4])$/.exec(v);
    if (!m) return null;
    const y = Number(m[1]);
    const q = Number(m[2]);
    if (y < 2000 || y > 2100) return null;
    const first = (q - 1) * 3 + 1;
    return { kind: "QUARTER", start: `${y}-${pad(first)}-01`, end: `${y}-${pad(first + 2)}-${pad(lastDay(y, first + 2))}` };
  }
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function windowLabel(w: CatalystWindow): string {
  if (w.kind === "NONE") return "No date set";
  const [y, m, d] = w.start.split("-").map(Number);
  if (w.kind === "DATE") return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  if (w.kind === "MONTH") return `${MONTHS[m - 1]} ${y}`;
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

/** The value a form input should show for a stored window (inverse of parseWindow). */
export function windowInputValue(w: CatalystWindow): string {
  if (w.kind === "NONE") return "";
  if (w.kind === "DATE") return w.start;
  if (w.kind === "MONTH") return w.start.slice(0, 7);
  return `${w.start.slice(0, 4)}-Q${Math.floor((Number(w.start.slice(5, 7)) - 1) / 3) + 1}`;
}

export type CatalystTiming = "NO_DATE" | "UPCOMING" | "EXPECTED_THIS_MONTH" | "WINDOW_PASSED";
export const TIMING_LABEL: Record<CatalystTiming, string> = { NO_DATE: "No date set", UPCOMING: "Upcoming", EXPECTED_THIS_MONTH: "Expected this month", WINDOW_PASSED: "Window passed — review" };

/** Deterministic timing of a WATCHING catalyst. Null for any other status — a passed window means "look", not "failed". */
export function catalystTiming(status: CatalystStatus, w: CatalystWindow, now: Date = new Date()): CatalystTiming | null {
  if (status !== "WATCHING") return null;
  if (w.kind === "NONE") return "NO_DATE";
  const today = todayIso(now);
  if (w.end < today) return "WINDOW_PASSED";
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = `${today.slice(0, 7)}-${pad(lastDay(Number(today.slice(0, 4)), Number(today.slice(5, 7))))}`;
  return w.start <= monthEnd && w.end >= monthStart ? "EXPECTED_THIS_MONTH" : "UPCOMING";
}

export interface CatalystInput {
  description: string;
  window: CatalystWindow | null;
}
export type CatalystErrors = Partial<Record<"description" | "window" | "occurredOn" | "outcomeNote" | "status", string>>;

export function validateCatalystInput(i: { description: string; windowKind: unknown; windowValue: unknown }): { errors: CatalystErrors; window: CatalystWindow } {
  const errors: CatalystErrors = {};
  const description = i.description.replace(/\s+/g, " ").trim();
  if (description === "") errors.description = "Say what you are waiting for.";
  else if (description.length > CATALYST_LIMITS.description) errors.description = `Keep it within ${CATALYST_LIMITS.description} characters.`;
  const window = parseWindow(i.windowKind, i.windowValue);
  if (window === null) errors.window = "Enter a valid date, month or quarter — or choose “No date set”.";
  return { errors, window: window ?? NO_WINDOW };
}

/** Occurrence details: the date it happened (not in the future; defaults to today) and an optional analyst note. */
export function validateOccurrence(i: { occurredOn: unknown; outcomeNote: unknown }, now: Date = new Date()): { errors: CatalystErrors; occurredOn: string; outcomeNote: string | null } {
  const errors: CatalystErrors = {};
  const raw = typeof i.occurredOn === "string" ? i.occurredOn.trim() : "";
  const occurredOn = raw === "" ? todayIso(now) : parseIsoDate(raw);
  if (occurredOn === null) errors.occurredOn = "Enter a valid date.";
  else if (occurredOn > todayIso(now)) errors.occurredOn = "The date it occurred cannot be in the future.";
  const note = typeof i.outcomeNote === "string" ? i.outcomeNote.trim() : "";
  if (note.length > CATALYST_LIMITS.outcomeNote) errors.outcomeNote = `Keep the note within ${CATALYST_LIMITS.outcomeNote} characters.`;
  return { errors, occurredOn: occurredOn ?? todayIso(now), outcomeNote: note === "" ? null : note };
}
