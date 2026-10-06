// M9.1 — thesis domain: statuses, validation, filtering, context presentation and generated-copy safety.
import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition, filterTheses, isEditable, isLive, normalizeContent, normalizeList, parseLines, activationGaps, validateActivation, validateDraft, hasErrors, emptyContent, LIMITS, STATUS_LABEL, STATUS_MEANING, TRANSITION_ACTION, THESIS_STATUSES, CONFIDENCE_LABEL, HORIZON_LABEL, SUBJECT_KIND_LABEL, type ThesisContent, type ThesisStatus } from "..";
import * as copy from "../copy";
import { billContext, bondContext, equityContext, heldRows } from "../context";
import { valueBondPosition, valueBondWithAssumption, valueEquityPosition, valueEquityWithAssumption } from "@/lib/portfolio";
import type { BondInstrument, EquityInstrument, PortfolioDetail, PositionRow } from "@/lib/queries/portfolio";

const complete = (over: Partial<ThesisContent> = {}): ThesisContent => ({ ...emptyContent(), title: "Disinflation supports duration", belief: "Yields could fall.", rationale: "Analyst reasoning.", mustBeTrue: ["Inflation keeps moderating"], invalidation: ["Inflation re-accelerates"], confidence: "MEDIUM", horizon: "MEDIUM", ...over });

describe("status workflow", () => {
  const ok: [ThesisStatus, ThesisStatus][] = [["DRAFT", "ACTIVE"], ["DRAFT", "CLOSED"], ["ACTIVE", "CHALLENGED"], ["ACTIVE", "INVALIDATED"], ["ACTIVE", "CLOSED"], ["CHALLENGED", "ACTIVE"], ["CHALLENGED", "INVALIDATED"], ["CHALLENGED", "CLOSED"], ["INVALIDATED", "CLOSED"]];
  it.each(ok)("%s → %s is allowed", (a, b) => expect(canTransition(a, b)).toBe(true));
  it("everything else is refused", () => {
    const allowed = new Set(ok.map(([a, b]) => `${a}>${b}`));
    for (const a of THESIS_STATUSES) for (const b of THESIS_STATUSES) if (!allowed.has(`${a}>${b}`)) expect(canTransition(a, b)).toBe(false);
  });
  it("rejects nonsense status values, including BUY/SELL/HOLD", () => {
    for (const bad of ["BUY", "SELL", "HOLD", "", null, undefined, 3, "active"]) expect(canTransition("ACTIVE", bad)).toBe(false);
  });
  it("closed is terminal; invalidated can only be retired", () => {
    expect(allowedTransitions("CLOSED")).toEqual([]);
    expect(allowedTransitions("INVALIDATED")).toEqual(["CLOSED"]);
  });
  it("closed and invalidated are distinct states with distinct meanings", () => {
    expect(STATUS_LABEL.CLOSED).not.toBe(STATUS_LABEL.INVALIDATED);
    expect(STATUS_MEANING.CLOSED).toMatch(/not necessarily because it was wrong/);
    expect(STATUS_MEANING.INVALIDATED).toMatch(/no longer holds/);
  });
  it("only draft/active/challenged are editable; active and challenged are live", () => {
    expect(THESIS_STATUSES.filter(isEditable)).toEqual(["DRAFT", "ACTIVE", "CHALLENGED"]);
    expect(THESIS_STATUSES.filter(isLive)).toEqual(["ACTIVE", "CHALLENGED"]);
  });
});

describe("content normalisation", () => {
  it("trims, drops blanks and case-insensitive duplicates, keeps order", () => {
    expect(normalizeList([" a ", "", "A", "b  c", "b c"])).toEqual(["a", "b c"]);
  });
  it("parses one-per-line text and strips bullets and numbering", () => {
    expect(parseLines("- one\n• two\n3. three\n\n  four  ")).toEqual(["one", "two", "three", "four"]);
  });
  it("invalid confidence or horizon values become unset, never guessed", () => {
    const c = normalizeContent({ title: "t", belief: "b", confidence: "CERTAIN", horizon: "FOREVER" });
    expect(c.confidence).toBeNull();
    expect(c.horizon).toBeNull();
  });
  it("confidence is a three-step analyst scale — no numeric probability exists", () => {
    expect(Object.keys(CONFIDENCE_LABEL)).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(normalizeContent({ confidence: "73" }).confidence).toBeNull();
  });
  it("horizons are defined ranges", () => expect(HORIZON_LABEL).toEqual({ SHORT: "Under 1 year", MEDIUM: "1–3 years", LONG: "3+ years" }));
});

