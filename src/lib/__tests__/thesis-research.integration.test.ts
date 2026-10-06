// ---------------------------------------------------------------------------
// Integration tests for thesis evidence, catalysts, invalidation flags and review (M9.2) — real
// database. Only "ZZTR"-tagged theses are created (and removed afterwards), plus one tagged macro series
// used to prove snapshots survive a source revision. Real Korbly observations are only READ (linked).
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { changeThesisStatus, createThesis, updateThesis } from "../thesis-service";
import { addCatalyst, addManualEvidence, archiveEvidence, changeCatalystStatus, deleteCatalyst, linkKorblyEvidence, markReviewed, setInvalidationFlag, updateCatalyst, updateEvidence } from "../thesis-research-service";
import { findObservationId, listDatasets, listObservations } from "../queries/thesis-evidence";
import { getThesis, getThesisPresenceForPositions, getThesisResearch, listTheses, listThesesForSubject } from "../queries/thesis";
import { filterTheses } from "../thesis";

const db = getPrisma();
const TAG = "ZZTR";
const DAY = 86_400_000;
let equityId: string;
let bondId: string;
let billInstrumentId: string;
let runId: string;
let sourceId: string;
const real: Record<string, string> = {};

const full = (over: Record<string, unknown> = {}) => ({ title: `${TAG} duration`, belief: "Hypothetical test belief.", rationale: "Hypothetical test reasoning.", mustBeTrue: ["Inflation keeps moderating", "Policy rate falls"], risks: ["Risk R"], invalidation: ["Inflation reaccelerates", "Auction demand collapses"], watching: ["Indicator W"], confidence: "HIGH", horizon: "MEDIUM", ...over });
const mk = async (over: Record<string, unknown> = {}, activate = true, subject: Parameters<typeof createThesis>[0]["subject"] = { type: "SECURITY", id: equityId }) => {
  const r = await createThesis({ subject, content: full(over), activate });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.id;
};
const manual = (over: Record<string, unknown> = {}) => ({ stance: "SUPPORTS", relevance: "HIGH", sourceType: "OFFICIAL_SOURCE", title: "September inflation fell further", detail: "Headline inflation continued to moderate.", sourceName: "Ghana Statistical Service", sourceUrl: "https://statsghana.gov.gh/", observedAt: "2026-09-30", note: "Supports the disinflation condition.", ...over });
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
// Other suites re-ingest observation rows concurrently, so a row id read in beforeAll can be replaced; resolve fresh and retry.
const resolvers: Record<string, () => Promise<string>> = {
  cpi: async () => (await db.macroObservation.findFirstOrThrow({ where: { series: { code: "GSS_CPI_INFLATION_YOY" } }, orderBy: { observationDate: "desc" }, select: { id: true } })).id,
  mpr: async () => (await db.policyDecision.findFirstOrThrow({ orderBy: { decisionDate: "desc" }, select: { id: true } })).id,
  bill: async () => (await db.treasuryRate.findFirstOrThrow({ where: { instrumentId: billInstrumentId }, orderBy: { observationDate: "desc" }, select: { id: true } })).id,
  fx: async () => (await db.exchangeRate.findFirstOrThrow({ where: { currencyPair: { code: "USDGHS" } }, orderBy: { observationDate: "desc" }, select: { id: true } })).id,
  equity: async () => (await db.securityPrice.findFirstOrThrow({ where: { securityId: equityId, volume: { gt: 0 } }, orderBy: { tradingDate: "desc" }, select: { id: true } })).id,
  bond: async () => (await db.fixedIncomeObservation.findFirstOrThrow({ where: { securityId: bondId, OR: [{ tradeStatus: "TRADED" }, { tradeStatus: null }], NOT: { sourceYieldPct: null } }, orderBy: { observationDate: "desc" }, select: { id: true } })).id,
};
const linkReal = async (t: string, key: string, kind: Parameters<typeof linkKorblyEvidence>[1]["refKind"], rest: { stance: string; relevance: string; note?: string }) => {
  for (let attempt = 0; ; attempt++) {
    real[key] = await resolvers[key]();
    const r = await linkKorblyEvidence(t, { refKind: kind, refId: real[key], ...rest });
    if (r.ok || attempt >= 3) return r;
  }
};
const conditionId = async (thesisId: string, kind: "MUST_BE_TRUE" | "INVALIDATION", index = 0) => (await db.thesisCondition.findMany({ where: { thesisId, kind, retiredAt: null }, orderBy: { position: "asc" } }))[index].id;

beforeAll(async () => {
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  runId = run.id;
  sourceId = run.dataSourceId;
  equityId = (await db.securityPrice.findFirstOrThrow({ where: { volume: { gt: 0 }, security: { ticker: { not: { startsWith: "ZZ" } } } }, select: { securityId: true } })).securityId;
  billInstrumentId = (await db.treasuryInstrument.findFirstOrThrow({ where: { tenorDays: 91, instrumentType: "BILL" }, select: { id: true } })).id;
  const bondObs = await db.fixedIncomeObservation.findFirstOrThrow({ where: { OR: [{ tradeStatus: "TRADED" }, { tradeStatus: null }], security: { instrumentCode: { not: { startsWith: "ZZ" } } }, NOT: { sourceYieldPct: null } }, orderBy: { observationDate: "desc" }, select: { id: true, securityId: true } });
  bondId = bondObs.securityId;
  real.bond = bondObs.id;
  real.cpi = (await db.macroObservation.findFirstOrThrow({ where: { series: { code: "GSS_CPI_INFLATION_YOY" } }, orderBy: { observationDate: "desc" }, select: { id: true } })).id;
  real.mpr = (await db.policyDecision.findFirstOrThrow({ orderBy: { decisionDate: "desc" }, select: { id: true } })).id;
  real.bill = (await db.treasuryRate.findFirstOrThrow({ where: { instrumentId: billInstrumentId }, orderBy: { observationDate: "desc" }, select: { id: true } })).id;
  real.fx = (await db.exchangeRate.findFirstOrThrow({ where: { currencyPair: { code: "USDGHS" } }, orderBy: { observationDate: "desc" }, select: { id: true } })).id;
  real.equity = (await db.securityPrice.findFirstOrThrow({ where: { securityId: equityId, volume: { gt: 0 } }, orderBy: { tradingDate: "desc" }, select: { id: true } })).id;
});

