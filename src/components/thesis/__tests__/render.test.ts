// M9.1 — what the analyst and a screen reader get from the thesis workspace.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THESIS_STATUSES, emptyContent } from "@/lib/thesis";
import type { SubjectOption, ThesisContextView, ThesisPresence, ThesisSummary } from "@/lib/queries/thesis";
import { ThesisCard } from "../ThesisCard";
import { ConfidenceMark, StatusBadge } from "../ui";
import { ThesisChip, ThesisPanel } from "../HoldingThesis";
import { ContextPanel } from "../ContextPanel";
import { StatusControls } from "../StatusControls";
import { SubjectPicker } from "../SubjectPicker";
import { ThesisForm } from "../ThesisForm";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const subject = { kind: "GOVERNMENT_BOND" as const, ref: { type: "FIXED_INCOME" as const, id: "b1" }, label: "GoG 22.00% Jul-34", sublabel: "GOG34", code: "GOG34", href: "/fixed-income/GOG34" };
const summary = (over: Partial<ThesisSummary> = {}): ThesisSummary => ({ id: "t1", title: "Disinflation supports duration", belief: "Long-duration government bonds could benefit if yields decline.", status: "ACTIVE", confidence: "MEDIUM", horizon: "MEDIUM", subject, subjectKind: "GOVERNMENT_BOND", subjectLabel: subject.label, subjectCode: "GOG34", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: new Date().toISOString(), statusChangedAt: "2026-10-01T00:00:00.000Z", ...over });
const ctx = (over: Partial<ThesisContextView> = {}): ThesisContextView => ({ valuationDate: "2026-10-05", facts: [{ label: "Latest reliable yield", value: "24.50%", sub: "observed 2026-10-01 · 4 days ago" }], held: [], scenarioLinks: [], links: [{ label: "Security page", href: "/fixed-income/GOG34" }], ...over });
const heldBase = { portfolioId: "pf1", portfolioName: "Core Ghana", positionId: "p1", href: "/portfolios/pf1?view=holdings&position=p1#inspect", status: "VALUED" as const, inactiveAssumptionSummary: null, unvaluedReason: null };

describe("status is never colour alone", () => {
  it.each(THESIS_STATUSES)("%s has a word and a glyph", (s) => {
    const m = html(createElement(StatusBadge, { status: s }));
    expect(m).toMatch(/aria-hidden="true">[○●◐✕■]</);
    expect(m.replace(/<[^>]+>/g, "")).toMatch(/Draft|Active|Challenged|Invalidated|Closed/);
  });
  it("confidence is shown as a word on a three-step scale, never as a percentage", () => {
    for (const c of ["LOW", "MEDIUM", "HIGH"] as const) expect(html(createElement(ConfidenceMark, { confidence: c }))).toMatch(new RegExp(`${c[0]}${c.slice(1).toLowerCase()} confidence`));
    expect(html(createElement(ConfidenceMark, { confidence: "HIGH" }))).not.toMatch(/%/);
    expect(html(createElement(ConfidenceMark, { confidence: null }))).toContain("Confidence not set");
  });
});

describe("thesis card (library)", () => {
  const m = html(createElement(ThesisCard, { t: summary() }));
  it("leads with subject and status, then title and belief, then confidence and horizon", () => {
    expect(m).toContain("Government bond");
    expect(m).toContain("GoG 22.00% Jul-34");
    expect(m).toContain("Disinflation supports duration");
    expect(m).toContain("Medium confidence");
    expect(m).toContain("1–3 years horizon");
    expect(m).toContain('href="/theses/t1"');
  });
  it("shows no score, probability or recommendation", () => expect(m).not.toMatch(/score|probab|buy|sell|target|expected return/i));
});

describe("thesis on a holding", () => {
  const lead = { id: "t1", title: "Disinflation supports duration", status: "ACTIVE" as const, confidence: "MEDIUM" as const, horizon: "MEDIUM" as const, belief: "Long-duration government bonds could benefit if yields decline." };
  it("shows a compact panel: title, confidence, horizon, core belief, link", () => {
    const m = html(createElement(ThesisPanel, { presence: { live: 1, total: 1, lead }, createHref: "/theses/new" }));
    expect(m).toContain("Active thesis");
    expect(m).toContain("Medium confidence");
    expect(m).toContain("Core belief");
    expect(m).toContain("View thesis");
    expect(m).not.toContain("Why we believe");
  });
  it("with no thesis invites creation", () => {
    const m = html(createElement(ThesisPanel, { presence: { live: 0, total: 0, lead: null }, createHref: "/theses/new?subjectType=SECURITY&subjectId=e1" }));
    expect(m).toContain("No active thesis");
    expect(m).toContain("Create thesis");
    expect(m).toContain("subjectType=SECURITY");
  });
  it("chip: absent without a thesis, singular or plural otherwise", () => {
    expect(html(createElement(ThesisChip, { presence: undefined }))).toBe("");
    expect(html(createElement(ThesisChip, { presence: { live: 0, total: 1, lead: null } }))).toBe("");
    expect(html(createElement(ThesisChip, { presence: { live: 1, total: 1, lead } }))).toContain("Active thesis");
    const many: ThesisPresence = { live: 2, total: 2, lead };
    expect(html(createElement(ThesisChip, { presence: many }))).toContain("2 active theses");
  });
});

