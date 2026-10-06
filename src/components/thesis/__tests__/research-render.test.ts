// M9.2 — what the analyst and a screen reader get from evidence, catalysts and review.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSnapshot, computeResearch, parseWindow, windowLabel, type EvidenceStance, type InvalidationFlag } from "@/lib/thesis";
import type { CatalystView, ConditionView, EvidenceView, ThesisContextView, ThesisResearch, ThesisSummary } from "@/lib/queries/thesis";
import { EvidenceSection } from "../EvidenceSection";
import { EvidenceCard } from "../EvidenceCard";
import { ReviewPanel } from "../ReviewPanel";
import { CatalystSection } from "../CatalystSection";
import { InvalidationList, MustBeTrueList } from "../ConditionLists";
import { Timeline } from "../Timeline";
import { ContextPanel } from "../ContextPanel";
import { ThesisCard } from "../ThesisCard";
import { ThesisChip, ThesisPanel } from "../HoldingThesis";
import { EvidenceForm } from "../EvidenceForm";
import { FlagBadge, StanceBadge } from "../evidence-ui";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const snap = buildSnapshot({ refKind: "MACRO_OBSERVATION", datasetLabel: "Ghana CPI Inflation — YoY", displayValue: "23.80%", unit: "%", observationDate: "2026-09-30", details: [{ label: "Frequency", value: "monthly" }], source: { name: "GSS Inflation", provider: "Ghana Statistical Service", ingestionRunId: "run1", retrievedAt: "2026-10-02T00:00:00.000Z", acquisitionMethod: null }, fingerprint: "23.8", stale: false, now: new Date("2026-10-03T00:00:00.000Z") });
const ev = (over: Partial<EvidenceView> = {}): EvidenceView => ({ id: "e1", stance: "SUPPORTS", relevance: "HIGH", sourceType: "ANALYST_OBSERVATION", title: "Auction cover looked thin", detail: null, note: null, observedAt: null, sourceName: null, sourceUrl: null, refKind: null, snapshot: null, revisedTo: null, target: null, createdAt: "2026-10-03T00:00:00.000Z", isNew: false, isMostImportantNew: false, ...over });
const linked = (over: Partial<EvidenceView> = {}) => ev({ id: "k1", sourceType: "KORBLY_DATA", title: "Ghana CPI Inflation — YoY: 23.80% (30 Sep 2026)", refKind: "MACRO_OBSERVATION", snapshot: snap, observedAt: "2026-09-30", note: "Consistent with the disinflation condition.", ...over });
const external = (over: Partial<EvidenceView> = {}) => ev({ id: "x1", stance: "CHALLENGES", sourceType: "EXTERNAL_SOURCE", title: "Broker note flags fiscal slippage", sourceName: "Acme Research", sourceUrl: "https://example.com/note?id=1", observedAt: "2026-09-28", detail: "Slippage of 0.5% of GDP.", ...over });
const research = (evidence: EvidenceView[], over: Partial<ThesisResearch> = {}): ThesisResearch => {
  const state = computeResearch({ status: "ACTIVE", createdAt: "2026-09-01T00:00:00.000Z", evidence: evidence.map((e) => ({ id: e.id, stance: e.stance, relevance: e.relevance, observedAt: e.observedAt, createdAt: e.createdAt })), conditions: [], catalysts: [], reviewedAt: [], now: new Date("2026-10-05T00:00:00.000Z") });
  return { state, evidence, archivedEvidenceCount: 0, conditions: [], catalysts: [], reviews: [], timeline: [], ...over };
};
const cond = (over: Partial<ConditionView> = {}): ConditionView => ({ id: "c1", kind: "INVALIDATION", text: "Inflation reaccelerates materially", flag: "NOT_OBSERVED", flagNote: null, flagChangedAt: null, retired: false, evidenceCount: 0, ...over });
const cat = (over: Partial<CatalystView> = {}): CatalystView => {
  const window = parseWindow("MONTH", "2026-11")!;
  return { id: "k1", description: "Next Bank of Ghana MPC decision", window, windowLabel: windowLabel(window), status: "WATCHING", occurredOn: null, outcomeNote: null, statusChangedAt: "2026-10-01T00:00:00.000Z", timing: "UPCOMING", evidenceCount: 0, ...over };
};