afterAll(async () => {
  await db.thesis.deleteMany({ where: { title: { startsWith: TAG } } });
  await db.macroObservation.deleteMany({ where: { series: { code: { startsWith: TAG } } } });
  await db.macroSeries.deleteMany({ where: { code: { startsWith: TAG } } });
});

describe("manual evidence", () => {
  it("stores a supporting official-source item with every field, and nothing is invented", async () => {
    const t = await mk();
    const id = ok(await addManualEvidence(t, manual())).id;
    const row = await db.thesisEvidence.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ thesisId: t, stance: "SUPPORTS", relevance: "HIGH", sourceType: "OFFICIAL_SOURCE", title: "September inflation fell further", sourceName: "Ghana Statistical Service", sourceUrl: "https://statsghana.gov.gh/", note: "Supports the disinflation condition.", refKind: null, refId: null, snapshot: null, archivedAt: null });
    expect(row.observedAt?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });
  it.each([["CHALLENGES", "EXTERNAL_SOURCE"], ["CONTEXT", "COMPANY_DISCLOSURE"], ["SUPPORTS", "ANALYST_OBSERVATION"]])("accepts stance %s from %s", async (stance, sourceType) => {
    const t = await mk();
    ok(await addManualEvidence(t, manual({ stance, sourceType, ...(sourceType === "ANALYST_OBSERVATION" ? { sourceName: "", sourceUrl: "", observedAt: "" } : {}) })));
    expect((await getThesisResearch(t))!.evidence[0]).toMatchObject({ stance, sourceType });
  });
  it("an analyst observation records no outside source and does not invent an identity", async () => {
    const t = await mk();
    const id = ok(await addManualEvidence(t, manual({ sourceType: "ANALYST_OBSERVATION", sourceName: "", sourceUrl: "", observedAt: "", title: "Auction cover looked thin" }))).id;
    const row = await db.thesisEvidence.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ sourceName: null, sourceUrl: null, observedAt: null });
    expect(Object.keys(row)).not.toContain("authorId");
  });
  it("rejects invalid input with field errors and writes nothing", async () => {
    const t = await mk();
    for (const bad of [{ stance: "PROVES" }, { relevance: "83%" }, { sourceType: "KORBLY_DATA" }, { sourceUrl: "javascript:alert(1)" }, { sourceName: "" }, { observedAt: "" }, { observedAt: "2999-01-01" }, { title: "" }, { note: "x".repeat(2001) }]) {
      const r = await addManualEvidence(t, manual(bad));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect((r as { fieldErrors?: object }).fieldErrors).toBeTruthy();
    }
    expect(await db.thesisEvidence.count({ where: { thesisId: t } })).toBe(0);
  });
  it("refuses evidence for a thesis that does not exist", async () => expect(await addManualEvidence("nope", manual())).toMatchObject({ ok: false, error: "Thesis not found." }));
  it("is independent per thesis", async () => {
    const a = await mk();
    const b = await mk();
    ok(await addManualEvidence(a, manual()));
    ok(await addManualEvidence(a, manual({ title: "Second" })));
    ok(await addManualEvidence(b, manual({ title: "Other" })));
    expect((await getThesisResearch(a))!.evidence).toHaveLength(2);
    expect((await getThesisResearch(b))!.evidence.map((e) => e.title)).toEqual(["Other"]);
  });
  it("is allowed on a draft, and refused on an invalidated or closed thesis (a record)", async () => {
    const draft = await mk({}, false);
    ok(await addManualEvidence(draft, manual()));
    for (const to of ["INVALIDATED", "CLOSED"] as const) {
      const t = await mk();
      ok(await changeThesisStatus(t, to));
      expect(await addManualEvidence(t, manual())).toMatchObject({ ok: false, error: expect.stringMatching(/record of what was believed/) });
      expect(await addCatalyst(t, { description: "x", windowKind: "NONE" })).toMatchObject({ ok: false });
      expect(await markReviewed(t)).toMatchObject({ ok: false });
    }
  });
  it("orders by relevance, then date; filters by stance through the read model", async () => {
    const t = await mk();
    ok(await addManualEvidence(t, manual({ title: "low-new", relevance: "LOW", observedAt: "2026-10-01" })));
    ok(await addManualEvidence(t, manual({ title: "high-old", relevance: "HIGH", observedAt: "2026-08-01" })));
    ok(await addManualEvidence(t, manual({ title: "high-new", relevance: "HIGH", observedAt: "2026-09-01", stance: "CHALLENGES" })));
    const r = (await getThesisResearch(t))!;
    expect(r.evidence.map((e) => e.title)).toEqual(["high-new", "high-old", "low-new"]);
    expect(r.evidence.filter((e) => e.stance === "CHALLENGES").map((e) => e.title)).toEqual(["high-new"]);
  });
});

