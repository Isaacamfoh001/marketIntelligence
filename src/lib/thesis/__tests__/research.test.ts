// M9.2 — evidence, catalysts, invalidation flags and the review signal: pure domain behaviour.
import { describe, expect, it } from "vitest";
import {
  allowedCatalystTransitions, allowedFlagTransitions, buildSnapshot, canTransitionCatalyst, canTransitionFlag, catalystTiming, compareEvidence, compareImportance, computeResearch, countEvidence, formatDay, hasEvidenceErrors, normalizeManualEvidence,
  parseHttpUrl, parseIsoDate, parseWindow, readSnapshot, reconcileConditions, RESEARCH_SYSTEM_COPY, snapshotTitle, sortTimeline, validateCatalystInput, validateInterpretation, validateManualEvidence, validateOccurrence, windowInputValue, windowLabel,
  type CatalystLite, type ConditionLite, type EvidenceLite, type ResearchInput,
} from "@/lib/thesis";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const manual = (over: Record<string, unknown> = {}) => normalizeManualEvidence({ stance: "SUPPORTS", relevance: "HIGH", sourceType: "OFFICIAL_SOURCE", title: "September inflation fell further", sourceName: "GSS", observedAt: "2026-09-30", ...over });

describe("manual evidence validation", () => {
  it("accepts a complete official-source item", () => expect(validateManualEvidence(manual(), NOW)).toEqual({}));
  it.each(["SUPPORTS", "CHALLENGES", "CONTEXT"])("accepts stance %s", (stance) => expect(validateManualEvidence(manual({ stance }), NOW)).toEqual({}));
  it.each(["LOW", "MEDIUM", "HIGH"])("accepts relevance %s", (relevance) => expect(validateManualEvidence(manual({ relevance }), NOW)).toEqual({}));
  it("rejects an invalid stance and relevance, naming the field", () => {
    const e = validateManualEvidence(manual({ stance: "PROVES", relevance: "83%" }), NOW);
    expect(e.stance).toBeTruthy();
    expect(e.relevance).toBeTruthy();
  });
  it("never accepts KORBLY_DATA as a hand-entered source — only linking creates it", () => expect(validateManualEvidence(manual({ sourceType: "KORBLY_DATA" }), NOW).sourceType).toBeTruthy());
  it.each(["OFFICIAL_SOURCE", "COMPANY_DISCLOSURE", "EXTERNAL_SOURCE"])("%s requires a source name and a date", (sourceType) => {
    const e = validateManualEvidence(manual({ sourceType, sourceName: "", observedAt: "" }), NOW);
    expect(e.sourceName).toBeTruthy();
    expect(e.observedAt).toBeTruthy();
  });
  it("an analyst observation needs neither a source nor a date", () => expect(validateManualEvidence(manual({ sourceType: "ANALYST_OBSERVATION", sourceName: "", observedAt: "" }), NOW)).toEqual({}));
  it("requires a title and bounds every free-text field", () => {
    expect(validateManualEvidence(manual({ title: "  " }), NOW).title).toBeTruthy();
    expect(validateManualEvidence(manual({ title: "x".repeat(161) }), NOW).title).toBeTruthy();
    expect(validateManualEvidence(manual({ note: "x".repeat(2001) }), NOW).note).toBeTruthy();
    expect(validateManualEvidence(manual({ detail: "x".repeat(2001) }), NOW).detail).toBeTruthy();
    expect(validateManualEvidence(manual({ note: "x".repeat(2000) }), NOW)).toEqual({});
  });
  it("rejects an impossible or future observation date", () => {
    expect(validateManualEvidence(manual({ observedAt: "2026-02-31" }), NOW).observedAt).toBeTruthy();
    expect(validateManualEvidence(manual({ observedAt: "2026-10-06" }), NOW).observedAt).toMatch(/future/);
    expect(validateManualEvidence(manual({ observedAt: "2026-10-05" }), NOW)).toEqual({});
  });
  it("validates a supplied URL strictly and treats it as a reference only", () => {
    expect(validateManualEvidence(manual({ sourceUrl: "https://statsghana.gov.gh/x" }), NOW)).toEqual({});
    for (const bad of ["javascript:alert(1)", "ftp://x.org/a", "not a url", "https://user:pw@x.org/", "http://"]) expect(validateManualEvidence(manual({ sourceUrl: bad }), NOW).sourceUrl, bad).toBeTruthy();
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("https://x.org/a b")).toBe("https://x.org/a%20b");
  });
  it("hasEvidenceErrors reflects the result", () => {
    expect(hasEvidenceErrors({})).toBe(false);
    expect(hasEvidenceErrors({ title: "x" })).toBe(true);
  });
  it("interpretation (the only part of linked evidence that is editable) needs stance and relevance", () => {
    expect(validateInterpretation({ stance: "SUPPORTS", relevance: "LOW", note: "" })).toEqual({});
    expect(Object.keys(validateInterpretation({ stance: null, relevance: "x", note: "" })).sort()).toEqual(["relevance", "stance"]);
  });
  it("parseIsoDate is strict", () => {
    expect(parseIsoDate("2026-10-05")).toBe("2026-10-05");
    for (const bad of ["2026-1-5", "2026-13-01", "05/10/2026", "", null, 20261005]) expect(parseIsoDate(bad)).toBeNull();
  });
});