describe("evidence section", () => {
  it("empty state invites the first item and shows no counts as a verdict", () => {
    const m = html(createElement(EvidenceSection, { thesisId: "t1", research: research([]), editable: true }));
    expect(m).toContain("No evidence has been added yet");
    expect(m).toContain("Add evidence");
    expect(text(m)).toContain("No evidence has been recorded yet.");
  });
  it("supporting and challenging evidence sit in separate, labelled sections — the tension is visible", () => {
    const m = html(createElement(EvidenceSection, { thesisId: "t1", research: research([linked(), external()]), editable: true }));
    expect(m).toMatch(/<h3 id="supporting-h"[^>]*>[\s\S]*Supporting/);
    expect(m).toMatch(/<h3 id="challenging-h"[^>]*>[\s\S]*Challenging/);
    const supporting = m.slice(m.indexOf('id="supporting-h"'), m.indexOf('id="challenging-h"'));
    const challenging = m.slice(m.indexOf('id="challenging-h"'));
    expect(supporting).toContain("Ghana CPI Inflation");
    expect(supporting).not.toContain("Broker note");
    expect(challenging).toContain("Broker note");
    expect(text(m)).toContain("1 supporting and 1 challenging evidence items are recorded");
  });
  it("says plainly when one side is empty", () => {
    const m = html(createElement(EvidenceSection, { thesisId: "t1", research: research([linked()]), editable: true }));
    expect(m).toContain("Nothing recorded that challenges the thesis.");
  });
  it("puts context evidence in its own quieter group", () => {
    const m = html(createElement(EvidenceSection, { thesisId: "t1", research: research([linked(), ev({ id: "c9", stance: "CONTEXT", title: "Background note" })]), editable: true }));
    expect(m).toMatch(/<details[^>]*>[\s\S]*Context[\s\S]*Background note/);
  });
  it("a read-only (invalidated/closed) thesis offers no add, edit or remove", () => {
    const m = html(createElement(EvidenceSection, { thesisId: "t1", research: research([linked()]), editable: false }));
    expect(m).not.toContain("Add evidence");
    expect(m).not.toContain("Open &amp; edit");
    expect(m).not.toContain("Remove evidence");
  });
  it("does not compute a score, percentage or verdict", () => {
    const m = text(html(createElement(EvidenceSection, { thesisId: "t1", research: research([linked(), linked({ id: "k2" }), external()]), editable: true })));
    expect(m).not.toMatch(/\bscore\b|\d\s?\/\s?100|%\s?(likely|probab)|health|winning|confirmed|disproved/i);
  });
  it("stance is a word and a glyph, never colour alone, and avoids good/bad language", () => {
    for (const s of ["SUPPORTS", "CHALLENGES", "CONTEXT"] as EvidenceStance[]) {
      const m = html(createElement(StanceBadge, { stance: s }));
      expect(m).toMatch(/aria-hidden="true">[⊕⊖◌]</);
      expect(text(m)).toMatch(/Supports|Challenges|Context/);
    }
  });
});