describe("validation", () => {
  it("a draft needs only a title and a belief", () => {
    expect(hasErrors(validateDraft(normalizeContent({ title: "T", belief: "B" })))).toBe(false);
    expect(Object.keys(validateDraft(normalizeContent({})))).toEqual(["title", "belief"]);
  });
  it("activation additionally needs reasoning, must-be-true, invalidation, confidence and horizon", () => {
    const e = validateActivation(normalizeContent({ title: "T", belief: "B" }));
    expect(Object.keys(e).sort()).toEqual(["confidence", "horizon", "invalidation", "mustBeTrue", "rationale"]);
    expect(hasErrors(validateActivation(complete()))).toBe(false);
  });
  it("risks and watch items stay optional", () => expect(hasErrors(validateActivation(complete({ risks: [], watching: [] })))).toBe(false));
  it("a thesis with no way to be wrong cannot be activated", () => expect(validateActivation(complete({ invalidation: [] })).invalidation).toMatch(/proves? ?wrong|reconsider|thesis/i));
  it("enforces length and count limits", () => {
    expect(validateDraft(complete({ title: "x".repeat(LIMITS.title + 1) })).title).toBeTruthy();
    expect(validateDraft(complete({ belief: "x".repeat(LIMITS.belief + 1) })).belief).toBeTruthy();
    expect(validateDraft(complete({ mustBeTrue: Array.from({ length: LIMITS.items + 1 }, (_, i) => `c${i}`) })).mustBeTrue).toBeTruthy();
    expect(validateDraft(complete({ risks: ["x".repeat(LIMITS.item + 1)] })).risks).toBeTruthy();
  });
  it("lists what is missing so the analyst knows how to finish", () => {
    expect(activationGaps(complete())).toEqual([]);
    expect(activationGaps(complete({ invalidation: [], horizon: null })).length).toBe(2);
  });
});

describe("library filtering and search", () => {
  const t = (title: string, status: ThesisStatus, kind: "EQUITY" | "GOVERNMENT_BOND" | "CORPORATE_BOND" | "TREASURY_BILL", label: string, code: string, confidence: "LOW" | "MEDIUM" | "HIGH" | null, updatedAt: string) => ({ title, status, subjectKind: kind, subjectLabel: label, subjectCode: code, confidence, updatedAt });
  const all = [
    t("Mobile money resilience", "ACTIVE", "EQUITY", "MTN Ghana", "MTNGH", "HIGH", "2026-10-03"),
    t("Disinflation supports duration", "DRAFT", "GOVERNMENT_BOND", "GoG 22.00% Jul-34", "GOG34", "MEDIUM", "2026-10-05"),
    t("Credit spreads", "CHALLENGED", "CORPORATE_BOND", "Kasapreko Sep-28", "KASA28", "LOW", "2026-10-01"),
    t("Short bills carry", "CLOSED", "TREASURY_BILL", "91-day Treasury bills", "91_DAY_BILL", null, "2026-09-01"),
  ];
  it("sorts by most recently updated", () => expect(filterTheses(all, {}).map((x) => x.subjectCode)).toEqual(["GOG34", "MTNGH", "KASA28", "91_DAY_BILL"]));
  it("filters by status, including the 'live' group", () => {
    expect(filterTheses(all, { status: "DRAFT" })).toHaveLength(1);
    expect(filterTheses(all, { status: "LIVE" }).map((x) => x.status).sort()).toEqual(["ACTIVE", "CHALLENGED"]);
  });
  it("filters by asset class, confidence and exact subject", () => {
    expect(filterTheses(all, { subjectKind: "EQUITY" })).toHaveLength(1);
    expect(filterTheses(all, { confidence: "LOW" })[0].subjectCode).toBe("KASA28");
    expect(filterTheses(all, { subjectCode: "GOG34" })).toHaveLength(1);
  });
  it("searches title, subject name and code, case-insensitively", () => {
    expect(filterTheses(all, { q: "mtn" })).toHaveLength(1);
    expect(filterTheses(all, { q: "DURATION" })).toHaveLength(1);
    expect(filterTheses(all, { q: "kasa28" })).toHaveLength(1);
    expect(filterTheses(all, { q: "zzz" })).toHaveLength(0);
  });
  it("combines filters", () => expect(filterTheses(all, { status: "LIVE", subjectKind: "EQUITY", q: "mobile" })).toHaveLength(1));
});