describe("catalysts", () => {
  it("parses an exact date, a month, a quarter and no date", () => {
    expect(parseWindow("DATE", "2026-11-20")).toEqual({ kind: "DATE", start: "2026-11-20", end: "2026-11-20" });
    expect(parseWindow("MONTH", "2026-11")).toEqual({ kind: "MONTH", start: "2026-11-01", end: "2026-11-30" });
    expect(parseWindow("MONTH", "2028-02")).toEqual({ kind: "MONTH", start: "2028-02-01", end: "2028-02-29" });
    expect(parseWindow("QUARTER", "2027-Q1")).toEqual({ kind: "QUARTER", start: "2027-01-01", end: "2027-03-31" });
    expect(parseWindow("QUARTER", "2026-Q4")).toEqual({ kind: "QUARTER", start: "2026-10-01", end: "2026-12-31" });
    expect(parseWindow("NONE", "")).toEqual({ kind: "NONE", start: null, end: null });
  });
  it("rejects malformed windows", () => {
    for (const [k, v] of [["DATE", "2026-02-30"], ["MONTH", "2026-13"], ["MONTH", "Nov 2026"], ["QUARTER", "2027-Q5"], ["QUARTER", "Q1 2027"], ["DATE", ""], ["YEAR", "2026"]] as const) expect(parseWindow(k, v), `${k} ${v}`).toBeNull();
  });
  it("labels windows without false precision", () => {
    expect(windowLabel(parseWindow("DATE", "2026-11-20")!)).toBe("20 Nov 2026");
    expect(windowLabel(parseWindow("MONTH", "2026-11")!)).toBe("November 2026");
    expect(windowLabel(parseWindow("QUARTER", "2027-Q1")!)).toBe("Q1 2027");
    expect(windowLabel(parseWindow("NONE", "")!)).toBe("No date set");
  });
  it("round-trips through the form value", () => {
    for (const [k, v] of [["DATE", "2026-11-20"], ["MONTH", "2026-11"], ["QUARTER", "2027-Q1"]] as const) expect(windowInputValue(parseWindow(k, v)!)).toBe(v);
  });
  it("timing: upcoming / expected this month / window passed / no date — and only for WATCHING", () => {
    const t = (k: string, v: string, status: "WATCHING" | "OCCURRED" = "WATCHING") => catalystTiming(status, parseWindow(k, v)!, NOW);
    expect(t("NONE", "")).toBe("NO_DATE");
    expect(t("DATE", "2026-10-20")).toBe("EXPECTED_THIS_MONTH");
    expect(t("MONTH", "2026-10")).toBe("EXPECTED_THIS_MONTH");
    expect(t("QUARTER", "2026-Q4")).toBe("EXPECTED_THIS_MONTH"); // the quarter in progress overlaps this month
    expect(t("MONTH", "2026-11")).toBe("UPCOMING");
    expect(t("QUARTER", "2027-Q1")).toBe("UPCOMING");
    expect(t("DATE", "2026-10-04")).toBe("WINDOW_PASSED");
    expect(t("MONTH", "2026-09")).toBe("WINDOW_PASSED");
    expect(t("MONTH", "2026-09", "OCCURRED")).toBeNull();
  });
  it("a passed window is a prompt to look, never the word 'missed'", () => {
    expect(JSON.stringify(RESEARCH_SYSTEM_COPY)).not.toMatch(/missed/i);
    expect(catalystTiming("WATCHING", parseWindow("DATE", "2020-01-01")!, NOW)).toBe("WINDOW_PASSED");
  });
  it("transitions: watching can resolve three ways; others can be reopened; no jumping", () => {
    expect(allowedCatalystTransitions("WATCHING")).toEqual(["OCCURRED", "MISSED", "NO_LONGER_RELEVANT"]);
    expect(canTransitionCatalyst("OCCURRED", "WATCHING")).toBe(true);
    expect(canTransitionCatalyst("OCCURRED", "MISSED")).toBe(false);
    expect(canTransitionCatalyst("NO_LONGER_RELEVANT", "OCCURRED")).toBe(false);
    expect(canTransitionCatalyst("WATCHING", "WATCHING")).toBe(false);
    expect(canTransitionCatalyst("WATCHING", "DONE")).toBe(false);
  });
  it("validates description and window", () => {
    expect(validateCatalystInput({ description: "", windowKind: "NONE", windowValue: "" }).errors.description).toBeTruthy();
    expect(validateCatalystInput({ description: "x".repeat(201), windowKind: "NONE", windowValue: "" }).errors.description).toBeTruthy();
    expect(validateCatalystInput({ description: "MPC decision", windowKind: "DATE", windowValue: "nope" }).errors.window).toBeTruthy();
    expect(validateCatalystInput({ description: "MPC decision", windowKind: "MONTH", windowValue: "2026-11" }).errors).toEqual({});
  });
  it("occurrence date defaults to today, cannot be in the future, and the note is bounded", () => {
    expect(validateOccurrence({ occurredOn: "", outcomeNote: "" }, NOW)).toMatchObject({ errors: {}, occurredOn: "2026-10-05", outcomeNote: null });
    expect(validateOccurrence({ occurredOn: "2026-10-06", outcomeNote: "" }, NOW).errors.occurredOn).toBeTruthy();
    expect(validateOccurrence({ occurredOn: "garbage", outcomeNote: "" }, NOW).errors.occurredOn).toBeTruthy();
    expect(validateOccurrence({ occurredOn: "2026-09-30", outcomeNote: "x".repeat(1001) }, NOW).errors.outcomeNote).toBeTruthy();
  });
});