describe("evidence card", () => {
  it("Korbly-linked evidence shows the frozen observation, its date, source, retrieval and the analyst's interpretation separately", () => {
    const m = html(createElement(EvidenceCard, { e: linked(), thesisId: "t1", editable: true, showStance: true }));
    const t = text(m);
    expect(t).toContain("23.80%");
    expect(t).toContain("observed 30 Sep 2026");
    expect(t).toContain("GSS Inflation");
    expect(t).toContain("Ghana Statistical Service");
    expect(t).toContain("retrieved 2 Oct 2026");
    expect(t).toContain("Analyst interpretation");
    expect(t).toContain("Consistent with the disinflation condition.");
    expect(t).toContain("frozen as it was when linked");
  });
  it("preserves data-quality context: older data is labelled, and a later source revision is reported without replacing the record", () => {
    const stale = buildSnapshot({ refKind: "FX_RATE", datasetLabel: "USD/GHS mid rate", displayValue: "10.4000 GHS per USD", unit: "GHS per USD", observationDate: "2026-07-01", source: snap.source, fingerprint: "x", stale: true, now: new Date("2026-10-03T00:00:00.000Z") });
    const m = text(html(createElement(EvidenceCard, { e: linked({ snapshot: stale, revisedTo: "10.9000 GHS per USD" }), thesisId: "t1", editable: true })));
    expect(m).toContain("Older data when linked");
    expect(m).toContain("The source has since published a different figure");
    expect(m).toContain("Source now shows 10.9000");
    expect(m).toContain("10.4000 GHS per USD");
  });
  it("external evidence shows the source, the date and the link as the analyst's reference — and says Korbly has not verified it", () => {
    const m = html(createElement(EvidenceCard, { e: external(), thesisId: "t1", editable: true }));
    expect(m).toContain("Acme Research");
    expect(m).toContain('href="https://example.com/note?id=1"');
    expect(m).toContain('rel="noopener noreferrer nofollow"');
    expect(m).toContain('target="_blank"');
    expect(text(m)).toContain("Analyst-linked source. Korbly has not opened it and does not verify its contents.");
    expect(text(m)).not.toMatch(/verified by Korbly|Korbly verified/i);
  });
  it("an analyst observation is labelled as such and shows no invented source or identity", () => {
    const m = text(html(createElement(EvidenceCard, { e: ev(), thesisId: "t1", editable: true })));
    expect(m).toContain("Analyst observation — written by an analyst, with no outside source.");
    expect(m).not.toMatch(/by [A-Z][a-z]+ [A-Z][a-z]+/);
  });
  it("shows what it is about when linked to a condition, and notes a retired one", () => {
    expect(text(html(createElement(EvidenceCard, { e: ev({ target: { kind: "CONDITION", id: "c1", label: "Inflation keeps moderating", retired: true } }), thesisId: "t1", editable: true })))).toContain("About the condition: “Inflation keeps moderating” (since reworded or removed)");
  });
  it("marks items new since the last review and offers a labelled edit/remove", () => {
    const m = html(createElement(EvidenceCard, { e: ev({ isNew: true }), thesisId: "t1", editable: true }));
    expect(m).toContain("New since review");
    expect(m).toContain('href="/theses/t1/evidence/e1"');
    expect(m).toContain("Remove evidence");
  });
});

