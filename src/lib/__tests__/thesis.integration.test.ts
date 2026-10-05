// ---------------------------------------------------------------------------
// Integration tests for investment theses (M9.1) — real database. Only "ZZTH"-tagged
// bonds, portfolios and theses are created (and removed afterwards); real equities and
// Treasury instruments are read-only subjects. No market data is written.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPositionsBatch, createPortfolio, removePosition, setPositionAssumption } from "../portfolio-service";
import { changeThesisStatus, createThesis, updateThesis } from "../thesis-service";
import { getSubjectOptions, getThesis, getThesisContext, getThesisPresenceForPositions, listTheses, listThesesForSubject, subjectOf, subjectRefForPosition } from "../queries/thesis";
import { getInstrumentContext, getPortfolio } from "../queries/portfolio";
import { filterTheses } from "../thesis";

const db = getPrisma();
const TAG = "ZZTH";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const portfolioIds: string[] = [];
let sourceId: string;
let runId: string;
let govId: string;
let corpId: string; // no observation → "No reliable Reference Value", assumable
let equityId: string;
let instrumentId: string;

const full = (over: Record<string, unknown> = {}) => ({ title: `${TAG} duration`, belief: "Hypothetical test belief.", rationale: "Hypothetical test reasoning.", mustBeTrue: ["Condition A", "Condition B"], risks: ["Risk R"], invalidation: ["Reconsider if X"], catalysts: ["Catalyst C"], watching: ["Indicator W"], confidence: "MEDIUM", horizon: "LONG", ...over });
const sec = (id: string) => ({ type: "SECURITY", id }) as const;
const fi = (id: string) => ({ type: "FIXED_INCOME", id }) as const;
const ti = (id: string) => ({ type: "TREASURY_INSTRUMENT", id }) as const;
const mk = async (subject: Parameters<typeof createThesis>[0]["subject"], over: Record<string, unknown> = {}, activate = false) => {
  const r = await createThesis({ subject, content: full(over), activate });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.id;
};
const makeBond = async (code: string, over: Record<string, unknown> = {}) =>
  (await db.fixedIncomeSecurity.create({ data: { instrumentCode: `${TAG}${code}`, instrumentName: `${TAG} ${code}`, issuerName: `${TAG} Issuer`, instrumentType: "CORPORATE_BOND", classification: "CORPORATE", issueDate: d("2025-01-01"), maturityDate: d("2030-01-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", sourceId, ingestionRunId: runId, ...over } })).id;

beforeAll(async () => {
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  sourceId = run.dataSourceId;
  runId = run.id;
  corpId = await makeBond("CORP");
  govId = await makeBond("GOV", { instrumentType: "GOVERNMENT_BOND", classification: "SOVEREIGN", issuerName: "Government of Ghana" });
  equityId = (await db.security.findFirstOrThrow({ where: { ticker: { not: { startsWith: "ZZ" } } }, select: { id: true }, orderBy: { ticker: "asc" } })).id;
  instrumentId = (await db.treasuryInstrument.findFirstOrThrow({ where: { tenorDays: 91, instrumentType: "BILL" }, select: { id: true } })).id;
});

afterAll(async () => {
  await db.thesis.deleteMany({ where: { title: { startsWith: TAG } } });
  await db.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { startsWith: TAG } } });
});