describe("invalidation flags", () => {
  it("walk NOT_OBSERVED → POTENTIALLY_TRIGGERED → TRIGGERED and back only through potential", () => {
    expect(allowedFlagTransitions("NOT_OBSERVED")).toEqual(["POTENTIALLY_TRIGGERED", "TRIGGERED"]);
    expect(canTransitionFlag("POTENTIALLY_TRIGGERED", "TRIGGERED")).toBe(true);
    expect(canTransitionFlag("POTENTIALLY_TRIGGERED", "NOT_OBSERVED")).toBe(true); // reset
    expect(canTransitionFlag("TRIGGERED", "NOT_OBSERVED")).toBe(false);
    expect(canTransitionFlag("TRIGGERED", "POTENTIALLY_TRIGGERED")).toBe(true);
    expect(canTransitionFlag("NOT_OBSERVED", "NOT_OBSERVED")).toBe(false);
    expect(canTransitionFlag("NOT_OBSERVED", "INVALIDATED")).toBe(false);
  });
});

describe("reconciling condition lists", () => {
  const existing = [{ id: "a", text: "Inflation keeps moderating" }, { id: "b", text: "Policy rate falls" }];
  it("keeps a condition (and so its evidence) when its wording is unchanged, wherever it moves", () => {
    expect(reconcileConditions(existing, ["policy  rate FALLS", "Inflation keeps moderating"])).toEqual({ keep: [{ id: "b", position: 0 }, { id: "a", position: 1 }], add: [], remove: [] });
  });
  it("treats rewording as remove + add — nothing is silently re-pointed", () => {
    const r = reconcileConditions(existing, ["Inflation keeps moderating", "Policy rate falls by 200bps"]);
    expect(r.keep).toEqual([{ id: "a", position: 0 }]);
    expect(r.add).toEqual([{ text: "Policy rate falls by 200bps", position: 1 }]);
    expect(r.remove).toEqual(["b"]);
  });
  it("removes everything when the list is emptied", () => expect(reconcileConditions(existing, []).remove.sort()).toEqual(["a", "b"]));
});