describe("review panel", () => {
  const live = (e: EvidenceView[], extra: Partial<ThesisResearch> = {}) => research(e, extra);
  const held = [{ portfolioId: "p1", portfolioName: "Core Ghana", positionId: "pos1", href: "/portfolios/p1", status: "VALUED" as const, valueLabel: "Analytical Starting Value" as const, valueGhs: 2_400_000, weightPct: 22, basis: "ANALYST_ASSUMPTION" as const, assumption: null, inactiveAssumptionSummary: null, unvaluedReason: null }];
  it("when review is suggested: says so, lists every reason in words, shows exposure, and offers only 'Mark as reviewed'", () => {
    const r = live([external({ relevance: "HIGH", createdAt: "2026-10-04T00:00:00.000Z", isNew: true, isMostImportantNew: true })]);
    const m = html(createElement(ReviewPanel, { thesisId: "t1", status: "ACTIVE", research: r, held }));
    const t = text(m);
    expect(t).toContain("Review suggested");
    expect(t).toContain("High-relevance challenging evidence was added");
    expect(t).toContain("Held in");
    expect(t).toContain("Core Ghana");
    expect(t).toContain("Analytical Starting Value");
    expect(t).toContain("22.0% of the portfolio’s valued total");
    expect(t).toContain("Mark as reviewed");
    expect(t).toContain("Status and confidence are set only by the analyst");
    expect(t).not.toMatch(/reduce|increase exposure|\bsell\b|\bbuy\b|invalidated/i);
  });
  it("shows what is new since the last review, split by stance, and where to look first", () => {
    const r = live([external({ isNew: true, isMostImportantNew: true }), linked({ isNew: true })]);
    const t = text(html(createElement(ReviewPanel, { thesisId: "t1", status: "ACTIVE", research: r, held: [] })));
    expect(t).toContain("2 new evidence items · 1 supporting · 1 challenging");
    expect(t).toContain("Look first at");
    expect(t).toContain("Broker note flags fiscal slippage");
    expect(t).toContain("Never reviewed — counting from when the thesis was created.");
  });
  it("D. with nothing new it does not suggest a review but still offers the action", () => {
    const m = html(createElement(ReviewPanel, { thesisId: "t1", status: "ACTIVE", research: live([]), held }));
    expect(text(m)).not.toContain("Review suggested");
    expect(text(m)).toContain("Nothing new needs a second look");
    expect(text(m)).not.toContain("Held in"); // exposure appears with a suggestion, not as noise
    expect(m).toContain("Mark as reviewed");
  });
  it("is not shown for drafts or retired theses", () => {
    for (const status of ["DRAFT", "INVALIDATED", "CLOSED"] as const) expect(html(createElement(ReviewPanel, { thesisId: "t1", status, research: live([]), held: [] }))).toBe("");
  });
  it("the review form has a labelled optional note and says review is not agreement", () => {
    const m = html(createElement(ReviewPanel, { thesisId: "t1", status: "ACTIVE", research: live([]), held: [] }));
    expect(m).toMatch(/<label[^>]*for="review-note"/);
    expect(text(m)).toContain("does not mean you agree with it, and nothing is deleted");
  });
});

describe("catalysts", () => {
  it("empty state", () => expect(text(html(createElement(CatalystSection, { thesisId: "t1", catalysts: [], nextId: null, editable: true })))).toContain("No catalysts tracked yet"));
  it("answers: what are we waiting for, when, and its status — with the next one featured", () => {
    const m = html(createElement(CatalystSection, { thesisId: "t1", catalysts: [cat(), cat({ id: "k2", description: "Q1 2027 budget", status: "WATCHING", window: parseWindow("QUARTER", "2027-Q1")!, windowLabel: "Q1 2027" })], nextId: "k1", editable: true }));
    const t = text(m);
    expect(t).toContain("Next catalyst");
    expect(t).toContain("Next Bank of Ghana MPC decision");
    expect(t).toContain("Expected: November 2026");
    expect(t).toContain("Watching");
    expect(t).toContain("Upcoming");
    expect(t).toContain("Q1 2027");
  });
  it("a passed window says 'review', never 'missed'", () => {
    const t = text(html(createElement(CatalystSection, { thesisId: "t1", catalysts: [cat({ timing: "WINDOW_PASSED" })], nextId: "k1", editable: true })));
    expect(t).toContain("Window passed — review");
    expect(t).not.toMatch(/missed catalyst|failed/i);
  });
  it("an occurred catalyst shows the date and the analyst's interpretation, and does not claim success", () => {
    const t = text(html(createElement(CatalystSection, { thesisId: "t1", catalysts: [cat({ status: "OCCURRED", timing: null, occurredOn: "2026-09-25", outcomeNote: "Held at 14%." })], nextId: null, editable: true })));
    expect(t).toContain("Catalyst occurred · 25 Sep 2026");
    expect(t).toContain("Analyst interpretation");
    expect(t).toContain("Held at 14%.");
    expect(t).toContain("Record as evidence");
    expect(t).toContain("does not say the thesis succeeded");
    expect(t.replace("it does not say the thesis succeeded", "")).not.toMatch(/thesis (strengthened|confirmed|succeeded|proved)/i);
  });
  it("has no task-manager affordances (assignee, due, reminder)", () => expect(html(createElement(CatalystSection, { thesisId: "t1", catalysts: [cat()], nextId: "k1", editable: true }))).not.toMatch(/assign|due date|reminder|priority|sprint/i));
  it("status controls and add form are labelled; read-only theses show none", () => {
    const m = html(createElement(CatalystSection, { thesisId: "t1", catalysts: [cat()], nextId: "k1", editable: true }));
    expect(m).toMatch(/<label[^>]*for="new-cat-desc"/);
    expect(m).toContain("Update status");
    expect(m).toContain("does not change the thesis status or confidence");
    const ro = html(createElement(CatalystSection, { thesisId: "t1", catalysts: [cat()], nextId: "k1", editable: false }));
    expect(ro).not.toContain("Update status");
    expect(ro).not.toContain("Add catalyst");
  });
});

