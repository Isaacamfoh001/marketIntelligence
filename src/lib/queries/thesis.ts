// ---------------------------------------------------------------------------
// Thesis reads (M9.1) — the ONE place theses are queried. A thesis is joined to its
// subject for display and to portfolios at read time; nothing about holdings is stored
// on the thesis (thesis ≠ position).
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { securityShortLabel } from "../fixed-income";
import { getInstrumentContext, getPortfolios } from "./portfolio";
import { currentFigureIfRevised } from "./thesis-evidence";
import { billContext, bondContext, equityContext, heldRows, SUBJECT_HREF, type ContextFact, type HeldRow } from "../thesis/context";
import { catalystTiming, compareEvidence, computeResearch, evidenceDay, readSnapshot, sortTimeline, TIMELINE_LABEL, windowLabel, type CatalystStatus, type CatalystTiming, type CatalystWindow, type EvidenceRefKind, type EvidenceRelevance, type EvidenceSnapshot, type EvidenceSourceType, type EvidenceStance, type InvalidationFlag, type ResearchState, type ThesisConfidence, type ThesisContent, type ThesisHorizon, type ThesisStatus, type ThesisSubjectKind, type ThesisSubjectRef, type TimelineEntry } from "../thesis";

export interface ThesisSubject {
  kind: ThesisSubjectKind;
  ref: ThesisSubjectRef;
  /** Headline: "MTN Ghana", "GoG 22.00% Jul-34", "91-day Treasury bills". */
  label: string;
  /** Secondary: ticker, instrument code or description. */
  sublabel: string;
  /** Stable code used for filtering and URLs. */
  code: string;
  href: string;
}

export interface ThesisSummary {
  id: string;
  title: string;
  belief: string;
  status: ThesisStatus;
  confidence: ThesisConfidence | null;
  horizon: ThesisHorizon | null;
  subject: ThesisSubject;
  subjectKind: ThesisSubjectKind;
  subjectLabel: string;
  subjectCode: string;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
  research: ResearchSummary;
}

/** What the research layer says about a thesis in a list or on a security page — facts and reasons, never a score. */
export interface ResearchSummary {
  counts: ResearchState["counts"];
  newSinceReview: number;
  lastReviewedAt: string | null;
  reviewSuggested: boolean;
  reasons: ResearchState["reasons"];
  nextCatalyst: { description: string; label: string; timing: CatalystTiming | null } | null;
}

export interface ThesisDetail extends ThesisSummary, ThesisContent {
  statusNote: string | null;
}

const LIGHT = {
  conditions: { where: { kind: "INVALIDATION" as const }, select: { id: true, kind: true, flag: true, flagChangedAt: true, retiredAt: true } },
  catalysts: { select: { id: true, description: true, status: true, statusChangedAt: true, windowKind: true, windowStart: true, windowEnd: true } },
  evidence: { where: { archivedAt: null }, select: { id: true, stance: true, relevance: true, observedAt: true, createdAt: true } },
  reviews: { select: { reviewedAt: true } },
} as const;

const INCLUDE = {
  security: { include: { company: { select: { name: true } } } },
  fixedIncomeSecurity: true,
  treasuryInstrument: true,
  ...LIGHT,
} as const;

const windowOf = (c: { windowKind: string; windowStart: Date | null; windowEnd: Date | null }): CatalystWindow => (c.windowKind === "NONE" || !c.windowStart || !c.windowEnd ? { kind: "NONE", start: null, end: null } : { kind: c.windowKind as "DATE" | "MONTH" | "QUARTER", start: day(c.windowStart), end: day(c.windowEnd) });

type ResearchRow = { status: ThesisStatus; createdAt: Date; conditions: { id: string; kind: string; flag: InvalidationFlag; flagChangedAt: Date | null; retiredAt: Date | null }[]; catalysts: { id: string; description: string; status: CatalystStatus; statusChangedAt: Date; windowKind: string; windowStart: Date | null; windowEnd: Date | null }[]; evidence: { id: string; stance: EvidenceStance; relevance: EvidenceRelevance; observedAt: Date | null; createdAt: Date }[]; reviews: { reviewedAt: Date }[] };