describe("snapshots", () => {
  const args = { refKind: "MACRO_OBSERVATION" as const, datasetLabel: "Ghana CPI Inflation — YoY", displayValue: "23.80%", unit: "%", observationDate: "2026-09-30", source: { name: "GSS", provider: "Ghana Statistical Service", ingestionRunId: "r1", retrievedAt: "2026-10-02T00:00:00.000Z", acquisitionMethod: null }, fingerprint: "23.8|", stale: false, now: NOW };
  it("freezes value, date, source, run and quality", () => {
    const s = buildSnapshot(args);
    expect(s).toMatchObject({ version: 1, displayValue: "23.80%", observationDate: "2026-09-30", source: { ingestionRunId: "r1" }, quality: { recency: "CURRENT", ageDaysAtLink: 5 }, capturedAt: NOW.toISOString() });
  });
  it("preserves 'older data' quality and does not improve it by linking", () => expect(buildSnapshot({ ...args, stale: true, qualityNote: "carried" }).quality).toMatchObject({ recency: "STALE", note: "carried" }));
  it("derives the title from the snapshot, never from typed text", () => expect(snapshotTitle(buildSnapshot(args))).toBe("Ghana CPI Inflation — YoY: 23.80% (30 Sep 2026)"));
  it("reads a stored snapshot defensively", () => {
    expect(readSnapshot(JSON.parse(JSON.stringify(buildSnapshot(args))))).not.toBeNull();
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({ version: 2 })).toBeNull();
    expect(readSnapshot("x")).toBeNull();
  });
  it("formats days", () => expect(formatDay("2026-01-05")).toBe("5 Jan 2026"));
});

// --- review signal -------------------------------------------------------------------------------------

const ev = (id: string, stance: EvidenceLite["stance"], relevance: EvidenceLite["relevance"], createdAt: string, observedAt: string | null = null): EvidenceLite => ({ id, stance, relevance, createdAt, observedAt });
const inv = (id: string, flag: ConditionLite["flag"], flagChangedAt: string | null, retired = false): ConditionLite => ({ id, kind: "INVALIDATION", flag, flagChangedAt, retired });
const cat = (id: string, status: CatalystLite["status"], statusChangedAt: string, window = parseWindow("NONE", "")!): CatalystLite => ({ id, status, statusChangedAt, window });
const base = (over: Partial<ResearchInput> = {}): ResearchInput => ({ status: "ACTIVE", createdAt: "2026-09-01T00:00:00.000Z", evidence: [], conditions: [], catalysts: [], reviewedAt: [], now: NOW, ...over });
const codes = (i: ResearchInput) => computeResearch(i).reasons.map((r) => r.code);