describe("invalidation conditions", () => {
  it("a potentially triggered condition is prominent, dated and explicit that the thesis status is unchanged", () => {
    const m = html(createElement(InvalidationList, { thesisId: "t1", items: [cond({ flag: "POTENTIALLY_TRIGGERED", flagNote: "CPI jumped", flagChangedAt: "2026-10-02T00:00:00.000Z" })], editable: true }));
    const t = text(m);
    expect(t).toContain("Potentially triggered");
    expect(t).toContain("by the analyst on 2 Oct 2026");
    expect(t).toContain("CPI jumped");
    expect(t).toContain("This is a reason to review the thesis. The thesis status is unchanged.");
    expect(t).not.toMatch(/thesis invalidated|has been invalidated/i);
  });
  it.each(["NOT_OBSERVED", "POTENTIALLY_TRIGGERED", "TRIGGERED"] as InvalidationFlag[])("flag %s has a word and a glyph", (f) => {
    const m = html(createElement(FlagBadge, { flag: f }));
    expect(m).toMatch(/aria-hidden="true">[○◐●]</);
    expect(text(m)).toMatch(/Not observed|Potentially triggered|Triggered/);
  });
  it("offers only the allowed next flags, with a labelled note", () => {
    const m = html(createElement(InvalidationList, { thesisId: "t1", items: [cond({ flag: "TRIGGERED" })], editable: true }));
    expect(m).toContain('value="POTENTIALLY_TRIGGERED"');
    expect(m).not.toContain('value="NOT_OBSERVED"');
    expect(m).toMatch(/<label[^>]*for="flag-note-c1"/);
  });
  it("does not nest a form inside a paragraph (invalid HTML that breaks hydration)", () => {
    const m = html(createElement(InvalidationList, { thesisId: "t1", items: [cond()], editable: true }));
    expect(m).not.toMatch(/<p[^>]*>(?:(?!<\/p>)[\s\S])*<form/);
  });
  it("must-be-true items show their linked evidence and an add-evidence link scoped to that condition", () => {
    const m = html(createElement(MustBeTrueList, { thesisId: "t1", items: [cond({ kind: "MUST_BE_TRUE", text: "Inflation keeps moderating", evidenceCount: 2 })], editable: true }));
    expect(text(m)).toContain("2 linked evidence");
    expect(m).toContain('href="/theses/t1/evidence/new?condition=c1"');
  });
});

describe("timeline", () => {
  it("lists what arrived by its meaningful date, newest first, with plain labels", () => {
    const m = text(html(createElement(Timeline, { entries: [
      { kind: "THESIS_REVIEWED", date: "2026-10-04", recordedAt: "2026-10-04T10:00:00.000Z", title: "Thesis reviewed" },
      { kind: "CHALLENGING_EVIDENCE", date: "2026-09-28", recordedAt: "2026-10-03T10:00:00.000Z", title: "Broker note", href: "#evidence-x1" },
      { kind: "THESIS_CREATED", date: "2026-09-01", recordedAt: "2026-09-01T10:00:00.000Z", title: "Thesis created" },
    ] })));
    expect(m.indexOf("Thesis reviewed")).toBeLessThan(m.indexOf("Broker note"));
    expect(m.indexOf("Broker note")).toBeLessThan(m.indexOf("Thesis created"));
    expect(m).toContain("Challenging evidence");
    expect(m).toContain("28 Sep 2026");
  });
});