describe("evidence edit, archive and retirement", () => {
  it("manual evidence is fully editable", async () => {
    const t = await mk();
    const id = ok(await addManualEvidence(t, manual())).id;
    ok(await updateEvidence(id, manual({ title: "Corrected title", stance: "CHALLENGES", relevance: "LOW", sourceName: "BoG" })));
    expect(await db.thesisEvidence.findUniqueOrThrow({ where: { id } })).toMatchObject({ title: "Corrected title", stance: "CHALLENGES", relevance: "LOW", sourceName: "BoG" });
    expect(await updateEvidence(id, manual({ sourceUrl: "not a url" }))).toMatchObject({ ok: false });
  });
  it("archiving keeps the row, drops it from the thesis, and cannot be repeated", async () => {
    const t = await mk();
    const id = ok(await addManualEvidence(t, manual())).id;
    ok(await archiveEvidence(id));
    expect((await db.thesisEvidence.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    const r = (await getThesisResearch(t))!;
    expect(r.evidence).toHaveLength(0);
    expect(r.archivedEvidenceCount).toBe(1);
    expect(await archiveEvidence(id)).toMatchObject({ ok: false });
    expect(await updateEvidence(id, manual())).toMatchObject({ ok: false });
  });
  it("an archived item no longer counts toward the review signal", async () => {
    const t = await mk();
    const id = ok(await addManualEvidence(t, manual({ stance: "CHALLENGES" }))).id;
    expect((await getThesisResearch(t))!.state.reviewSuggested).toBe(true);
    ok(await archiveEvidence(id));
    expect((await getThesisResearch(t))!.state.reviewSuggested).toBe(false);
  });
  it("deleting a thesis removes its evidence (ownership), never another thesis's", async () => {
    const a = await mk({ title: `${TAG} del-a` });
    const b = await mk({ title: `${TAG} del-b` });
    ok(await addManualEvidence(a, manual()));
    ok(await addManualEvidence(b, manual()));
    await db.thesis.delete({ where: { id: a } });
    expect(await db.thesisEvidence.count({ where: { thesisId: a } })).toBe(0);
    expect(await db.thesisEvidence.count({ where: { thesisId: b } })).toBe(1);
  });
});

describe("Korbly-linked evidence (real observations)", () => {
  it.each([["MACRO_OBSERVATION", "cpi"], ["POLICY_DECISION", "mpr"], ["TREASURY_RATE", "bill"], ["FX_RATE", "fx"], ["EQUITY_PRICE", "equity"], ["BOND_OBSERVATION", "bond"]] as const)("links %s with a full snapshot and provenance", async (kind, key) => {
    const t = await mk();
    const id = ok(await linkReal(t, key, kind, { stance: "SUPPORTS", relevance: "MEDIUM", note: "Analyst reading." })).id;
    const e = (await getThesisResearch(t))!.evidence.find((x) => x.id === id)!;
    expect(e).toMatchObject({ sourceType: "KORBLY_DATA", refKind: kind, note: "Analyst reading.", stance: "SUPPORTS" });
    const s = e.snapshot!;
    expect(s.displayValue).toBeTruthy();
    expect(s.observationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.observedAt).toBe(s.observationDate);
    expect(s.source).toMatchObject({ name: expect.any(String), provider: expect.any(String), ingestionRunId: expect.any(String), retrievedAt: expect.any(String) });
    expect(s.quality).toMatchObject({ recency: expect.stringMatching(/CURRENT|STALE/), ageDaysAtLink: expect.any(Number) });
    expect(e.title).toContain(s.displayValue);
    const raw = await db.thesisEvidence.findUniqueOrThrow({ where: { id } });
    expect(raw.refId).toBe(real[key]);
  });
  it("freezes the observation: a later revision of the source does not change the evidence, and is reported", async () => {
    const series = await db.macroSeries.create({ data: { code: `${TAG}_SERIES`, name: `${TAG} test series`, unit: "%", frequency: "MONTHLY", sourceId } });
    const obs = await db.macroObservation.create({ data: { seriesId: series.id, observationDate: new Date("2026-09-30T00:00:00.000Z"), value: 23.8, ingestionRunId: runId } });
    const t = await mk();
    const id = ok(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: obs.id, stance: "SUPPORTS", relevance: "HIGH" })).id;
    const before = (await getThesisResearch(t))!.evidence[0];
    expect(before.snapshot!.displayValue).toBe("23.80%");
    expect(before.revisedTo).toBeNull();
    await db.macroObservation.update({ where: { id: obs.id }, data: { value: 31.2 } }); // the publisher revises the figure
    const after = (await getThesisResearch(t))!.evidence[0];
    expect(after.snapshot!.displayValue).toBe("23.80%"); // what was linked is unchanged
    expect(after.title).toBe(before.title);
    expect(after.revisedTo).toBe("31.20%"); // …and the revision is visible, not silent
    expect((await db.thesisEvidence.findUniqueOrThrow({ where: { id } })).snapshot).toEqual(JSON.parse(JSON.stringify(before.snapshot)));
  });
  it("editing linked evidence changes the interpretation only — never the observation", async () => {
    const t = await mk();
    const id = ok(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: real.cpi, stance: "SUPPORTS", relevance: "HIGH", note: "first" })).id;
    const before = await db.thesisEvidence.findUniqueOrThrow({ where: { id } });
    ok(await updateEvidence(id, { stance: "CHALLENGES", relevance: "LOW", note: "second", title: "REWRITTEN", sourceName: "Forged", observedAt: "2001-01-01", snapshot: "{}", refId: "x" }));
    const after = await db.thesisEvidence.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ stance: "CHALLENGES", relevance: "LOW", note: "second" });
    expect(after.title).toBe(before.title);
    expect(after.sourceName).toBeNull();
    expect(after.observedAt).toEqual(before.observedAt);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.refId).toBe(before.refId);
  });
  it("refuses a nonexistent observation, an unknown kind, and a duplicate link; allows re-linking after archive", async () => {
    const t = await mk();
    expect(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: "does-not-exist", stance: "SUPPORTS", relevance: "LOW" })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    expect(await linkKorblyEvidence(t, { refKind: "NOPE", refId: real.cpi, stance: "SUPPORTS", relevance: "LOW" })).toMatchObject({ ok: false });
    expect(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: real.cpi, stance: "BULLISH", relevance: "LOW" })).toMatchObject({ ok: false });
    const id = ok(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: real.cpi, stance: "SUPPORTS", relevance: "LOW" })).id;
    expect(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: real.cpi, stance: "CHALLENGES", relevance: "HIGH" })).toMatchObject({ ok: false, error: "That observation is already linked to this thesis." });
    ok(await archiveEvidence(id));
    ok(await linkKorblyEvidence(t, { refKind: "MACRO_OBSERVATION", refId: real.cpi, stance: "CHALLENGES", relevance: "HIGH" }));
    // the same observation on another thesis is fine
    ok(await linkKorblyEvidence(await mk(), { refKind: "MACRO_OBSERVATION", refId: real.cpi, stance: "SUPPORTS", relevance: "LOW" }));
  });
  it("refuses carried prices that are not real observations (no shares traded; NOT_TRADED)", async () => {
    const t = await mk();
    const noTrade = await db.securityPrice.findFirst({ where: { OR: [{ volume: null }, { volume: 0 }] }, select: { id: true } });
    if (noTrade) expect(await linkKorblyEvidence(t, { refKind: "EQUITY_PRICE", refId: noTrade.id, stance: "CONTEXT", relevance: "LOW" })).toMatchObject({ ok: false, error: expect.stringMatching(/carried forward/) });
    const notTraded = await db.fixedIncomeObservation.findFirst({ where: { tradeStatus: "NOT_TRADED" }, select: { id: true } });
    if (notTraded) expect(await linkKorblyEvidence(t, { refKind: "BOND_OBSERVATION", refId: notTraded.id, stance: "CONTEXT", relevance: "LOW" })).toMatchObject({ ok: false, error: expect.stringMatching(/carried forward/) });
  });
  it("the picker only offers linkable observations and resolves a context fact's date", async () => {
    expect((await listObservations("EQUITY_PRICE", equityId, 5)).length).toBeGreaterThan(0);
    const [latest] = await listObservations("TREASURY_RATE", billInstrumentId, 1);
    expect(await findObservationId("TREASURY_RATE", billInstrumentId, latest.date)).toBe(latest.id);
    expect(await findObservationId("TREASURY_RATE", billInstrumentId, "1999-01-01")).toBeNull();
    const ds = await listDatasets({ ref: { type: "SECURITY", id: equityId }, label: "X", sublabel: "X" });
    expect(ds[0].group).toBe("About this thesis");
    expect(ds.map((d) => d.kind)).toEqual(expect.arrayContaining(["MACRO_OBSERVATION", "POLICY_DECISION", "TREASURY_RATE", "FX_RATE"]));
  });
  it("a bond thesis can link its own bond observations (the 'instrument with data' case)", async () => {
    const t = await mk({}, true, { type: "FIXED_INCOME", id: bondId });
    ok(await linkReal(t, "bond", "BOND_OBSERVATION", { stance: "SUPPORTS", relevance: "HIGH" }));
    expect((await listDatasets({ ref: { type: "FIXED_INCOME", id: bondId }, label: "B", sublabel: "B" }))[0].kind).toBe("BOND_OBSERVATION");
  });
});

