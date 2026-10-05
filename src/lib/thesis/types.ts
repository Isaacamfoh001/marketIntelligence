// ---------------------------------------------------------------------------
// Investment thesis domain (M9.1). Pure — no I/O, no Prisma, no React.
//
// A thesis is analyst-authored judgment about an investable subject. Korbly
// supplies structure and nearby context; it never writes, scores or evaluates the
// reasoning, and never turns a thesis into a recommendation or a decision.
// ---------------------------------------------------------------------------

export const THESIS_STATUSES = ["DRAFT", "ACTIVE", "CHALLENGED", "INVALIDATED", "CLOSED"] as const;
export type ThesisStatus = (typeof THESIS_STATUSES)[number];

export const THESIS_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type ThesisConfidence = (typeof THESIS_CONFIDENCES)[number];

export const THESIS_HORIZONS = ["SHORT", "MEDIUM", "LONG"] as const;
export type ThesisHorizon = (typeof THESIS_HORIZONS)[number];

/** What a thesis is about. A Treasury-bill thesis is about a TENOR (a view on bills), never one dated bill. */
export const THESIS_SUBJECT_KINDS = ["EQUITY", "GOVERNMENT_BOND", "CORPORATE_BOND", "TREASURY_BILL"] as const;
export type ThesisSubjectKind = (typeof THESIS_SUBJECT_KINDS)[number];

/** The row-level reference: exactly one id is set. Bonds share one column; government vs corporate comes from the instrument. */
export type ThesisSubjectRef = { type: "SECURITY"; id: string } | { type: "FIXED_INCOME"; id: string } | { type: "TREASURY_INSTRUMENT"; id: string };

export const LIST_FIELDS = ["mustBeTrue", "risks", "invalidation", "catalysts", "watching"] as const;
export type ThesisListField = (typeof LIST_FIELDS)[number];

/** What the analyst writes. Everything in here is judgment, never data. */
export interface ThesisContent {
  title: string;
  belief: string;
  rationale: string;
  mustBeTrue: string[];
  risks: string[];
  invalidation: string[];
  catalysts: string[];
  watching: string[];
  confidence: ThesisConfidence | null;
  horizon: ThesisHorizon | null;
}

export const LIMITS = {
  title: 140,
  belief: 600,
  rationale: 6000,
  item: 300,
  items: 12,
  statusNote: 500,
} as const;

export const STATUS_LABEL: Record<ThesisStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  CHALLENGED: "Challenged",
  INVALIDATED: "Invalidated",
  CLOSED: "Closed",
};

export const STATUS_MEANING: Record<ThesisStatus, string> = {
  DRAFT: "Still being developed.",
  ACTIVE: "A current investment view.",
  CHALLENGED: "May still hold, but important information needs review.",
  INVALIDATED: "The reasoning no longer holds.",
  CLOSED: "No longer tracked — not necessarily because it was wrong.",
};

export const CONFIDENCE_LABEL: Record<ThesisConfidence, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
export const HORIZON_LABEL: Record<ThesisHorizon, string> = { SHORT: "Under 1 year", MEDIUM: "1–3 years", LONG: "3+ years" };
export const SUBJECT_KIND_LABEL: Record<ThesisSubjectKind, string> = { EQUITY: "Equity", GOVERNMENT_BOND: "Government bond", CORPORATE_BOND: "Corporate bond", TREASURY_BILL: "Treasury bills" };

export const isStatus = (v: unknown): v is ThesisStatus => typeof v === "string" && (THESIS_STATUSES as readonly string[]).includes(v);
export const isConfidence = (v: unknown): v is ThesisConfidence => typeof v === "string" && (THESIS_CONFIDENCES as readonly string[]).includes(v);
export const isHorizon = (v: unknown): v is ThesisHorizon => typeof v === "string" && (THESIS_HORIZONS as readonly string[]).includes(v);
export const isSubjectKind = (v: unknown): v is ThesisSubjectKind => typeof v === "string" && (THESIS_SUBJECT_KINDS as readonly string[]).includes(v);