describe("current Korbly context → add to evidence", () => {
  const ctx = (): ThesisContextView => ({ valuationDate: "2026-10-05", facts: [{ label: "Latest actual trade", value: "GHS 12.30", sub: "GSE closing price (VWAP) on 2026-10-02", evidenceRef: { kind: "EQUITY_PRICE", date: "2026-10-02" } }, { label: "Listed company", value: "MTN Ghana (MTNGH)" }], held: [], scenarioLinks: [], links: [] });
  const subject = { kind: "EQUITY" as const, ref: { type: "SECURITY" as const, id: "s1" }, label: "MTN Ghana", sublabel: "MTNGH", code: "MTNGH", href: "/companies/MTNGH" };
  it("offers 'Add to evidence' only on observations, scoped to the exact observation date — not a 'latest' pointer", () => {
    const m = html(createElement(ContextPanel, { context: ctx(), subject, thesisId: "t1" }));
    expect(m).toContain('href="/theses/t1/evidence/new?kind=EQUITY_PRICE&amp;date=2026-10-02"');
    expect(m.match(/Add to evidence/g)!.length).toBe(2); // the link text and its aria-label share the phrase once
    expect(text(m)).toContain("It becomes evidence only when an analyst chooses to add it.");
  });
  it("offers nothing when the thesis is read-only", () => expect(html(createElement(ContextPanel, { context: ctx(), subject }))).not.toContain("Add to evidence"));
});