describe("evidence targets: a condition, a catalyst, or the thesis as a whole", () => {
  it("links to a must-be-true condition and an invalidation condition", async () => {
    const t = await mk();
    const must = await conditionId(t, "MUST_BE_TRUE");
    const wrong = await conditionId(t, "INVALIDATION");
    ok(await addManualEvidence(t, manual({ conditionId: must })));
    ok(await addManualEvidence(t, manual({ title: "b", conditionId: wrong, stance: "CHALLENGES" })));
    ok(await addManualEvidence(t, manual({ title: "c" })));
    const r = (await getThesisResearch(t))!;
    expect(r.evidence.find((e) => e.title === "September inflation fell further")!.target).toMatchObject({ kind: "CONDITION", id: must });
    expect(r.evidence.find((e) => e.title === "c")!.target).toBeNull();
    expect(r.conditions.find((c) => c.id === must)!.evidenceCount).toBe(1);
  });
  it("links to a catalyst; rejects a target from another thesis, a retired condition, or both at once", async () => {
    const t = await mk();
    const other = await mk();
    const cat = ok(await addCatalyst(t, { description: "MPC decision", windowKind: "MONTH", windowValue: "2026-11" })).id;
    ok(await addManualEvidence(t, manual({ catalystId: cat })));
    const foreign = await conditionId(other, "MUST_BE_TRUE");
    expect(await addManualEvidence(t, manual({ conditionId: foreign }))).toMatchObject({ ok: false, error: "That condition does not belong to this thesis." });
    expect(await addManualEvidence(t, manual({ conditionId: await conditionId(t, "MUST_BE_TRUE"), catalystId: cat }))).toMatchObject({ ok: false, error: expect.stringMatching(/not both/) });
    expect(await addManualEvidence(t, manual({ conditionId: "bogus" }))).toMatchObject({ ok: false });
    const foreignCatalyst = ok(await addCatalyst(other, { description: "elsewhere", windowKind: "NONE" })).id;
    expect(await addManualEvidence(t, manual({ catalystId: foreignCatalyst }))).toMatchObject({ ok: false, error: "That catalyst does not belong to this thesis." });
    // a condition that has been retired by rewording can no longer be a new target
    const old = await conditionId(t, "MUST_BE_TRUE", 1);
    ok(await addManualEvidence(t, manual({ conditionId: old, title: "pins it" })));
    ok(await updateThesis(t, full({ mustBeTrue: ["Inflation keeps moderating", "Something else entirely"] })));
    expect(await addManualEvidence(t, manual({ conditionId: old }))).toMatchObject({ ok: false, error: "That condition does not belong to this thesis." });
  });
  it("the database itself refuses an evidence row with two targets, a fake Korbly link, or a flag on a must-be-true condition", async () => {
    const t = await mk();
    const c = await conditionId(t, "MUST_BE_TRUE");
    const k = ok(await addCatalyst(t, { description: "x", windowKind: "NONE" })).id;
    const row = { thesisId: t, stance: "SUPPORTS", relevance: "LOW", title: "x" } as const;
    await expect(db.thesisEvidence.create({ data: { ...row, sourceType: "EXTERNAL_SOURCE", conditionId: c, catalystId: k } })).rejects.toThrow();
    await expect(db.thesisEvidence.create({ data: { ...row, sourceType: "KORBLY_DATA" } })).rejects.toThrow();
    await expect(db.thesisEvidence.create({ data: { ...row, sourceType: "EXTERNAL_SOURCE", refKind: "MACRO_OBSERVATION", refId: "x", snapshot: {} } })).rejects.toThrow();
    await expect(db.thesisCondition.update({ where: { id: c }, data: { flag: "TRIGGERED" } })).rejects.toThrow();
    await expect(db.thesisCatalyst.update({ where: { id: k }, data: { windowKind: "DATE" } })).rejects.toThrow();
  });
  it("evidence-linked conditions survive rewording as retired; unlinked ones are simply replaced", async () => {
    const t = await mk();
    const must = await conditionId(t, "MUST_BE_TRUE", 0);
    ok(await addManualEvidence(t, manual({ conditionId: must })));
    ok(await updateThesis(t, full({ mustBeTrue: ["Inflation keeps moderating sharply", "Policy rate falls"] })));
    const row = await db.thesisCondition.findUniqueOrThrow({ where: { id: must } });
    expect(row.retiredAt).not.toBeNull();
    const view = (await getThesisResearch(t))!;
    expect(view.evidence[0].target).toMatchObject({ id: must, retired: true, label: "Inflation keeps moderating" });
    expect((await getThesis(t))!.mustBeTrue).toEqual(["Inflation keeps moderating sharply", "Policy rate falls"]);
    // the untouched one kept its identity
    expect(await db.thesisCondition.count({ where: { thesisId: t, kind: "MUST_BE_TRUE", retiredAt: null, text: "Policy rate falls" } })).toBe(1);
    // an unreferenced reworded condition is deleted rather than retired
    ok(await updateThesis(t, full({ mustBeTrue: ["Inflation keeps moderating sharply", "Policy rate falls 200bps"] })));
    expect(await db.thesisCondition.count({ where: { thesisId: t, text: "Policy rate falls" } })).toBe(0);
  });
});