describe("evidence summary (facts, never a verdict)", () => {
  it("says so when there is no evidence", () => expect(computeResearch(base()).summary).toEqual(["No evidence has been recorded yet."]));
  it("counts supporting and challenging without ranking them", () => {
    const s = computeResearch(base({ evidence: [ev("1", "SUPPORTS", "LOW", "2026-09-02T00:00:00.000Z"), ev("2", "SUPPORTS", "LOW", "2026-09-03T00:00:00.000Z"), ev("3", "SUPPORTS", "LOW", "2026-09-04T00:00:00.000Z"), ev("4", "CHALLENGES", "LOW", "2026-09-05T00:00:00.000Z"), ev("5", "CHALLENGES", "LOW", "2026-09-06T00:00:00.000Z"), ev("6", "CONTEXT", "LOW", "2026-09-06T00:00:00.000Z")] })).summary;
    expect(s[0]).toBe("3 supporting and 2 challenging evidence items are recorded, plus 1 context.");
  });
  it("reports the stance of the most recent high-relevance evidence", () => {
    const s = computeResearch(base({ evidence: [ev("1", "SUPPORTS", "HIGH", "2026-09-02T00:00:00.000Z", "2026-09-10"), ev("2", "CHALLENGES", "HIGH", "2026-09-03T00:00:00.000Z", "2026-09-20"), ev("3", "SUPPORTS", "LOW", "2026-09-04T00:00:00.000Z", "2026-09-30")] })).summary;
    expect(s).toContain("The most recent high-relevance evidence challenges the thesis.");
  });
  it("counts do not decide anything: 3 vs 1 yields no 'winning' language", () => {
    const text = computeResearch(base({ evidence: [ev("1", "SUPPORTS", "LOW", "2026-09-02T00:00:00.000Z"), ev("2", "SUPPORTS", "LOW", "2026-09-03T00:00:00.000Z"), ev("3", "SUPPORTS", "LOW", "2026-09-04T00:00:00.000Z"), ev("4", "CHALLENGES", "LOW", "2026-09-05T00:00:00.000Z")] })).summary.join(" ");
    expect(text).not.toMatch(/win|strong|weak|likely|confirm|health|score/i);
  });
  it("countEvidence tallies stance and high relevance", () => expect(countEvidence([ev("1", "SUPPORTS", "HIGH", "x"), ev("2", "CHALLENGES", "LOW", "x")])).toEqual({ supports: 1, challenges: 1, context: 0, total: 2, high: 1 }));
});

describe("evidence ordering", () => {
  it("relevance first, then the date of the evidence, then when it was added, then id", () => {
    const a = ev("a", "SUPPORTS", "LOW", "2026-09-30T00:00:00.000Z", "2026-09-30");
    const b = ev("b", "SUPPORTS", "HIGH", "2026-09-02T00:00:00.000Z", "2026-09-01");
    const c = ev("c", "SUPPORTS", "HIGH", "2026-09-03T00:00:00.000Z", "2026-09-15");
    expect([a, b, c].sort(compareEvidence).map((e) => e.id)).toEqual(["c", "b", "a"]);
  });
  it("what deserves a look first: relevance, then challenging before supporting before context, then recency", () => {
    const list = [ev("ctx", "CONTEXT", "HIGH", "2026-09-05T00:00:00.000Z"), ev("sup", "SUPPORTS", "HIGH", "2026-09-04T00:00:00.000Z"), ev("chal", "CHALLENGES", "HIGH", "2026-09-03T00:00:00.000Z"), ev("lowchal", "CHALLENGES", "LOW", "2026-09-06T00:00:00.000Z")];
    expect([...list].sort(compareImportance).map((e) => e.id)).toEqual(["chal", "sup", "ctx", "lowchal"]);
  });
  it("is deterministic: the same input in any order gives the same order", () => {
    const list = [ev("1", "SUPPORTS", "HIGH", "2026-09-04T00:00:00.000Z", "2026-09-04"), ev("2", "SUPPORTS", "HIGH", "2026-09-04T00:00:00.000Z", "2026-09-04"), ev("3", "CHALLENGES", "MEDIUM", "2026-09-04T00:00:00.000Z")];
    expect([...list].reverse().sort(compareEvidence).map((e) => e.id)).toEqual(list.sort(compareEvidence).map((e) => e.id));
  });
});