describe("library and security-page summaries", () => {
  const research0 = { counts: { supports: 3, challenges: 2, context: 0, total: 5, high: 2 }, newSinceReview: 2, lastReviewedAt: "2026-09-12T00:00:00.000Z", reviewSuggested: true, reasons: [{ code: "HIGH_CHALLENGE" as const, persistent: false, at: "2026-10-03T00:00:00.000Z", text: "High-relevance challenging evidence was added 2 days ago." }, { code: "MATERIAL_EVIDENCE" as const, persistent: false, at: "2026-10-03T00:00:00.000Z", text: "2 new evidence items have been added since the last review." }], nextCatalyst: { description: "Next MPC decision", label: "November 2026", timing: "UPCOMING" as const } as ThesisSummary["research"]["nextCatalyst"] };
  const subject = { kind: "GOVERNMENT_BOND" as const, ref: { type: "FIXED_INCOME" as const, id: "b1" }, label: "GoG 22.00% Jul-34", sublabel: "GOG34", code: "GOG34", href: "/fixed-income/GOG34" };
  const summary = (r = research0): ThesisSummary => ({ id: "t1", title: "Disinflation supports duration", belief: "Belief.", status: "ACTIVE", confidence: "MEDIUM", horizon: "MEDIUM", subject, subjectKind: "GOVERNMENT_BOND", subjectLabel: subject.label, subjectCode: "GOG34", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", statusChangedAt: "2026-09-01T00:00:00.000Z", research: r });
  it("a library card shows counts, what is new, the review reason and the next catalyst — in one quiet line", () => {
    const t = text(html(createElement(ThesisCard, { t: summary() })));
    expect(t).toContain("Review suggested");
    expect(t).toContain("High-relevance challenging evidence was added 2 days ago. +1 more");
    expect(t).toContain("3 supporting · 2 challenging");
    expect(t).toContain("2 new evidence items since last review");
    expect(t).toContain("Next catalyst: Next MPC decision · November 2026 (upcoming)");
  });
  it("a thesis with no research adds no clutter", () => {
    const t = text(html(createElement(ThesisCard, { t: summary({ ...research0, counts: { supports: 0, challenges: 0, context: 0, total: 0, high: 0 }, newSinceReview: 0, reviewSuggested: false, reasons: [], nextCatalyst: null }) })));
    expect(t).not.toMatch(/Review suggested|supporting|Next catalyst/);
  });
  it("a security page panel shows compact research state and a link — not an evidence feed", () => {
    const lead = { id: "t1", title: "Disinflation supports duration", status: "ACTIVE" as const, confidence: "MEDIUM" as const, horizon: "MEDIUM" as const, belief: "Belief.", research: research0 };
    const m = html(createElement(ThesisPanel, { presence: { live: 1, total: 1, lead, reviewSuggested: true }, createHref: "/theses/new" }));
    expect(text(m)).toContain("3 supporting · 2 challenging");
    expect(text(m)).toContain("Review suggested");
    expect(m).toContain("View thesis");
    expect(text(m)).not.toContain("September inflation");
    expect(text(html(createElement(ThesisChip, { presence: { live: 1, total: 1, lead, reviewSuggested: true } })))).toContain("Review suggested");
  });
});

describe("evidence form", () => {
  const noop = async () => ({});
  const targets = { conditions: [{ id: "c1", kind: "MUST_BE_TRUE" as const, text: "Inflation keeps moderating" }, { id: "c2", kind: "INVALIDATION" as const, text: "Inflation reaccelerates" }], catalysts: [{ id: "k1", description: "MPC decision" }] };
  it("manual form: every control has a label, stance and relevance are small choices, and the target is optional", () => {
    const m = html(createElement(EvidenceForm, { mode: "manual", action: noop, targets, cancelHref: "/theses/t1" }));
    for (const id of ["sourceType", "title", "detail", "observedAt", "note", "target"]) expect(m).toMatch(new RegExp(`<label[^>]*for="${id}"`));
    expect(m).toContain('name="stance" value="SUPPORTS"');
    expect(m).toContain('name="stance" value="CHALLENGES"');
    expect(m).toContain('name="stance" value="CONTEXT"');
    expect(m).toContain('name="relevance" value="HIGH"');
    expect(m).toContain("The thesis as a whole");
    expect(m).toContain("What must be true");
    expect(m).toContain("What could prove us wrong");
    expect(m).toContain("Catalysts");
    expect(m).toContain("not a probability or a measure of statistical strength");
    expect(m).not.toMatch(/value="KORBLY_DATA"/);
    expect(m).not.toMatch(/strength\s*=|\d\s?%/);
  });
  it("shows no source fields for an analyst observation until an outside source is chosen", () => {
    const m = html(createElement(EvidenceForm, { mode: "manual", action: noop, targets, cancelHref: "/x", initial: { sourceType: "ANALYST_OBSERVATION" } }));
    expect(m).not.toContain('name="sourceName"');
    const o = html(createElement(EvidenceForm, { mode: "manual", action: noop, targets, cancelHref: "/x", initial: { sourceType: "EXTERNAL_SOURCE" } }));
    expect(o).toContain('name="sourceName"');
    expect(o).toContain("does not open it, read it or verify it");
  });
  it("link and edit-linked modes ask only for interpretation — no way to type the observation", () => {
    const m = html(createElement(EvidenceForm, { mode: "link", action: noop, targets, link: { refKind: "MACRO_OBSERVATION", refId: "o1" }, cancelHref: "/x" }));
    expect(m).toContain('name="refId" value="o1"');
    for (const name of ["title", "sourceName", "sourceUrl", "observedAt", "sourceType", "detail"]) expect(m).not.toContain(`name="${name}"`);
    expect(m).toContain('name="note"');
    const e = html(createElement(EvidenceForm, { mode: "edit-linked", action: noop, targets, cancelHref: "/x" }));
    for (const name of ["title", "sourceName", "observedAt"]) expect(e).not.toContain(`name="${name}"`);
  });
});