describe("catalysts", () => {
  it("creates watching catalysts with an exact date, a month, a quarter, or no date", async () => {
    const t = await mk();
    for (const [windowKind, windowValue, label] of [["DATE", "2026-11-20", "20 Nov 2026"], ["MONTH", "2026-11", "November 2026"], ["QUARTER", "2027-Q1", "Q1 2027"], ["NONE", "", "No date set"]] as const) {
      ok(await addCatalyst(t, { description: `c-${windowKind}`, windowKind, windowValue }));
      expect((await getThesisResearch(t))!.catalysts.find((c) => c.description === `c-${windowKind}`)).toMatchObject({ status: "WATCHING", windowLabel: label, occurredOn: null });
    }
  });
  it("rejects an invalid description or window", async () => {
    const t = await mk();
    for (const bad of [{ description: "", windowKind: "NONE" }, { description: "x", windowKind: "DATE", windowValue: "2026-02-30" }, { description: "x", windowKind: "QUARTER", windowValue: "2027-Q9" }, { description: "x".repeat(201), windowKind: "NONE" }]) expect((await addCatalyst(t, bad)).ok, JSON.stringify(bad)).toBe(false);
    expect(await db.thesisCatalyst.count({ where: { thesisId: t } })).toBe(0);
  });
  it("WATCHING → OCCURRED records the date and analyst note and changes neither thesis status nor confidence", async () => {
    const t = await mk();
    const k = ok(await addCatalyst(t, { description: "MPC decision", windowKind: "MONTH", windowValue: "2026-09" })).id;
    ok(await changeCatalystStatus(k, "OCCURRED", { occurredOn: "2026-09-25", outcomeNote: "Held at 14%." }));
    expect((await getThesisResearch(t))!.catalysts[0]).toMatchObject({ status: "OCCURRED", occurredOn: "2026-09-25", outcomeNote: "Held at 14%.", timing: null });
    expect(await db.thesis.findUniqueOrThrow({ where: { id: t }, select: { status: true, confidence: true } })).toEqual({ status: "ACTIVE", confidence: "HIGH" });
    // reopening clears the occurrence
    ok(await changeCatalystStatus(k, "WATCHING"));
    expect(await db.thesisCatalyst.findUniqueOrThrow({ where: { id: k } })).toMatchObject({ status: "WATCHING", occurredOn: null, outcomeNote: null });
  });
  it("supports missed and no-longer-relevant, rejects invalid transitions and future occurrence dates", async () => {
    const t = await mk();
    const k = ok(await addCatalyst(t, { description: "x", windowKind: "NONE" })).id;
    expect(await changeCatalystStatus(k, "WATCHING")).toMatchObject({ ok: false });
    expect(await changeCatalystStatus(k, "DONE")).toMatchObject({ ok: false });
    expect(await changeCatalystStatus(k, "OCCURRED", { occurredOn: "2999-01-01" })).toMatchObject({ ok: false });
    ok(await changeCatalystStatus(k, "MISSED", { outcomeNote: "Did not happen." }));
    expect(await changeCatalystStatus(k, "NO_LONGER_RELEVANT")).toMatchObject({ ok: false });
    ok(await changeCatalystStatus(k, "WATCHING"));
    ok(await changeCatalystStatus(k, "NO_LONGER_RELEVANT"));
  });
  it("can be edited; one with linked evidence cannot be deleted, one without can", async () => {
    const t = await mk();
    const k = ok(await addCatalyst(t, { description: "old", windowKind: "NONE" })).id;
    ok(await updateCatalyst(k, { description: "new", windowKind: "QUARTER", windowValue: "2027-Q2" }));
    expect((await getThesisResearch(t))!.catalysts[0]).toMatchObject({ description: "new", windowLabel: "Q2 2027" });
    ok(await addManualEvidence(t, manual({ catalystId: k })));
    expect(await deleteCatalyst(k)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer relevant/) });
    const k2 = ok(await addCatalyst(t, { description: "temp", windowKind: "NONE" })).id;
    ok(await deleteCatalyst(k2));
    expect(await db.thesisCatalyst.count({ where: { id: k2 } })).toBe(0);
  });
  it("an occurrence can become evidence (catalyst-linked evidence)", async () => {
    const t = await mk();
    const k = ok(await addCatalyst(t, { description: "MPC", windowKind: "NONE" })).id;
    ok(await changeCatalystStatus(k, "OCCURRED", { outcomeNote: "Cut by 100bps." }));
    ok(await addManualEvidence(t, manual({ catalystId: k, title: "MPC cut 100bps" })));
    expect((await getThesisResearch(t))!.catalysts[0].evidenceCount).toBe(1);
  });
  it("timeline shows the occurrence on the date it happened", async () => {
    const t = await mk();
    const k = ok(await addCatalyst(t, { description: "MPC", windowKind: "NONE" })).id;
    ok(await changeCatalystStatus(k, "OCCURRED", { occurredOn: "2026-09-25" }));
    expect((await getThesisResearch(t))!.timeline.find((e) => e.kind === "CATALYST_OCCURRED")).toMatchObject({ date: "2026-09-25", title: "MPC" });
  });
  it("migrated/legacy catalysts and the library next-catalyst summary", async () => {
    const t = await mk();
    ok(await addCatalyst(t, { description: "later", windowKind: "MONTH", windowValue: "2030-01" }));
    ok(await addCatalyst(t, { description: "sooner", windowKind: "MONTH", windowValue: "2029-01" }));
    const s = (await listTheses()).find((x) => x.id === t)!;
    expect(s.research.nextCatalyst).toMatchObject({ description: "sooner", label: "January 2029", timing: "UPCOMING" });
  });
});