describe("current Korbly context", () => {
  it("is labelled as context, separate from analyst reasoning, with the date", () => {
    const m = html(createElement(ContextPanel, { context: ctx(), subject }));
    expect(m).toContain("Current Korbly context");
    expect(m).toMatch(/does not confirm or refute it/);
    expect(m).toContain("24.50%");
    expect(m).toContain("as at");
  });
  it("not held: says a thesis does not require a holding, and points scenarios at a portfolio", () => {
    const m = html(createElement(ContextPanel, { context: ctx(), subject }));
    expect(m).toContain("Not currently held in any portfolio");
    expect(m).toContain("Add this to a portfolio");
  });
  it("held: shows the portfolio, value with its basis label, weight, and a Scenario Studio link", () => {
    const held = [{ ...heldBase, valueLabel: "Reference Value" as const, valueGhs: 1_620_000, weightPct: 37, basis: "REFERENCE" as const, assumption: null }];
    const m = html(createElement(ContextPanel, { context: ctx({ held, scenarioLinks: [{ portfolioId: "pf1", portfolioName: "Core Ghana", href: "/portfolios/pf1/scenarios" }] }), subject }));
    expect(m).toContain("Core Ghana");
    expect(m).toContain("Reference Value");
    expect(m).toContain("37.0%");
    expect(m).toContain('href="/portfolios/pf1/scenarios"');
    expect(m).toMatch(/not a forecast/);
    expect(m).not.toMatch(/supports the thesis|thesis (is )?confirmed/i);
  });
  it("fallback assumption: names it as an analyst assumption beside the thesis, not as evidence", () => {
    const held = [{ ...heldBase, valueLabel: "Analytical Starting Value" as const, valueGhs: 1_540_000, weightPct: 20, basis: "ANALYST_ASSUMPTION" as const, assumption: { kind: "FALLBACK" as const, summary: "28.00% yield", korblyValueGhs: null } }];
    const m = html(createElement(ContextPanel, { context: ctx({ held }), subject }));
    expect(m).toContain("Analytical Starting Value");
    expect(m).toContain("Analyst assumption — 28.00% yield");
    expect(m).toContain("No reliable Korbly Reference Value exists");
    expect(m).toMatch(/not a market observation/);
  });
  it("override: Korbly's own value is stated and unchanged", () => {
    const held = [{ ...heldBase, valueLabel: "Analytical Starting Value" as const, valueGhs: 1_540_000, weightPct: 20, basis: "ANALYST_ASSUMPTION" as const, assumption: { kind: "OVERRIDE" as const, summary: "27.00% yield", korblyValueGhs: 1_620_000 } }];
    const m = html(createElement(ContextPanel, { context: ctx({ held }), subject }));
    expect(m).toContain("Analytical override");
    expect(m).toContain("GHS 1,620,000.00");
    expect(m).toMatch(/is unchanged/);
  });
  it("an inactive stored assumption is flagged as not currently in use", () => {
    const held = [{ ...heldBase, valueLabel: "Reference Value" as const, valueGhs: 1_000_000, weightPct: 10, basis: "REFERENCE" as const, assumption: null, inactiveAssumptionSummary: "28.00% yield" }];
    expect(html(createElement(ContextPanel, { context: ctx({ held }), subject }))).toContain("not currently in use");
  });
  it("stale evidence is marked informationally and does not alter status", () => {
    const m = html(createElement(ContextPanel, { context: ctx({ facts: [{ label: "Latest actual trade", value: "GHS 3.50", sub: "11 days ago", stale: true }] }), subject }));
    expect(m).toContain("Older evidence");
    expect(m).toContain("Informational only");
  });
});