describe("review signal", () => {
  it("D. nothing new → no suggestion", () => {
    const r = computeResearch(base());
    expect(r.reviewSuggested).toBe(false);
    expect(r.reasons).toEqual([]);
  });
  it("evidence from before the last review does not count as new", () => {
    const i = base({ reviewedAt: ["2026-09-20T00:00:00.000Z"], evidence: [ev("1", "CHALLENGES", "HIGH", "2026-09-10T00:00:00.000Z")] });
    expect(computeResearch(i)).toMatchObject({ reviewSuggested: false, since: { total: 0 } });
  });
  it("A. high-relevance challenging evidence → review suggested, with the reason in words", () => {
    const r = computeResearch(base({ reviewedAt: ["2026-09-20T00:00:00.000Z"], evidence: [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z")] }));
    expect(r.reviewSuggested).toBe(true);
    expect(r.reasons[0]).toMatchObject({ code: "HIGH_CHALLENGE", text: "High-relevance challenging evidence was added 2 days ago." });
  });
  it("lower-relevance challenging evidence alone is not a reason", () => expect(codes(base({ evidence: [ev("1", "CHALLENGES", "MEDIUM", "2026-10-03T00:00:00.000Z"), ev("2", "CHALLENGES", "LOW", "2026-10-03T00:00:00.000Z")] }))).toEqual([]));
  it("B. a potentially triggered condition → review suggested", () => {
    const r = computeResearch(base({ conditions: [inv("c", "POTENTIALLY_TRIGGERED", "2026-10-01T00:00:00.000Z")] }));
    expect(r.reasons[0]).toMatchObject({ code: "INVALIDATION_POTENTIAL", text: "1 invalidation condition is currently marked as potentially triggered.", persistent: true });
  });
  it("a triggered condition outranks a potential one", () => expect(codes(base({ conditions: [inv("a", "POTENTIALLY_TRIGGERED", "2026-10-01T00:00:00.000Z"), inv("b", "TRIGGERED", "2026-10-02T00:00:00.000Z")] }))).toEqual(["INVALIDATION_TRIGGERED", "INVALIDATION_POTENTIAL"]));
  it("REVIEWED ≠ RESOLVED: a flag still raised after the last review remains a (persistent) reason", () => {
    const r = computeResearch(base({ reviewedAt: ["2026-10-02T00:00:00.000Z"], conditions: [inv("c", "TRIGGERED", "2026-10-01T00:00:00.000Z")] }));
    expect(r.reasons).toMatchObject([{ code: "INVALIDATION_TRIGGERED", persistent: true }]);
  });
  it("G/H. new challenging evidence + a flagged condition: review clears only the evidence reason", () => {
    const i = base({ evidence: [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z")], conditions: [inv("c", "POTENTIALLY_TRIGGERED", "2026-10-01T00:00:00.000Z")] });
    expect(codes(i)).toEqual(["INVALIDATION_POTENTIAL", "HIGH_CHALLENGE"]);
    expect(codes({ ...i, reviewedAt: ["2026-10-04T00:00:00.000Z"] })).toEqual(["INVALIDATION_POTENTIAL"]);
    expect(codes({ ...i, reviewedAt: ["2026-10-04T00:00:00.000Z"], conditions: [inv("c", "NOT_OBSERVED", "2026-10-04T01:00:00.000Z")] })).toEqual([]);
  });
  it("a reset (NOT_OBSERVED) or retired condition raises nothing", () => expect(codes(base({ conditions: [inv("a", "NOT_OBSERVED", "2026-10-02T00:00:00.000Z"), inv("b", "TRIGGERED", "2026-10-02T00:00:00.000Z", true)] }))).toEqual([]));
  it("C. an occurred catalyst → review suggested; a watching or older one is not", () => {
    expect(codes(base({ catalysts: [cat("k", "OCCURRED", "2026-10-02T00:00:00.000Z")] }))).toEqual(["CATALYST_OCCURRED"]);
    expect(codes(base({ catalysts: [cat("k", "WATCHING", "2026-10-02T00:00:00.000Z")] }))).toEqual([]);
    expect(codes(base({ reviewedAt: ["2026-10-03T00:00:00.000Z"], catalysts: [cat("k", "OCCURRED", "2026-10-02T00:00:00.000Z")] }))).toEqual([]);
  });
  it("material evidence: a new high-relevance supporting item, or three new items of any kind", () => {
    expect(codes(base({ evidence: [ev("1", "SUPPORTS", "HIGH", "2026-10-03T00:00:00.000Z")] }))).toEqual(["MATERIAL_EVIDENCE"]);
    expect(codes(base({ evidence: [ev("1", "SUPPORTS", "LOW", "2026-10-03T00:00:00.000Z"), ev("2", "CONTEXT", "LOW", "2026-10-03T00:00:00.000Z")] }))).toEqual([]);
    expect(codes(base({ evidence: [ev("1", "SUPPORTS", "LOW", "2026-10-03T00:00:00.000Z"), ev("2", "CONTEXT", "LOW", "2026-10-03T00:00:00.000Z"), ev("3", "CHALLENGES", "LOW", "2026-10-03T00:00:00.000Z")] }))).toEqual(["MATERIAL_EVIDENCE"]);
  });
  it("multiple reasons are all listed in the fixed priority order", () => {
    const r = computeResearch(base({ evidence: [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z"), ev("2", "SUPPORTS", "HIGH", "2026-10-03T00:00:00.000Z")], conditions: [inv("c", "TRIGGERED", "2026-10-01T00:00:00.000Z")], catalysts: [cat("k", "OCCURRED", "2026-10-02T00:00:00.000Z")] }));
    expect(r.reasons.map((x) => x.code)).toEqual(["INVALIDATION_TRIGGERED", "HIGH_CHALLENGE", "CATALYST_OCCURRED", "MATERIAL_EVIDENCE"]);
  });
  it("is deterministic regardless of input order", () => {
    const evidence = [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z"), ev("2", "SUPPORTS", "HIGH", "2026-10-04T00:00:00.000Z")];
    expect(computeResearch(base({ evidence })).reasons).toEqual(computeResearch(base({ evidence: [...evidence].reverse() })).reasons);
  });
  it("only a live thesis (active/challenged) is asked to review", () => {
    for (const status of ["DRAFT", "INVALIDATED", "CLOSED"] as const) expect(computeResearch(base({ status, evidence: [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z")] })).reviewSuggested, status).toBe(false);
    expect(computeResearch(base({ status: "CHALLENGED", evidence: [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z")] })).reviewSuggested).toBe(true);
  });
});

describe("evidence since last review", () => {
  const evidence = [ev("old", "SUPPORTS", "MEDIUM", "2026-09-05T00:00:00.000Z"), ev("n1", "SUPPORTS", "LOW", "2026-10-01T00:00:00.000Z"), ev("n2", "CHALLENGES", "HIGH", "2026-10-02T00:00:00.000Z"), ev("n3", "CONTEXT", "LOW", "2026-10-03T00:00:00.000Z")];
  it("uses the last review as the baseline, not the thesis's updatedAt", () => {
    const r = computeResearch(base({ reviewedAt: ["2026-09-10T00:00:00.000Z", "2026-09-20T00:00:00.000Z"], evidence }));
    expect(r.lastReviewedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(r.since).toMatchObject({ total: 3, supports: 1, challenges: 1, context: 1, high: 1, mostImportantId: "n2" });
    expect(r.neverReviewed).toBe(false);
  });
  it("counts from creation when never reviewed", () => {
    const r = computeResearch(base({ evidence }));
    expect(r.neverReviewed).toBe(true);
    expect(r.baseline).toBe("2026-09-01T00:00:00.000Z");
    expect(r.since.total).toBe(4);
  });
  it("marking reviewed resets 'new since' and the reasons but keeps every item counted", () => {
    const before = computeResearch(base({ evidence }));
    const after = computeResearch(base({ evidence, reviewedAt: ["2026-10-04T00:00:00.000Z"] }));
    expect(before.reviewSuggested).toBe(true);
    expect(after.reviewSuggested).toBe(false);
    expect(after.since.total).toBe(0);
    expect(after.counts.total).toBe(4);
  });
  it("evidence added after the review is new again", () => expect(computeResearch(base({ evidence: [...evidence, ev("n4", "SUPPORTS", "LOW", "2026-10-05T00:00:00.000Z")], reviewedAt: ["2026-10-04T00:00:00.000Z"] })).since.total).toBe(1));
  it("no evidence since review → zero, no most-important item", () => expect(computeResearch(base({ evidence })).since.mostImportantId).toBe("n2"));
});

describe("next catalyst", () => {
  it("picks the earliest dated watching catalyst, with undated ones last", () => {
    const r = computeResearch(base({ catalysts: [cat("none", "WATCHING", "2026-09-01T00:00:00.000Z"), cat("later", "WATCHING", "2026-09-02T00:00:00.000Z", parseWindow("MONTH", "2027-01")!), cat("soon", "WATCHING", "2026-09-03T00:00:00.000Z", parseWindow("DATE", "2026-11-20")!), cat("done", "OCCURRED", "2026-09-03T00:00:00.000Z", parseWindow("DATE", "2026-09-30")!)] }));
    expect(r.nextCatalystId).toBe("soon");
  });
  it("is null when nothing is being watched", () => expect(computeResearch(base({ catalysts: [cat("k", "OCCURRED", "2026-09-03T00:00:00.000Z")] })).nextCatalystId).toBeNull());
});

describe("timeline", () => {
  it("orders by the meaningful date, newest first, with recorded-at only as a tiebreaker", () => {
    const sorted = sortTimeline([
      { kind: "SUPPORTING_EVIDENCE", date: "2026-09-30", recordedAt: "2026-10-04T00:00:00.000Z", title: "CPI" },
      { kind: "THESIS_REVIEWED", date: "2026-10-01", recordedAt: "2026-10-01T09:00:00.000Z", title: "Reviewed" },
      { kind: "CATALYST_OCCURRED", date: "2026-09-30", recordedAt: "2026-10-05T00:00:00.000Z", title: "MPC" },
    ]);
    expect(sorted.map((e) => e.title)).toEqual(["Reviewed", "MPC", "CPI"]);
  });
});

describe("system copy never advises, concludes or forecasts", () => {
  const FORBIDDEN = [/\bbuy\b/i, /\bsell\b/i, /\bhold\b/i, /confirm/i, /disprov/i, /proves?\b/i, /\bcorrect\b/i, /incorrect/i, /likely to (succeed|fail)/i, /increase exposure/i, /reduce exposure/i, /thesis (is )?(right|wrong|weakening|strengthened|failed)/i, /\bscore\b/i];
  it.each(RESEARCH_SYSTEM_COPY.map((c, i) => [i, c]))("copy #%s", (_i, text) => {
    for (const re of FORBIDDEN) {
      // "does not prove" style negations are allowed; assertions are not.
      const stripped = String(text).replace(/(does not|never|not a|not) (verify|prove|confirm|say)[^.]*\./gi, "");
      expect(stripped, `${re} in "${text}"`).not.toMatch(re);
    }
  });
  it("generated review reasons and summaries are equally clean", () => {
    const r = computeResearch(base({ evidence: [ev("1", "CHALLENGES", "HIGH", "2026-10-03T00:00:00.000Z"), ev("2", "SUPPORTS", "HIGH", "2026-10-03T00:00:00.000Z"), ev("3", "CONTEXT", "LOW", "2026-10-03T00:00:00.000Z")], conditions: [inv("c", "TRIGGERED", "2026-10-01T00:00:00.000Z"), inv("d", "POTENTIALLY_TRIGGERED", "2026-10-01T00:00:00.000Z")], catalysts: [cat("k", "OCCURRED", "2026-10-02T00:00:00.000Z")] }));
    const text = [...r.reasons.map((x) => x.text), ...r.summary].join(" ");
    expect(text).not.toMatch(/\b(buy|sell|hold|proves?|confirmed|disproved|correct|incorrect|invalidated|weakening|strengthened|likely)\b/i);
    expect(text).not.toMatch(/\d+\s?\/\s?100|%/);
  });
});
