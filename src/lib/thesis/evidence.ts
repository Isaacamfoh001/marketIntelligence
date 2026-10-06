// ---------------------------------------------------------------------------
// Evidence domain (M9.2). Pure — no I/O, no Prisma, no React.
//
// EVIDENCE = an observation the analyst has explicitly attached to a thesis, with the
// analyst's reading of how it bears on the belief. Korbly never decides what evidence means:
// stance and relevance are analyst-declared, relevance is a coarse label (not a strength, not a
// probability), and no function in here counts or weighs evidence into a verdict.
// ---------------------------------------------------------------------------

export const EVIDENCE_STANCES = ["SUPPORTS", "CHALLENGES", "CONTEXT"] as const;
export type EvidenceStance = (typeof EVIDENCE_STANCES)[number];

export const EVIDENCE_RELEVANCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type EvidenceRelevance = (typeof EVIDENCE_RELEVANCES)[number];

export const EVIDENCE_SOURCE_TYPES = ["KORBLY_DATA", "OFFICIAL_SOURCE", "COMPANY_DISCLOSURE", "EXTERNAL_SOURCE", "ANALYST_OBSERVATION"] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/** Sources an analyst can enter by hand. KORBLY_DATA is only ever created by linking an existing observation. */
export const MANUAL_SOURCE_TYPES = ["OFFICIAL_SOURCE", "COMPANY_DISCLOSURE", "EXTERNAL_SOURCE", "ANALYST_OBSERVATION"] as const;
export type ManualSourceType = (typeof MANUAL_SOURCE_TYPES)[number];

export const EVIDENCE_REF_KINDS = ["MACRO_OBSERVATION", "POLICY_DECISION", "TREASURY_RATE", "FX_RATE", "EQUITY_PRICE", "BOND_OBSERVATION"] as const;
export type EvidenceRefKind = (typeof EVIDENCE_REF_KINDS)[number];

export const STANCE_LABEL: Record<EvidenceStance, string> = { SUPPORTS: "Supports", CHALLENGES: "Challenges", CONTEXT: "Context" };
export const STANCE_MEANING: Record<EvidenceStance, string> = {
  SUPPORTS: "In the analyst’s reading, this is consistent with the thesis.",
  CHALLENGES: "In the analyst’s reading, this cuts against the thesis.",
  CONTEXT: "Relevant background that the analyst does not read as for or against.",
};
export const RELEVANCE_LABEL: Record<EvidenceRelevance, string> = { LOW: "Low relevance", MEDIUM: "Medium relevance", HIGH: "High relevance" };
export const SOURCE_TYPE_LABEL: Record<EvidenceSourceType, string> = {
  KORBLY_DATA: "Korbly data",
  OFFICIAL_SOURCE: "Official source",
  COMPANY_DISCLOSURE: "Company disclosure",
  EXTERNAL_SOURCE: "External source",
  ANALYST_OBSERVATION: "Analyst observation",
};
export const SOURCE_TYPE_HELP: Record<EvidenceSourceType, string> = {
  KORBLY_DATA: "An observation Korbly holds, linked and frozen as it was.",
  OFFICIAL_SOURCE: "A statistics office, central bank, regulator or other official publication.",
  COMPANY_DISCLOSURE: "A filing, results announcement or other disclosure by the company.",
  EXTERNAL_SOURCE: "Research, press or any other outside source.",
  ANALYST_OBSERVATION: "Something the analyst noticed or concluded, with no outside source.",
};
export const REF_KIND_LABEL: Record<EvidenceRefKind, string> = {
  MACRO_OBSERVATION: "Macro series",
  POLICY_DECISION: "Policy-rate decision",
  TREASURY_RATE: "Treasury-bill auction rate",
  FX_RATE: "Exchange rate",
  EQUITY_PRICE: "Equity trade",
  BOND_OBSERVATION: "Bond observation",
};

export const isStance = (v: unknown): v is EvidenceStance => typeof v === "string" && (EVIDENCE_STANCES as readonly string[]).includes(v);
export const isRelevance = (v: unknown): v is EvidenceRelevance => typeof v === "string" && (EVIDENCE_RELEVANCES as readonly string[]).includes(v);
export const isManualSourceType = (v: unknown): v is ManualSourceType => typeof v === "string" && (MANUAL_SOURCE_TYPES as readonly string[]).includes(v);
export const isRefKind = (v: unknown): v is EvidenceRefKind => typeof v === "string" && (EVIDENCE_REF_KINDS as readonly string[]).includes(v);