describe("invalidation conditions", () => {
  it("default to not observed; walk to potentially triggered and triggered; reset only via potential; never touch status or confidence", async () => {
    const t = await mk();
    const c = await conditionId(t, "INVALIDATION");
    expect((await getThesisResearch(t))!.conditions.find((x) => x.id === c)).toMatchObject({ flag: "NOT_OBSERVED", flagChangedAt: null });
    ok(await setInvalidationFlag(c, "POTENTIALLY_TRIGGERED", "CPI jumped"));
    expect(await db.thesisCondition.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ flag: "POTENTIALLY_TRIGGERED", flagNote: "CPI jumped" });
    ok(await setInvalidationFlag(c, "TRIGGERED"));
    expect(await setInvalidationFlag(c, "NOT_OBSERVED")).toMatchObject({ ok: false });
    ok(await setInvalidationFlag(c, "POTENTIALLY_TRIGGERED"));
    ok(await setInvalidationFlag(c, "NOT_OBSERVED", "False alarm"));
    expect(await db.thesis.findUniqueOrThrow({ where: { id: t }, select: { status: true, confidence: true } })).toEqual({ status: "ACTIVE", confidence: "HIGH" });
  });
  it("rejects bad input: unknown flag, no-op, flagging a must-be-true condition, overlong note, unknown condition", async () => {
    const t = await mk();
    const c = await conditionId(t, "INVALIDATION");
    expect(await setInvalidationFlag(c, "INVALIDATED")).toMatchObject({ ok: false });
    expect(await setInvalidationFlag(c, "NOT_OBSERVED")).toMatchObject({ ok: false });
    expect(await setInvalidationFlag(await conditionId(t, "MUST_BE_TRUE"), "TRIGGERED")).toMatchObject({ ok: false, error: expect.stringMatching(/could prove us wrong/) });
    expect(await setInvalidationFlag(c, "TRIGGERED", "x".repeat(501))).toMatchObject({ ok: false });
    expect(await setInvalidationFlag("nope", "TRIGGERED")).toMatchObject({ ok: false });
  });
  it("a flagged condition drives the review signal and appears on the timeline", async () => {
    const t = await mk();
    const c = await conditionId(t, "INVALIDATION");
    ok(await setInvalidationFlag(c, "POTENTIALLY_TRIGGERED", "n"));
    const r = (await getThesisResearch(t))!;
    expect(r.state.reasons.map((x) => x.code)).toContain("INVALIDATION_POTENTIAL");
    expect(r.timeline.find((e) => e.kind === "INVALIDATION_FLAGGED")).toMatchObject({ title: "Inflation reaccelerates" });
    expect((await getThesis(t))!.status).toBe("ACTIVE");
  });
  it("evidence can be linked to an invalidation condition", async () => {
    const t = await mk();
    const c = await conditionId(t, "INVALIDATION");
    ok(await addManualEvidence(t, manual({ conditionId: c, stance: "CHALLENGES" })));
    expect((await getThesisResearch(t))!.conditions.find((x) => x.id === c)!.evidenceCount).toBe(1);
  });
});