describe("creating theses", () => {
  it("saves a draft with only a subject, a title and a belief", async () => {
    const r = await createThesis({ subject: sec(equityId), content: { title: `${TAG} bare`, belief: "Just a belief." } });
    expect(r).toMatchObject({ ok: true, status: "DRAFT" });
    const t = (await getThesis((r as { id: string }).id))!;
    expect(t).toMatchObject({ status: "DRAFT", confidence: null, horizon: null, rationale: "", mustBeTrue: [] });
  });
  it("activating on create needs the full structure and reports what is missing", async () => {
    const r = await createThesis({ subject: sec(equityId), content: { title: `${TAG} thin`, belief: "b" }, activate: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["confidence", "horizon", "invalidation", "mustBeTrue", "rationale"]);
    expect(await db.thesis.count({ where: { title: `${TAG} thin` } })).toBe(0);
  });
  it("persists every analyst field — confidence, horizon, must-be-true, risks, invalidation, catalysts, watching", async () => {
    const id = await mk(sec(equityId), {}, true);
    const t = (await getThesis(id))!;
    expect(t).toMatchObject({ status: "ACTIVE", confidence: "MEDIUM", horizon: "LONG", mustBeTrue: ["Condition A", "Condition B"], risks: ["Risk R"], invalidation: ["Reconsider if X"], catalysts: ["Catalyst C"], watching: ["Indicator W"] });
  });
  it.each([
    ["equity", () => sec(equityId), "EQUITY"],
    ["government bond", () => fi(govId), "GOVERNMENT_BOND"],
    ["corporate bond", () => fi(corpId), "CORPORATE_BOND"],
    ["Treasury-bill tenor", () => ti(instrumentId), "TREASURY_BILL"],
  ] as const)("supports a %s subject", async (_n, ref, kind) => {
    const id = await mk(ref(), { title: `${TAG} ${kind}` });
    const t = (await getThesis(id))!;
    expect(t.subjectKind).toBe(kind);
    expect(t.subject.ref).toEqual(ref());
  });
  it("refuses a subject that does not exist", async () => {
    expect((await createThesis({ subject: fi("nope"), content: full() })).ok).toBe(false);
    expect(await db.thesis.count({ where: { title: `${TAG} duration`, fixedIncomeSecurityId: "nope" } })).toBe(0);
  });
  it("the database refuses zero or two subjects (CHECK constraint)", async () => {
    await expect(db.thesis.create({ data: { title: `${TAG} none`, belief: "b" } })).rejects.toThrow();
    await expect(db.thesis.create({ data: { title: `${TAG} two`, belief: "b", securityId: equityId, fixedIncomeSecurityId: govId } })).rejects.toThrow();
  });
  it("allows several theses about the same subject without overwriting each other", async () => {
    const a = await mk(fi(govId), { title: `${TAG} multi A`, belief: "First view" });
    const b = await mk(fi(govId), { title: `${TAG} multi B`, belief: "Later view" });
    expect(a).not.toBe(b);
    const list = (await listThesesForSubject(fi(govId))).filter((t) => t.title.startsWith(`${TAG} multi`));
    expect(list.map((t) => t.belief).sort()).toEqual(["First view", "Later view"]);
  });
});

describe("status workflow", () => {
  it("draft → active → challenged → active → invalidated → closed, analyst-controlled with notes and timestamps", async () => {
    const id = await mk(sec(equityId), { title: `${TAG} lifecycle` });
    expect((await getThesis(id))!.status).toBe("DRAFT");
    const t0 = (await getThesis(id))!.statusChangedAt;
    await new Promise((r) => setTimeout(r, 15));
    expect(await changeThesisStatus(id, "ACTIVE")).toMatchObject({ ok: true, status: "ACTIVE" });
    expect(await changeThesisStatus(id, "CHALLENGED", "Weak results")).toMatchObject({ ok: true });
    let t = (await getThesis(id))!;
    expect(t).toMatchObject({ status: "CHALLENGED", statusNote: "Weak results" });
    expect(t.statusChangedAt > t0).toBe(true);
    expect(await changeThesisStatus(id, "ACTIVE")).toMatchObject({ ok: true });
    expect(await changeThesisStatus(id, "INVALIDATED", "X happened")).toMatchObject({ ok: true });
    expect(await changeThesisStatus(id, "CLOSED")).toMatchObject({ ok: true });
    t = (await getThesis(id))!;
    expect(t.status).toBe("CLOSED");
    expect(t.statusNote).toBeNull();
  });
  it("closed is distinct from invalidated and can go no further", async () => {
    const id = await mk(sec(equityId), { title: `${TAG} closed` });
    await changeThesisStatus(id, "CLOSED", "No longer tracked");
    expect((await getThesis(id))!.status).toBe("CLOSED");
    expect((await changeThesisStatus(id, "ACTIVE")).ok).toBe(false);
    expect((await changeThesisStatus(id, "INVALIDATED")).ok).toBe(false);
  });
  it("refuses nonsense transitions and values", async () => {
    const id = await mk(sec(equityId), { title: `${TAG} bad` });
    for (const to of ["INVALIDATED", "CHALLENGED", "DRAFT", "BUY", "SELL", "HOLD", "", undefined]) expect((await changeThesisStatus(id, to)).ok).toBe(false);
    expect((await getThesis(id))!.status).toBe("DRAFT");
    expect((await changeThesisStatus("missing", "ACTIVE")).ok).toBe(false);
  });
  it("a draft that is not complete cannot be activated", async () => {
    const r = await createThesis({ subject: sec(equityId), content: { title: `${TAG} incomplete`, belief: "b" } });
    const id = (r as { id: string }).id;
    const act = await changeThesisStatus(id, "ACTIVE");
    expect(act.ok).toBe(false);
    expect((await getThesis(id))!.status).toBe("DRAFT");
  });
  it("data staleness never changes a status", async () => {
    const id = await mk(fi(corpId), { title: `${TAG} stale` }, true);
    await getThesisContext((await getThesis(id))!.subject);
    expect((await getThesis(id))!.status).toBe("ACTIVE");
  });
});

describe("editing", () => {
  it("edits the words, keeps createdAt, advances updatedAt, leaves subject and status alone", async () => {
    const id = await mk(sec(equityId), { title: `${TAG} edit` }, true);
    const before = (await getThesis(id))!;
    await new Promise((r) => setTimeout(r, 15));
    expect(await updateThesis(id, { ...full({ title: `${TAG} edit v2`, belief: "Revised belief" }) })).toMatchObject({ ok: true });
    const after = (await getThesis(id))!;
    expect(after).toMatchObject({ title: `${TAG} edit v2`, belief: "Revised belief", status: "ACTIVE" });
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(after.subject.ref).toEqual(before.subject.ref);
  });
  it("a live thesis must stay complete when edited", async () => {
    const id = await mk(sec(equityId), { title: `${TAG} keep` }, true);
    const r = await updateThesis(id, full({ title: `${TAG} keep`, invalidation: [] }));
    expect(r.ok).toBe(false);
    expect((await getThesis(id))!.invalidation).toEqual(["Reconsider if X"]);
  });
  it("invalidated and closed theses are records and are not edited", async () => {
    const id = await mk(sec(equityId), { title: `${TAG} record` }, true);
    await changeThesisStatus(id, "INVALIDATED");
    expect((await updateThesis(id, full({ title: `${TAG} record`, belief: "rewritten" }))).ok).toBe(false);
    expect((await getThesis(id))!.belief).toBe("Hypothetical test belief.");
  });
});

describe("library, search and subject picker", () => {
  it("lists theses and filters by status, asset class, confidence and search", async () => {
    await mk(fi(govId), { title: `${TAG} library gov`, confidence: "HIGH" }, true);
    const all = (await listTheses()).filter((t) => t.title.startsWith(TAG));
    expect(all.length).toBeGreaterThan(5);
    expect(filterTheses(all, { subjectKind: "GOVERNMENT_BOND", status: "ACTIVE", confidence: "HIGH", q: "library gov" })).toHaveLength(1);
    expect(filterTheses(all, { q: "ZZTHCORP" }).every((t) => t.subjectCode === "ZZTHCORP")).toBe(true);
    expect(filterTheses(all, { status: "DRAFT" }).every((t) => t.status === "DRAFT")).toBe(true);
  });
  it("the picker offers only real instruments of each kind, with disambiguating detail", async () => {
    const options = await getSubjectOptions();
    expect(options.some((o) => o.kind === "EQUITY")).toBe(true);
    expect(options.some((o) => o.kind === "GOVERNMENT_BOND")).toBe(true);
    expect(options.some((o) => o.kind === "CORPORATE_BOND")).toBe(true);
    expect(options.filter((o) => o.kind === "TREASURY_BILL").map((o) => o.label).sort()).toEqual(["182-day Treasury bills", "364-day Treasury bills", "91-day Treasury bills"]);
    const corp = options.find((o) => o.code === `${TAG}CORP`)!;
    expect(corp.detail).toMatch(/matures 2030-01-01/);
    expect(corp.detail).toMatch(/22\.00% coupon/);
    expect(corp.search).toContain("zzthcorp");
  });
  it("subjectOf resolves a label and a link for each subject", async () => {
    const t = (await getThesis(await mk(sec(equityId), { title: `${TAG} subj` })))!;
    expect(t.subject.href).toBe(`/companies/${t.subject.code}`);
    const g = (await getThesis(await mk(fi(govId), { title: `${TAG} subj2` })))!;
    expect(g.subject.href).toBe(`/fixed-income/${TAG}GOV`);
    expect(subjectOf({ security: null, fixedIncomeSecurity: null, treasuryInstrument: { id: "x", code: "91_DAY_BILL", tenorDays: 91 } }).label).toBe("91-day Treasury bills");
  });
});

describe("portfolio and valuation context", () => {
  it("a thesis with no holding shows no portfolio rows (thesis ≠ position)", async () => {
    const id = await mk(fi(corpId), { title: `${TAG} unheld` });
    const ctx = await getThesisContext((await getThesis(id))!.subject);
    expect(ctx.held.filter((h) => h.portfolioName.startsWith(TAG))).toEqual([]);
    expect(ctx.facts.find((f) => f.label === "Latest reliable yield")).toMatchObject({ value: "Not available", stale: true });
  });
  it("a held subject shows the portfolio, value, weight and scenario link — reusing portfolio outputs; a fallback assumption is disclosed; removing the position leaves the thesis", async () => {
    const pr = await createPortfolio({ name: `${TAG} Core` });
    if (!pr.ok) throw new Error(pr.error);
    portfolioIds.push(pr.id);
    const added = await addPositionsBatch({ portfolioId: pr.id, entries: [{ key: "a", assetClass: "BOND", instrumentId: corpId, nominalGhs: "1,000,000" }, { key: "b", assetClass: "BOND", instrumentId: govId, nominalGhs: "500,000", assumption: { kind: "YIELD_PCT", value: "26" } }] });
    expect(added.ok).toBe(true);
    const portfolio = (await getPortfolio(pr.id, await getInstrumentContext()))!;
    const corpRow = portfolio.positions.find((p) => p.instrument.kind === "BOND" && p.instrument.instrumentCode === `${TAG}CORP`)!;
    const govRow = portfolio.positions.find((p) => p.instrument.kind === "BOND" && p.instrument.instrumentCode === `${TAG}GOV`)!;
    expect(corpRow.valuation.status).toBe("UNVALUED");
    await setPositionAssumption({ positionId: corpRow.positionId, kind: "YIELD_PCT", value: 28 });

    const corpThesis = await mk(fi(corpId), { title: `${TAG} held corp` }, true);
    const ctx = await getThesisContext((await getThesis(corpThesis))!.subject);
    const row = ctx.held.find((h) => h.portfolioId === pr.id)!;
    expect(row).toMatchObject({ portfolioName: `${TAG} Core`, status: "VALUED", valueLabel: "Analytical Starting Value", basis: "ANALYST_ASSUMPTION" });
    expect(row.assumption).toMatchObject({ kind: "FALLBACK", summary: "28.00% yield", korblyValueGhs: null });
    expect(row.weightPct).toBeGreaterThan(0);
    expect(row.weightPct).toBeLessThan(100);
    expect(ctx.scenarioLinks).toContainEqual({ portfolioId: pr.id, portfolioName: `${TAG} Core`, href: `/portfolios/${pr.id}/scenarios` });

    // thesis presence on holdings, matched by subject
    const presence = await getThesisPresenceForPositions(portfolio.positions);
    expect(presence.get(corpRow.positionId)!.live).toBe(2); // this one and the earlier "stale" thesis on the same subject
    expect(presence.get(corpRow.positionId)!.lead!.id).toBe(corpThesis);
    expect(presence.get(govRow.positionId)!.live).toBeGreaterThanOrEqual(1); // earlier ACTIVE gov theses
    expect(await subjectRefForPosition(corpRow)).toEqual(fi(corpId));

    // removing the position does not touch the thesis
    await removePosition(corpRow.positionId);
    expect((await getThesis(corpThesis))!.status).toBe("ACTIVE");
    expect((await getThesisContext((await getThesis(corpThesis))!.subject)).held.filter((h) => h.portfolioId === pr.id)).toEqual([]);
  });
  it("a Treasury-bill tenor thesis finds bill holdings of that tenor", async () => {
    const id = await mk(ti(instrumentId), { title: `${TAG} bills` });
    const t = (await getThesis(id))!;
    const ctx = await getThesisContext(t.subject);
    expect(ctx.facts[0]).toMatchObject({ label: "Tenor", value: "91-day Treasury bill" });
    expect(ctx.facts.find((f) => f.label === "Latest auction rate")).toBeTruthy();
  });
});