export function researchStateOf(row: ResearchRow, now: Date = new Date()): ResearchState {
  return computeResearch({
    status: row.status,
    createdAt: iso(row.createdAt),
    evidence: row.evidence.map((e) => ({ id: e.id, stance: e.stance, relevance: e.relevance, observedAt: e.observedAt ? day(e.observedAt) : null, createdAt: iso(e.createdAt) })),
    conditions: row.conditions.map((c) => ({ id: c.id, kind: c.kind as "MUST_BE_TRUE" | "INVALIDATION", flag: c.flag, flagChangedAt: c.flagChangedAt ? iso(c.flagChangedAt) : null, retired: c.retiredAt !== null })),
    catalysts: row.catalysts.map((c) => ({ id: c.id, status: c.status, statusChangedAt: iso(c.statusChangedAt), window: windowOf(c) })),
    reviewedAt: row.reviews.map((r) => iso(r.reviewedAt)),
    now,
  });
}

function researchSummaryOf(row: ResearchRow, now: Date = new Date()): ResearchSummary {
  const s = researchStateOf(row, now);
  const next = row.catalysts.find((c) => c.id === s.nextCatalystId);
  const w = next ? windowOf(next) : null;
  return { counts: s.counts, newSinceReview: s.since.total, lastReviewedAt: s.lastReviewedAt, reviewSuggested: s.reviewSuggested, reasons: s.reasons, nextCatalyst: next && w ? { description: next.description, label: windowLabel(w), timing: catalystTiming(next.status, w, now) } : null };
}

type Row = NonNullable<Awaited<ReturnType<typeof findOne>>>;
const findOne = (id: string) => getPrisma().thesis.findUnique({ where: { id }, include: INCLUDE });

const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

export function subjectOf(row: { security: { id: string; ticker: string; company: { name: string } } | null; fixedIncomeSecurity: { id: string; instrumentCode: string; instrumentName: string; issuerName: string; couponRatePct: unknown; maturityDate: Date; instrumentType: string } | null; treasuryInstrument: { id: string; code: string; tenorDays: number } | null }): ThesisSubject {
  if (row.security) {
    const s = row.security;
    return { kind: "EQUITY", ref: { type: "SECURITY", id: s.id }, label: s.company.name, sublabel: s.ticker, code: s.ticker, href: SUBJECT_HREF("EQUITY", s.ticker) };
  }
  if (row.fixedIncomeSecurity) {
    const b = row.fixedIncomeSecurity;
    const kind: ThesisSubjectKind = b.instrumentType === "GOVERNMENT_BOND" ? "GOVERNMENT_BOND" : "CORPORATE_BOND";
    return { kind, ref: { type: "FIXED_INCOME", id: b.id }, label: securityShortLabel(b.issuerName, b.couponRatePct === null ? null : Number(b.couponRatePct), day(b.maturityDate)), sublabel: b.instrumentCode, code: b.instrumentCode, href: SUBJECT_HREF(kind, b.instrumentCode) };
  }
  const t = row.treasuryInstrument!;
  return { kind: "TREASURY_BILL", ref: { type: "TREASURY_INSTRUMENT", id: t.id }, label: `${t.tenorDays}-day Treasury bills`, sublabel: t.code, code: t.code, href: SUBJECT_HREF("TREASURY_BILL", t.code) };
}

function summaryOf(row: Row): ThesisSummary {
  const subject = subjectOf(row);
  return { id: row.id, title: row.title, belief: row.belief, status: row.status, confidence: row.confidence, horizon: row.horizon, subject, subjectKind: subject.kind, subjectLabel: subject.label, subjectCode: subject.code, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), statusChangedAt: iso(row.statusChangedAt), research: researchSummaryOf(row) };
}

export async function listTheses(): Promise<ThesisSummary[]> {
  const rows = await getPrisma().thesis.findMany({ include: INCLUDE, orderBy: { updatedAt: "desc" } });
  return rows.map(summaryOf);
}

export async function getThesis(id: string): Promise<ThesisDetail | null> {
  const row = await findOne(id);
  if (!row) return null;
  // The analyst's two condition lists, as the live (non-retired) rows in the order they were written.
  const conds = await getPrisma().thesisCondition.findMany({ where: { thesisId: id, retiredAt: null }, orderBy: { position: "asc" }, select: { kind: true, text: true } });
  return { ...summaryOf(row), rationale: row.rationale, mustBeTrue: conds.filter((c) => c.kind === "MUST_BE_TRUE").map((c) => c.text), risks: row.risks, invalidation: conds.filter((c) => c.kind === "INVALIDATION").map((c) => c.text), watching: row.watching, statusNote: row.statusNote };
}