describe("review", () => {
  it("never reviewed → counts from creation; marking reviewed sets the baseline and resets 'new since' but deletes nothing", async () => {
    const t = await mk();
    ok(await addManualEvidence(t, manual({ stance: "CHALLENGES", title: "challenge" })));
    ok(await addManualEvidence(t, manual({ stance: "SUPPORTS", title: "support" })));
    const before = (await getThesisResearch(t))!;
    expect(before.state).toMatchObject({ neverReviewed: true, reviewSuggested: true, since: { total: 2, supports: 1, challenges: 1 } });
    expect(before.evidence.every((e) => e.isNew)).toBe(true);
    ok(await markReviewed(t, "Looked at it; view unchanged.", new Date(Date.now() + 5_000)));
    const after = (await getThesisResearch(t))!;
    expect(after.state).toMatchObject({ neverReviewed: false, reviewSuggested: false, since: { total: 0 }, counts: { total: 2 } });
    expect(after.evidence).toHaveLength(2);
    expect(after.evidence.some((e) => e.isNew)).toBe(false);
    expect(after.reviews[0]).toMatchObject({ note: "Looked at it; view unchanged.", statusAtReview: "ACTIVE" });
    expect(after.timeline.some((e) => e.kind === "THESIS_REVIEWED")).toBe(true);
  });
  it("evidence added after the review is new again and explained", async () => {
    const t = await mk();
    ok(await markReviewed(t, undefined, new Date(Date.now() - 10 * DAY)));
    ok(await addManualEvidence(t, manual({ stance: "CHALLENGES", relevance: "HIGH", title: "Big challenge" })));
    const r = (await getThesisResearch(t))!;
    expect(r.state.reviewSuggested).toBe(true);
    expect(r.state.reasons[0]).toMatchObject({ code: "HIGH_CHALLENGE", text: "High-relevance challenging evidence was added today." });
    expect(r.evidence[0]).toMatchObject({ isNew: true, isMostImportantNew: true });
  });
  it("review changes neither status, confidence nor content, and updatedAt is untouched", async () => {
    const t = await mk();
    const before = await db.thesis.findUniqueOrThrow({ where: { id: t } });
    ok(await markReviewed(t, "ok"));
    ok(await addManualEvidence(t, manual()));
    const after = await db.thesis.findUniqueOrThrow({ where: { id: t } });
    expect(after).toEqual(before);
  });
  it("only a live thesis can be reviewed; the note is bounded; history accumulates", async () => {
    expect(await markReviewed(await mk({}, false))).toMatchObject({ ok: false });
    expect(await markReviewed("nope")).toMatchObject({ ok: false });
    const t = await mk();
    expect(await markReviewed(t, "x".repeat(2001))).toMatchObject({ ok: false });
    ok(await markReviewed(t, "one", new Date(Date.now() - 2 * DAY)));
    ok(await markReviewed(t, "two", new Date(Date.now() - 1 * DAY)));
    expect((await getThesisResearch(t))!.reviews.map((r) => r.note)).toEqual(["two", "one"]);
    ok(await changeThesisStatus(t, "CHALLENGED"));
    ok(await markReviewed(t));
  });
  it("D. a thesis with nothing new is not surfaced; an occurred catalyst is", async () => {
    const t = await mk();
    ok(await markReviewed(t, undefined, new Date(Date.now() - DAY)));
    expect((await getThesisResearch(t))!.state.reviewSuggested).toBe(false);
    const k = ok(await addCatalyst(t, { description: "MPC", windowKind: "NONE" })).id;
    expect((await getThesisResearch(t))!.state.reviewSuggested).toBe(false);
    ok(await changeCatalystStatus(k, "OCCURRED"));
    expect((await getThesisResearch(t))!.state.reasons.map((r) => r.code)).toEqual(["CATALYST_OCCURRED"]);
  });
  it("evidence never changes status or confidence, even when it challenges at high relevance", async () => {
    const t = await mk();
    ok(await addManualEvidence(t, manual({ stance: "CHALLENGES", relevance: "HIGH" })));
    expect(await db.thesis.findUniqueOrThrow({ where: { id: t }, select: { status: true, confidence: true } })).toEqual({ status: "ACTIVE", confidence: "HIGH" });
  });
});