export const EVIDENCE_LIMITS = { title: 160, detail: 2000, note: 2000, sourceName: 120, sourceUrl: 2000 } as const;

/** Strict YYYY-MM-DD → the same string, or null when it is not a real calendar date. */
export function parseIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export const todayIso = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** An http(s) reference supplied by the analyst. Korbly never fetches it. Returns the normalised URL or null. */
export function parseHttpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "" || s.length > EVIDENCE_LIMITS.sourceUrl) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.hostname === "" || u.username !== "" || u.password !== "") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** What an analyst enters by hand. */
export interface ManualEvidenceInput {
  stance: EvidenceStance | null;
  relevance: EvidenceRelevance | null;
  sourceType: ManualSourceType | null;
  title: string;
  detail: string;
  note: string;
  observedAt: string | null;
  sourceName: string;
  sourceUrl: string;
}

export type EvidenceField = keyof ManualEvidenceInput | "target";
export type EvidenceErrors = Partial<Record<EvidenceField, string>>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function normalizeManualEvidence(raw: Record<string, unknown>): ManualEvidenceInput {
  const date = str(raw.observedAt);
  return {
    stance: isStance(raw.stance) ? raw.stance : null,
    relevance: isRelevance(raw.relevance) ? raw.relevance : null,
    sourceType: isManualSourceType(raw.sourceType) ? raw.sourceType : null,
    title: str(raw.title).replace(/\s+/g, " "),
    detail: str(raw.detail),
    note: str(raw.note),
    observedAt: date === "" ? null : (parseIsoDate(date) ?? date),
    sourceName: str(raw.sourceName).replace(/\s+/g, " "),
    sourceUrl: str(raw.sourceUrl),
  };
}

/** The interpretation fields every evidence item has — the only fields editable on Korbly-linked evidence. */
export function validateInterpretation(i: { stance: unknown; relevance: unknown; note: string }): EvidenceErrors {
  const e: EvidenceErrors = {};
  if (!isStance(i.stance)) e.stance = "Choose whether this supports, challenges or is context for the thesis.";
  if (!isRelevance(i.relevance)) e.relevance = "Choose how much this matters to the thesis.";
  if (i.note.length > EVIDENCE_LIMITS.note) e.note = `Keep the note within ${EVIDENCE_LIMITS.note} characters.`;
  return e;
}

/** Manual evidence needs a title, a stance, a relevance, and — for anything that claims an outside source — who said it and when. */
export function validateManualEvidence(i: ManualEvidenceInput, now: Date = new Date()): EvidenceErrors {
  const e: EvidenceErrors = validateInterpretation(i);
  if (i.sourceType === null) e.sourceType = "Choose where this evidence comes from.";
  if (i.title === "") e.title = "Say in a line what was observed.";
  else if (i.title.length > EVIDENCE_LIMITS.title) e.title = `Keep the title within ${EVIDENCE_LIMITS.title} characters.`;
  if (i.detail.length > EVIDENCE_LIMITS.detail) e.detail = `Keep the description within ${EVIDENCE_LIMITS.detail} characters.`;
  const outside = i.sourceType !== null && i.sourceType !== "ANALYST_OBSERVATION";
  if (i.observedAt === null) {
    if (outside) e.observedAt = "Enter the date this was published or observed.";
  } else if (parseIsoDate(i.observedAt) === null) e.observedAt = "Enter a valid date.";
  else if (i.observedAt > todayIso(now)) e.observedAt = "The observation date cannot be in the future.";
  if (outside && i.sourceName === "") e.sourceName = "Name the source (for example “Ghana Statistical Service”).";
  else if (i.sourceName.length > EVIDENCE_LIMITS.sourceName) e.sourceName = `Keep the source name within ${EVIDENCE_LIMITS.sourceName} characters.`;
  if (i.sourceUrl !== "" && parseHttpUrl(i.sourceUrl) === null) e.sourceUrl = "Enter a full web address starting with http:// or https://.";
  return e;
}

export const hasEvidenceErrors = (e: EvidenceErrors) => Object.keys(e).length > 0;