// --- Research: evidence, catalysts, conditions, reviews, timeline (M9.2) -----------------------------

export interface ConditionView {
  id: string;
  kind: "MUST_BE_TRUE" | "INVALIDATION";
  text: string;
  flag: InvalidationFlag;
  flagNote: string | null;
  flagChangedAt: string | null;
  retired: boolean;
  evidenceCount: number;
}
export interface CatalystView {
  id: string;
  description: string;
  window: CatalystWindow;
  windowLabel: string;
  status: CatalystStatus;
  occurredOn: string | null;
  outcomeNote: string | null;
  statusChangedAt: string;
  timing: CatalystTiming | null;
  evidenceCount: number;
}
export interface EvidenceView {
  id: string;
  stance: EvidenceStance;
  relevance: EvidenceRelevance;
  sourceType: EvidenceSourceType;
  title: string;
  detail: string | null;
  note: string | null;
  observedAt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  refKind: EvidenceRefKind | null;
  snapshot: EvidenceSnapshot | null;
  /** The source's CURRENT headline figure, present only when it differs from the frozen snapshot. */
  revisedTo: string | null;
  target: { kind: "CONDITION" | "CATALYST"; id: string; label: string; retired: boolean } | null;
  createdAt: string;
  /** Added after the thesis's last review (or since creation when never reviewed). */
  isNew: boolean;
  isMostImportantNew: boolean;
}
export interface ThesisResearch {
  state: ResearchState;
  evidence: EvidenceView[];
  archivedEvidenceCount: number;
  conditions: ConditionView[];
  catalysts: CatalystView[];
  reviews: { id: string; reviewedAt: string; note: string | null; statusAtReview: ThesisStatus }[];
  timeline: TimelineEntry[];
}