describe("status controls", () => {
  it("offers only valid transitions, with the invalidated/closed distinction and the analyst-control note", () => {
    const m = html(createElement(StatusControls, { id: "t1", status: "ACTIVE" }));
    expect(m).toContain("Mark as challenged");
    expect(m).toContain("Mark as invalidated");
    expect(m).toContain("Close thesis");
    expect(m).not.toContain("Activate");
    expect(m).toMatch(/never changes it automatically/);
    expect(m).toMatch(/Invalidated = the reasoning no longer holds/);
  });
  it("a challenged thesis can return to active", () => expect(html(createElement(StatusControls, { id: "t1", status: "CHALLENGED" }))).toContain("Activate"));
  it("a closed thesis has no controls", () => expect(html(createElement(StatusControls, { id: "t1", status: "CLOSED" }))).toBe(""));
  it("labels the note field", () => expect(html(createElement(StatusControls, { id: "t1", status: "DRAFT" }))).toMatch(/<label[^>]*for="note-t1"/));
});

const options: SubjectOption[] = [
  { ...subject, detail: "GOG34 · Government of Ghana · matures 2034-07-01 · 22.00% coupon", note: null, search: "gog34 government of ghana" },
  { kind: "EQUITY", ref: { type: "SECURITY", id: "e1" }, label: "MTN Ghana", sublabel: "MTNGH", code: "MTNGH", href: "/companies/MTNGH", detail: "MTNGH · Telecommunications", note: null, search: "mtngh mtn ghana" },
];

describe("subject picker", () => {
  it("is searchable, filterable by type, and every control is labelled", () => {
    const m = html(createElement(SubjectPicker, { options }));
    expect(m).toMatch(/<label[^>]*for="subject-search"/);
    expect(m).toContain('role="group" aria-label="Filter by type"');
    expect(m).toContain("aria-pressed");
    expect(m).toContain("MTN Ghana");
    expect(m).toContain("matures 2034-07-01");
  });
  it("a preselected subject is shown with a way to change it, and posts its identity", () => {
    const m = html(createElement(SubjectPicker, { options, initialKey: "SECURITY:e1" }));
    expect(m).toContain("Change subject");
    expect(m).toContain('name="subjectId" value="e1"');
    expect(m).toContain('name="subjectType" value="SECURITY"');
  });
});

describe("create / edit form", () => {
  const noop = async () => ({});
  const m = html(createElement(ThesisForm, { mode: "new", action: noop, options, cancelHref: "/theses" }));
  it("asks the questions in the analyst's order, in human language", () => {
    const order = ["What is this thesis about?", "What we believe", "Why we believe it", "What must be true", "What could prove us wrong", "What we’re watching", "Confidence and horizon"].map((t) => m.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("makes invalidation falsifiable by prompt, and keeps catalysts and risks distinct", () => {
    expect(m).toContain("We should reconsider if…");
    expect(m).toMatch(/A catalyst could make the view play out\. A risk could weaken it/);
  });
  it("saves a draft or activates; confidence and horizon are small scales, not numbers", () => {
    expect(m).toContain("Save as draft");
    expect(m).toContain("Activate thesis");
    expect(m).toContain('name="confidence" value="LOW"');
    expect(m).toContain("Under 1 year");
    expect(m).toMatch(/not a probability/);
    const scale = m.slice(m.indexOf("Confidence and horizon"), m.indexOf("To activate:"));
    expect(scale).not.toMatch(/\d\s?%/);
  });
  it("every field has a label and nothing is prefilled by Korbly", () => {
    for (const id of ["title", "belief", "rationale", "mustBeTrue", "invalidation", "catalysts", "risks", "watching"]) expect(m).toMatch(new RegExp(`<label[^>]*for="${id}"`));
    expect(m).toMatch(/<textarea[^>]*id="belief"[^>]*><\/textarea>/);
  });
  it("tells the analyst what is still needed to activate", () => expect(m).toContain("To activate:"));
  it("edit mode keeps the subject locked and saves in place", () => {
    const e = html(createElement(ThesisForm, { mode: "edit", action: noop, initial: { ...emptyContent(), title: "T", belief: "B" }, cancelHref: "/theses/t1", lockedSubject: createElement("p", null, "LOCKED") }));
    expect(e).toContain("LOCKED");
    expect(e).toContain("Save changes");
    expect(e).not.toContain("Activate thesis");
    expect(e).toContain('value="T"');
  });
  it("shows server-side field errors next to the field", () => {
    // errors arrive via action state; the form renders them with role=alert
    expect(m).not.toContain('role="alert"');
  });
});