// --- Context ------------------------------------------------------------------------------------------

const VAL = new Date("2026-10-05T00:00:00.000Z");
const TERMS = { issueDate: new Date("2024-03-01T00:00:00Z"), maturityDate: new Date("2034-07-01T00:00:00Z"), couponType: "FIXED" as const, couponRatePct: 22, couponFrequency: "SEMI_ANNUAL" as const, faceValue: 100 };
const bondInst = (over: Partial<BondInstrument> = {}): BondInstrument => ({ kind: "BOND", id: "b1", instrumentCode: "GOG34", label: "GoG 22.00% Jul-34", issuerName: "Government of Ghana", companyId: null, instrumentType: "GOVERNMENT_BOND", currency: "GHS", status: "ACTIVE", maturityConflict: false, couponConflict: false, couponRatePct: 22, couponType: "FIXED", maturityDate: "2034-07-01", lifecycle: "ACTIVE", terms: TERMS, input: { available: true, assetClass: "BOND", observedYtmPct: 24.5, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: 90, yieldFromSourceQuote: false, pendingReview: null }, addable: { addable: true } as never, ...over });
const eqInst = (over: Partial<EquityInstrument> = {}): EquityInstrument => ({ kind: "EQUITY", id: "e1", ticker: "MTNGH", companyName: "MTN Ghana", companyId: "c1", input: { available: true, assetClass: "EQUITY", priceGhs: 3.5, priceDate: "2026-09-24", ageDays: 11, recency: "STALE", volume: 12000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-02", skippedNoTradeRows: 0 }, addable: { addable: true } as never, ...over });

describe("current Korbly context", () => {
  it("equity: shows the latest actual trade with its date and age, and flags older evidence", () => {
    const f = equityContext(eqInst());
    const trade = f.find((x) => x.label === "Latest actual trade")!;
    expect(trade.value).toBe("GHS 3.50");
    expect(trade.sub).toMatch(/2026-09-24/);
    expect(trade.sub).toMatch(/11 days ago/);
    expect(trade.stale).toBe(true);
  });
  it("equity with no usable trade: states the reason, never a zero price", () => {
    const f = equityContext(eqInst({ input: { available: false, code: "NO_OBSERVATION", reason: "No actual trade has been recorded." } }));
    const trade = f.find((x) => x.label === "Latest actual trade")!;
    expect(trade.value).toBe("Not available");
    expect(trade.sub).toMatch(/No actual trade/);
    expect(JSON.stringify(f)).not.toMatch(/GHS 0\.00/);
  });
  it("bond: coupon, maturity, observed yield with date, and modified duration from the M7 engine", () => {
    const f = bondContext(bondInst(), VAL);
    expect(f.find((x) => x.label === "Coupon")!.value).toMatch(/22\.00%/);
    expect(f.find((x) => x.label === "Maturity")!.value).toBe("2034-07-01");
    const y = f.find((x) => x.label === "Latest reliable yield")!;
    expect(y.value).toBe("24.50%");
    expect(y.sub).toMatch(/observed 2026-10-01/);
    const d = f.find((x) => x.label === "Rate sensitivity")!;
    expect(d.value).toMatch(/years modified duration/);
    expect(parseFloat(d.value)).toBeGreaterThan(1);
  });
  it("bond with no reliable yield: 'Not available' with the reason", () => {
    const f = bondContext(bondInst({ input: { available: false, code: "NO_OBSERVATION", reason: "No market observation has been imported for this bond." } }), VAL);
    expect(f.find((x) => x.label === "Latest reliable yield")).toMatchObject({ value: "Not available", stale: true });
    expect(f.find((x) => x.label === "Rate sensitivity")).toBeUndefined();
  });
  it("treasury tenor: the latest auction rate for that tenor, dated", () => {
    const curve = { observationDate: "2026-09-28", nodes: [{ tenorDays: 91, interestRatePct: 4.6785 }, { tenorDays: 364, interestRatePct: 9.8339 }] };
    const f = billContext(364, curve, VAL, []);
    expect(f.find((x) => x.label === "Latest auction rate")).toMatchObject({ value: "9.83%" });
    expect(billContext(182, curve, VAL, []).find((x) => x.label === "Latest auction rate")!.value).toBe("Not available");
    expect(billContext(91, null, VAL, []).find((x) => x.label === "Latest auction rate")!.value).toBe("Not available");
  });
  it("context never claims to support or refute the thesis", () => {
    const text = JSON.stringify([equityContext(eqInst()), bondContext(bondInst(), VAL)]);
    expect(text).not.toMatch(/support(s|ed)? the thesis|confirm|prove|refute|disprove/i);
  });
});

describe("portfolio connection", () => {
  const eqRow = (id: string, shares: number): PositionRow => {
    const e = eqInst();
    const korbly = valueEquityPosition(shares, e.input as never);
    return { positionId: id, holding: { assetClass: "EQUITY", positionId: id, securityId: "e1", shares }, instrument: e, valuation: korbly, korblyValuation: korbly, assumption: null } as PositionRow;
  };
  const pf = (positions: PositionRow[], total: number | null, archived = false) => ({ id: "pf1", name: "Core Ghana", archivedAt: archived ? "2026-01-01" : null, summary: { referenceValueGhs: total }, positions }) as unknown as PortfolioDetail;
  const match = (p: PositionRow) => p.holding.assetClass === "EQUITY" && p.holding.securityId === "e1";

  it("reuses the portfolio's own value and computes the weight against its valued total", () => {
    const row = eqRow("p1", 1000);
    const [h] = heldRows([pf([row], 10_000)], match);
    expect(h).toMatchObject({ portfolioName: "Core Ghana", status: "VALUED", valueLabel: "Reference Value", valueGhs: 3500, basis: "REFERENCE" });
    expect(h.weightPct).toBeCloseTo(35, 6);
    expect(h.href).toContain("/portfolios/pf1?view=holdings&position=p1");
  });
  it("a thesis with no holding yields no rows (thesis ≠ position)", () => expect(heldRows([pf([], null)], match)).toEqual([]));
  it("archived portfolios are not listed", () => expect(heldRows([pf([eqRow("p1", 10)], 100, true)], match)).toEqual([]));
  it("an unvalued holding says so, with the reason — not zero", () => {
    const unvalued = { ...eqRow("p1", 10), valuation: { status: "UNVALUED", assetClass: "EQUITY", available: false, code: "NO_OBSERVATION", reason: "No actual trade." } } as unknown as PositionRow;
    const [h] = heldRows([pf([unvalued], null)], match);
    expect(h).toMatchObject({ status: "UNVALUED", valueGhs: null, weightPct: null, unvaluedReason: "No actual trade." });
  });
  it("fallback assumption: labelled Analytical Starting Value, marked FALLBACK, no Korbly value", () => {
    const b = bondInst({ input: { available: false, code: "NO_OBSERVATION", reason: "none" } });
    const v = valueBondWithAssumption(1_000_000, TERMS, { kind: "YIELD_PCT", value: 28, overridesReference: false }, VAL);
    const row = { positionId: "pb", holding: { assetClass: "BOND", positionId: "pb", fixedIncomeSecurityId: "b1", nominalGhs: 1_000_000 }, instrument: b, valuation: v, korblyValuation: valueBondPosition(1_000_000, TERMS, b.input, VAL), assumption: null } as unknown as PositionRow;
    const [h] = heldRows([pf([row], 900_000)], (p) => p.holding.assetClass === "BOND");
    expect(h.valueLabel).toBe("Analytical Starting Value");
    expect(h.basis).toBe("ANALYST_ASSUMPTION");
    expect(h.assumption).toMatchObject({ kind: "FALLBACK", summary: "28.00% yield", korblyValueGhs: null });
  });
  it("analytical override: marked OVERRIDE and the Korbly value stays visible", () => {
    const b = bondInst();
    const korbly = valueBondPosition(1_000_000, TERMS, b.input, VAL);
    const assumed = valueBondWithAssumption(1_000_000, TERMS, { kind: "YIELD_PCT", value: 28, overridesReference: true }, VAL);
    if (korbly.status !== "VALUED" || assumed.status !== "VALUED") throw new Error("valued");
    const v = { ...assumed, korblyBasis: { basis: "REFERENCE" as const, valueGhs: korbly.referenceValueGhs, inputDate: "2026-10-01", recency: "RECENT" as const } };
    const row = { positionId: "pb", holding: { assetClass: "BOND", positionId: "pb", fixedIncomeSecurityId: "b1", nominalGhs: 1_000_000 }, instrument: b, valuation: v, korblyValuation: korbly, assumption: null } as unknown as PositionRow;
    const [h] = heldRows([pf([row], 900_000)], () => true);
    expect(h.assumption).toMatchObject({ kind: "OVERRIDE", korblyValueGhs: korbly.referenceValueGhs });
    expect(h.valueGhs).not.toBe(korbly.referenceValueGhs);
  });
  it("a superseded fallback is reported as inactive and Korbly's value is the one carried", () => {
    const b = bondInst();
    const korbly = valueBondPosition(1_000_000, TERMS, b.input, VAL);
    if (korbly.status !== "VALUED") throw new Error("valued");
    const assumed = valueBondWithAssumption(1_000_000, TERMS, { kind: "YIELD_PCT", value: 28, overridesReference: false }, VAL);
    const v = { ...korbly, ignoredAssumption: assumed.status === "VALUED" ? assumed.assumption : null };
    const row = { positionId: "pb", holding: { assetClass: "BOND", positionId: "pb", fixedIncomeSecurityId: "b1", nominalGhs: 1_000_000 }, instrument: b, valuation: v, korblyValuation: korbly, assumption: null } as unknown as PositionRow;
    const [h] = heldRows([pf([row], 900_000)], () => true);
    expect(h.basis).toBe("REFERENCE");
    expect(h.assumption).toBeNull();
    expect(h.inactiveAssumptionSummary).toBe("28.00% yield");
  });
  it("equity analyst price is an Analytical Starting Value, not a Reference Value", () => {
    const v = valueEquityWithAssumption(100, { kind: "SHARE_PRICE_GHS", value: 10, overridesReference: false }, VAL);
    const row = { positionId: "pe", holding: { assetClass: "EQUITY", positionId: "pe", securityId: "e1", shares: 100 }, instrument: eqInst(), valuation: v, korblyValuation: v, assumption: null } as unknown as PositionRow;
    expect(heldRows([pf([row], 1000)], () => true)[0].valueLabel).toBe("Analytical Starting Value");
  });
});

describe("Korbly-generated copy never recommends, forecasts, scores or judges", () => {
  const strings = [
    ...(Object.values(copy) as unknown[]).filter((v): v is string => typeof v === "string"),
    ...Object.values(copy.PROMPTS),
    ...Object.values(STATUS_LABEL), ...Object.values(STATUS_MEANING), ...Object.values(TRANSITION_ACTION),
    ...Object.values(CONFIDENCE_LABEL), ...Object.values(HORIZON_LABEL), ...Object.values(SUBJECT_KIND_LABEL),
  ];
  const FORBIDDEN: [string, RegExp][] = [
    ["BUY", /\bbuy\b/i], ["SELL", /\bsell\b/i], ["HOLD recommendation", /\bhold (rating|recommendation)\b|\brecommend/i],
    ["expected return", /expected return/i], ["price target", /price target|target price/i], ["probability of success", /probability of (success|being)|likelihood of success|chance of/i],
    ["causation", /\bbecause of\b|\bcaused by\b|\bdue to\b|\bleads? to\b/i], ["thesis confirmed", /thesis (is )?confirmed|confirms (the|this) thesis|\b(thesis )?validated\b/i],
    ["thesis disproven", /disproven|proved? wrong automatically|refuted/i], ["score", /\bscore\b|\brating\b/i],
  ];
  // A sentence that DISCLAIMS ("does not score", "never changes it") is allowed to name the thing it disclaims.
  const asserted = strings.flatMap((s) => s.split(/(?<=[.!?])\s+/)).filter((sentence) => !/\b(not|never|no)\b/i.test(sentence));
  it.each(FORBIDDEN)("no %s language", (_name, re) => {
    for (const s of asserted) expect(s, s).not.toMatch(re);
  });
  it("BUY/SELL/HOLD are not statuses", () => expect(THESIS_STATUSES.some((s) => /buy|sell|hold/i.test(s))).toBe(false));
  it("states that status is analyst-controlled and that closed ≠ invalidated", () => {
    expect(copy.STATUS_ANALYST_NOTE).toMatch(/never changes it automatically/);
    expect(copy.INVALIDATED_VS_CLOSED).toMatch(/Invalidated.*Closed/);
    expect(copy.CONFIDENCE_NOTE).toMatch(/not a probability/);
    expect(copy.AUTHORSHIP_NOTE).toMatch(/does not generate, score or verify/);
  });
  it("the empty-library copy invites capture rather than saying 'No theses'", () => {
    expect(copy.THESIS_LIBRARY_EMPTY).toMatch(/Capture the investment reasoning/);
    expect(copy.THESIS_LIBRARY_EMPTY).not.toBe("No theses.");
  });
});