export async function getThesisResearch(thesisId: string, now: Date = new Date()): Promise<ThesisResearch | null> {
  const prisma = getPrisma();
  const t = await prisma.thesis.findUnique({
    where: { id: thesisId },
    include: {
      conditions: { orderBy: [{ kind: "asc" }, { position: "asc" }], include: { _count: { select: { evidence: { where: { archivedAt: null } } } } } },
      catalysts: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { _count: { select: { evidence: { where: { archivedAt: null } } } } } },
      evidence: { orderBy: { createdAt: "desc" }, include: { condition: { select: { id: true, text: true, retiredAt: true } }, catalyst: { select: { id: true, description: true } } } },
      reviews: { orderBy: { reviewedAt: "desc" } },
    },
  });
  if (!t) return null;
  const active = t.evidence.filter((e) => !e.archivedAt);
  const state = researchStateOf({ ...t, evidence: active }, now);

  const linked = active.flatMap((e) => {
    const snap = readSnapshot(e.snapshot);
    return e.refKind && e.refId && snap ? [{ id: e.id, refKind: e.refKind as EvidenceRefKind, refId: e.refId, fingerprint: snap.fingerprint }] : [];
  });
  const revised = await currentFigureIfRevised(linked);

  const evidence: EvidenceView[] = active.map((e) => ({
    id: e.id, stance: e.stance, relevance: e.relevance, sourceType: e.sourceType, title: e.title, detail: e.detail, note: e.note,
    observedAt: e.observedAt ? day(e.observedAt) : null, sourceName: e.sourceName, sourceUrl: e.sourceUrl, refKind: e.refKind as EvidenceRefKind | null,
    snapshot: readSnapshot(e.snapshot), revisedTo: revised.get(e.id) ?? null,
    target: e.condition ? { kind: "CONDITION", id: e.condition.id, label: e.condition.text, retired: e.condition.retiredAt !== null } : e.catalyst ? { kind: "CATALYST", id: e.catalyst.id, label: e.catalyst.description, retired: false } : null,
    createdAt: iso(e.createdAt), isNew: iso(e.createdAt) > state.baseline, isMostImportantNew: e.id === state.since.mostImportantId,
  }));
  evidence.sort((a, b) => compareEvidence({ id: a.id, stance: a.stance, relevance: a.relevance, observedAt: a.observedAt, createdAt: a.createdAt }, { id: b.id, stance: b.stance, relevance: b.relevance, observedAt: b.observedAt, createdAt: b.createdAt }));

  const conditions: ConditionView[] = t.conditions.map((c) => ({ id: c.id, kind: c.kind, text: c.text, flag: c.flag, flagNote: c.flagNote, flagChangedAt: c.flagChangedAt ? iso(c.flagChangedAt) : null, retired: c.retiredAt !== null, evidenceCount: c._count.evidence }));
  const catalysts: CatalystView[] = t.catalysts.map((c) => {
    const w = windowOf(c);
    return { id: c.id, description: c.description, window: w, windowLabel: windowLabel(w), status: c.status, occurredOn: c.occurredOn ? day(c.occurredOn) : null, outcomeNote: c.outcomeNote, statusChangedAt: iso(c.statusChangedAt), timing: catalystTiming(c.status, w, now), evidenceCount: c._count.evidence };
  });

  const timeline = sortTimeline([
    { kind: "THESIS_CREATED", date: day(t.createdAt), recordedAt: iso(t.createdAt), title: "Thesis created" },
    ...evidence.map((e): TimelineEntry => ({ kind: e.stance === "SUPPORTS" ? "SUPPORTING_EVIDENCE" : e.stance === "CHALLENGES" ? "CHALLENGING_EVIDENCE" : "CONTEXT_EVIDENCE", date: e.observedAt ?? e.createdAt.slice(0, 10), recordedAt: e.createdAt, title: e.title, href: `#evidence-${e.id}` })),
    ...catalysts.filter((c) => c.status === "OCCURRED").map((c): TimelineEntry => ({ kind: "CATALYST_OCCURRED", date: c.occurredOn ?? c.statusChangedAt.slice(0, 10), recordedAt: c.statusChangedAt, title: c.description, detail: c.outcomeNote ?? undefined, href: `#catalyst-${c.id}` })),
    ...conditions.filter((c) => c.kind === "INVALIDATION" && c.flag !== "NOT_OBSERVED" && c.flagChangedAt && !c.retired).map((c): TimelineEntry => ({ kind: "INVALIDATION_FLAGGED", date: c.flagChangedAt!.slice(0, 10), recordedAt: c.flagChangedAt!, title: c.text, detail: `${c.flag === "TRIGGERED" ? "Marked triggered" : "Marked potentially triggered"}${c.flagNote ? ` — ${c.flagNote}` : ""}`, href: `#condition-${c.id}` })),
    ...t.reviews.map((r): TimelineEntry => ({ kind: "THESIS_REVIEWED", date: day(r.reviewedAt), recordedAt: iso(r.reviewedAt), title: "Thesis reviewed", detail: r.note ?? undefined })),
  ]);

  return { state, evidence, archivedEvidenceCount: t.evidence.length - active.length, conditions, catalysts, reviews: t.reviews.map((r) => ({ id: r.id, reviewedAt: iso(r.reviewedAt), note: r.note, statusAtReview: r.statusAtReview })), timeline };
}

export { evidenceDay, TIMELINE_LABEL };

// --- Subject picker ---------------------------------------------------------------------------------

export interface SubjectOption extends ThesisSubject {
  /** Lower-cased text the picker searches. */
  search: string;
  /** Shown to avoid ambiguity: maturity, coupon, issuer, exchange. */
  detail: string;
  /** Bonds that are matured/called/defaulted are still selectable (a thesis may be retrospective) but are marked. */
  note: string | null;
}

export async function getSubjectOptions(): Promise<SubjectOption[]> {
  const prisma = getPrisma();
  const [securities, bonds, instruments] = await Promise.all([
    prisma.security.findMany({ include: { company: { select: { name: true, sector: true } } }, orderBy: { ticker: "asc" } }),
    prisma.fixedIncomeSecurity.findMany({ orderBy: [{ instrumentType: "asc" }, { maturityDate: "asc" }] }),
    prisma.treasuryInstrument.findMany({ where: { instrumentType: "BILL" }, orderBy: { tenorDays: "asc" } }),
  ]);
  const out: SubjectOption[] = [];
  for (const s of securities) {
    const subject = subjectOf({ security: s, fixedIncomeSecurity: null, treasuryInstrument: null });
    out.push({ ...subject, detail: `${s.ticker} · ${s.company.sector ?? "Ghana Stock Exchange"}`, note: s.active ? null : "Inactive listing", search: `${s.ticker} ${s.company.name} ${s.company.sector ?? ""}`.toLowerCase() });
  }
  for (const b of bonds) {
    const subject = subjectOf({ security: null, fixedIncomeSecurity: b, treasuryInstrument: null });
    const coupon = b.couponRatePct === null ? "" : ` · ${Number(b.couponRatePct).toFixed(2)}% coupon`;
    out.push({ ...subject, detail: `${b.instrumentCode} · ${b.issuerName} · matures ${day(b.maturityDate)}${coupon}`, note: b.status === "ACTIVE" ? null : `Status: ${b.status.toLowerCase()}`, search: `${b.instrumentCode} ${b.instrumentName} ${b.issuerName} ${day(b.maturityDate)} ${b.isin ?? ""}`.toLowerCase() });
  }
  for (const t of instruments) {
    const subject = subjectOf({ security: null, fixedIncomeSecurity: null, treasuryInstrument: t });
    out.push({ ...subject, detail: "A view on this Treasury-bill tenor, not one dated bill", note: null, search: `${t.name} ${t.code} treasury bill ${t.tenorDays} day`.toLowerCase() });
  }
  return out;
}