describe("REVIEWED ≠ RESOLVED (new-since-review vs persistent reasons)", () => {
  const codes = async (t: string) => (await getThesisResearch(t))!.state.reasons.map((r) => r.code);
  const same = async (t: string) => expect(await db.thesis.findUniqueOrThrow({ where: { id: t }, select: { status: true, confidence: true } })).toEqual({ status: "ACTIVE", confidence: "HIGH" });
  it("A–F: new evidence is acknowledged by review; a still-flagged condition is not; resetting the flag clears it", async () => {
    const t = await mk();
    const c = await conditionId(t, "INVALIDATION");
    ok(await markReviewed(t, undefined, new Date(Date.now() - 2 * DAY)));
    ok(await addManualEvidence(t, manual({ stance: "CHALLENGES", relevance: "HIGH" })));
    expect(await codes(t)).toEqual(["HIGH_CHALLENGE"]); // A
    ok(await markReviewed(t, undefined, new Date(Date.now() + 2_000)));
    expect(await codes(t)).toEqual([]); // B
    expect((await getThesisResearch(t))!.evidence).toHaveLength(1); // C
    ok(await setInvalidationFlag(c, "POTENTIALLY_TRIGGERED", "n", new Date(Date.now() + 3_000)));
    expect(await codes(t)).toEqual(["INVALIDATION_POTENTIAL"]); // D
    ok(await markReviewed(t, undefined, new Date(Date.now() + 4_000)));
    const r = (await getThesisResearch(t))!;
    expect(r.state.reasons).toMatchObject([{ code: "INVALIDATION_POTENTIAL", persistent: true }]); // E
    expect(r.state.since.total).toBe(0);
    ok(await setInvalidationFlag(c, "NOT_OBSERVED", "resolved", new Date(Date.now() + 5_000)));
    expect(await codes(t)).toEqual([]); // F
    await same(t);
  });
  it("G/H. new challenging evidence + a persistent flag: review clears only the new-evidence reason", async () => {
    const t = await mk();
    const c = await conditionId(t, "INVALIDATION");
    ok(await markReviewed(t, undefined, new Date(Date.now() - 2 * DAY)));
    ok(await setInvalidationFlag(c, "POTENTIALLY_TRIGGERED"));
    ok(await addManualEvidence(t, manual({ stance: "CHALLENGES", relevance: "HIGH" })));
    expect(await codes(t)).toEqual(["INVALIDATION_POTENTIAL", "HIGH_CHALLENGE"]); // G
    ok(await markReviewed(t, undefined, new Date(Date.now() + 2_000)));
    expect(await codes(t)).toEqual(["INVALIDATION_POTENTIAL"]); // H
    expect((await getThesisResearch(t))!.evidence).toHaveLength(1);
    await same(t);
  });
  it("a catalyst occurrence is acknowledged by review (it is news, not a standing state)", async () => {
    const t = await mk();
    const k = ok(await addCatalyst(t, { description: "MPC", windowKind: "NONE" })).id;
    ok(await changeCatalystStatus(k, "OCCURRED"));
    expect(await codes(t)).toEqual(["CATALYST_OCCURRED"]);
    ok(await markReviewed(t, undefined, new Date(Date.now() + 2_000)));
    expect(await codes(t)).toEqual([]);
  });
});

describe("library, presence and filters", () => {
  it("the library summary carries counts, new-since-review, review reasons and next catalyst; the 'needs review' filter uses them", async () => {
    const quiet = await mk({ title: `${TAG} quiet` });
    const noisy = await mk({ title: `${TAG} noisy` });
    ok(await markReviewed(quiet, undefined, new Date(Date.now() + 5_000)));
    ok(await addManualEvidence(noisy, manual({ stance: "CHALLENGES" })));
    const all = (await listTheses()).filter((x) => [quiet, noisy].includes(x.id));
    expect(all.find((x) => x.id === noisy)!.research).toMatchObject({ counts: { challenges: 1 }, newSinceReview: 1, reviewSuggested: true });
    expect(filterTheses(all, { needsReview: true }).map((x) => x.id)).toEqual([noisy]);
    expect(filterTheses(all, {}).length).toBe(2);
  });
  it("a security's thesis presence reflects the review suggestion and supporting/challenging counts", async () => {
    const t = await mk({}, true, { type: "SECURITY", id: equityId });
    ok(await addManualEvidence(t, manual({ stance: "CHALLENGES" })));
    const list = await listThesesForSubject({ type: "SECURITY", id: equityId });
    expect(list.find((x) => x.id === t)!.research.reviewSuggested).toBe(true);
    const presence = await getThesisPresenceForPositions([{ positionId: "p", holding: { assetClass: "EQUITY", securityId: equityId }, instrument: { kind: "EQUITY" } }]);
    expect(presence.get("p")!.reviewSuggested).toBe(true);
    expect(presence.get("p")!.lead!.research.counts.total).toBeGreaterThan(0);
  });
  it("a Treasury-bill thesis can link tenor rate evidence", async () => {
    const t = await mk({}, true, { type: "TREASURY_INSTRUMENT", id: billInstrumentId });
    ok(await linkKorblyEvidence(t, { refKind: "TREASURY_RATE", refId: real.bill, stance: "SUPPORTS", relevance: "MEDIUM" }));
  });
});