// --- Context ----------------------------------------------------------------------------------------

export interface ThesisContextView {
  valuationDate: string;
  facts: ContextFact[];
  held: HeldRow[];
  /** Existing Scenario Studio pages for portfolios that hold the subject — links only; no scenario is created or run here. */
  scenarioLinks: { portfolioId: string; portfolioName: string; href: string }[];
  links: { label: string; href: string }[];
}

export async function getThesisContext(subject: ThesisSubject): Promise<ThesisContextView> {
  const ctx = await getInstrumentContext();
  const portfolios = await getPortfolios({ archived: false }, ctx);
  let facts: ContextFact[] = [];
  let held: HeldRow[] = [];
  const links: { label: string; href: string }[] = [];
  if (subject.ref.type === "SECURITY") {
    const id = subject.ref.id;
    const e = ctx.equityById.get(id);
    facts = e ? equityContext(e) : [];
    held = heldRows(portfolios, (p) => p.holding.assetClass === "EQUITY" && p.holding.securityId === id);
    links.push({ label: "Company page", href: subject.href }, { label: "Equities", href: "/equities" });
  } else if (subject.ref.type === "FIXED_INCOME") {
    const id = subject.ref.id;
    const b = ctx.bondById.get(id);
    facts = b ? bondContext(b, ctx.valuationDate) : [];
    held = heldRows(portfolios, (p) => p.holding.assetClass === "BOND" && p.holding.fixedIncomeSecurityId === id);
    links.push({ label: "Security page", href: subject.href }, { label: "Macro & rates", href: "/macro-rates" });
  } else {
    const instrument = await getPrisma().treasuryInstrument.findUnique({ where: { id: subject.ref.id }, select: { tenorDays: true } });
    const tenor = instrument?.tenorDays ?? 0;
    facts = billContext(tenor, ctx.curve, ctx.valuationDate, ctx.bills);
    held = heldRows(portfolios, (p) => p.instrument.kind === "TREASURY_BILL" && p.instrument.tenorDays === tenor);
    links.push({ label: "Macro & rates", href: "/macro-rates" });
  }
  const seen = new Set<string>();
  const scenarioLinks = held.filter((h) => !seen.has(h.portfolioId) && seen.add(h.portfolioId)).map((h) => ({ portfolioId: h.portfolioId, portfolioName: h.portfolioName, href: `/portfolios/${h.portfolioId}/scenarios` }));
  return { valuationDate: day(ctx.valuationDate), facts, held, scenarioLinks, links };
}

// --- Thesis presence on holdings -------------------------------------------------------------------

export interface ThesisPresence {
  /** ACTIVE + CHALLENGED. */
  live: number;
  total: number;
  /** The most recently updated live thesis (to show a one-line summary), else null. */
  lead: { id: string; title: string; status: ThesisStatus; confidence: ThesisConfidence | null; horizon: ThesisHorizon | null; belief: string; research: ResearchSummary } | null;
  /** True when ANY live thesis on the subject has a review suggestion. */
  reviewSuggested: boolean;
}

/** Thesis presence for each holding of a portfolio, keyed by positionId. Matching is by subject — a thesis never references a position. */
export async function getThesisPresenceForPositions(positions: { positionId: string; holding: { assetClass: "BOND" | "EQUITY" | "TREASURY_BILL" } & Record<string, unknown>; instrument: { kind: string; tenorDays?: number } }[]): Promise<Map<string, ThesisPresence>> {
  const prisma = getPrisma();
  const theses = await prisma.thesis.findMany({ where: { status: { not: "DRAFT" } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, status: true, confidence: true, horizon: true, belief: true, createdAt: true, securityId: true, fixedIncomeSecurityId: true, treasuryInstrument: { select: { tenorDays: true } }, ...LIGHT } });
  const out = new Map<string, ThesisPresence>();
  for (const p of positions) {
    const mine = theses.filter((t) => (p.holding.assetClass === "EQUITY" ? t.securityId === p.holding.securityId : p.holding.assetClass === "BOND" ? t.fixedIncomeSecurityId === p.holding.fixedIncomeSecurityId : t.treasuryInstrument?.tenorDays === p.instrument.tenorDays));
    const liveOnes = mine.filter((t) => t.status === "ACTIVE" || t.status === "CHALLENGED");
    const lead = liveOnes[0] ?? null;
    out.set(p.positionId, { live: liveOnes.length, total: mine.length, lead: lead ? { id: lead.id, title: lead.title, status: lead.status, confidence: lead.confidence, horizon: lead.horizon, belief: lead.belief, research: researchSummaryOf(lead) } : null, reviewSuggested: liveOnes.some((t) => researchSummaryOf(t).reviewSuggested) });
  }
  return out;
}

/** Theses (any status) about one subject, newest first — for the "Theses" panel on a security page. */
export async function listThesesForSubject(ref: ThesisSubjectRef): Promise<ThesisSummary[]> {
  const where = ref.type === "SECURITY" ? { securityId: ref.id } : ref.type === "FIXED_INCOME" ? { fixedIncomeSecurityId: ref.id } : { treasuryInstrumentId: ref.id };
  const rows = await getPrisma().thesis.findMany({ where, include: INCLUDE, orderBy: { updatedAt: "desc" } });
  return rows.map(summaryOf);
}

/** The thesis subject a holding corresponds to (a bill holding maps to its tenor). Null when the tenor instrument is missing. */
export async function subjectRefForPosition(row: { holding: { assetClass: "BOND" | "EQUITY" | "TREASURY_BILL" } & Record<string, unknown>; instrument: { kind: string; tenorDays?: number } }): Promise<ThesisSubjectRef | null> {
  if (row.holding.assetClass === "EQUITY") return { type: "SECURITY", id: String(row.holding.securityId) };
  if (row.holding.assetClass === "BOND") return { type: "FIXED_INCOME", id: String(row.holding.fixedIncomeSecurityId) };
  const t = await getPrisma().treasuryInstrument.findFirst({ where: { tenorDays: row.instrument.tenorDays, instrumentType: "BILL" }, select: { id: true } });
  return t ? { type: "TREASURY_INSTRUMENT", id: t.id } : null;
}

export const presenceOf = (list: ThesisSummary[]): ThesisPresence => {
  const live = list.filter((t) => t.status === "ACTIVE" || t.status === "CHALLENGED");
  const lead = live[0] ?? null;
  return { live: live.length, total: list.filter((t) => t.status !== "DRAFT").length, lead: lead ? { id: lead.id, title: lead.title, status: lead.status, confidence: lead.confidence, horizon: lead.horizon, belief: lead.belief, research: lead.research } : null, reviewSuggested: live.some((t) => t.research.reviewSuggested) };
};

/** Thesis presence for a security page, found by ticker (equity) or instrument code (bond). Null when the subject is not found. */
export async function getThesisPanelFor(by: { ticker: string } | { instrumentCode: string }): Promise<{ presence: ThesisPresence; createHref: string } | null> {
  const prisma = getPrisma();
  let ref: ThesisSubjectRef | null = null;
  if ("ticker" in by) {
    const s = await prisma.security.findUnique({ where: { ticker: by.ticker }, select: { id: true } });
    if (s) ref = { type: "SECURITY", id: s.id };
  } else {
    const b = await prisma.fixedIncomeSecurity.findUnique({ where: { instrumentCode: by.instrumentCode }, select: { id: true } });
    if (b) ref = { type: "FIXED_INCOME", id: b.id };
  }
  if (!ref) return null;
  const list = await listThesesForSubject(ref);
  return { presence: presenceOf(list), createHref: `/theses/new?subjectType=${ref.type}&subjectId=${encodeURIComponent(ref.id)}` };
}
