// ---------------------------------------------------------------------------
// Integration tests for the M9.0 batch add — real database. ZZBT-prefixed
// bonds/portfolios/bills only (equities are real and read-only), removed afterwards; real DataSource +
// IngestionRun are reused read-only for the bond table's provenance FKs.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { addPositionsBatch, createPortfolio, setPortfolioArchived } from "../portfolio-service";
import { getInstrumentContext, getPortfolio } from "../queries/portfolio";
import { toValuationDate } from "../fixed-income";

const db = getPrisma();
const TAG = "ZZBT";
const DAY = 86_400_000;
const today = toValuationDate(new Date());
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const plusDays = (n: number) => new Date(today.getTime() + n * DAY).toISOString().slice(0, 10);
const BILL_MATURITY = plusDays(301); // distinctive; a 364-day bill issued 63 days ago
const BILL_MATURITY_2 = plusDays(302);

let sourceId: string;
let runId: string;
let bondId: string;
let bond2Id: string;
let maturedBondId: string;
let equityId: string;
let equity2Id: string;
const portfolioIds: string[] = [];

async function newPortfolio() {
  const r = await createPortfolio({ name: `${TAG} ${Math.random().toString(36).slice(2, 8)}` });
  if (!r.ok) throw new Error(r.error);
  portfolioIds.push(r.id);
  return r.id;
}
const makeBond = async (code: string, over: Record<string, unknown> = {}) =>
  (await db.fixedIncomeSecurity.create({ data: { instrumentCode: `${TAG}${code}`, instrumentName: `${TAG} ${code}`, issuerName: `${TAG} Issuer`, instrumentType: "CORPORATE_BOND", classification: "CORPORATE", issueDate: d("2025-01-01"), maturityDate: d("2030-01-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", sourceId, ingestionRunId: runId, ...over } })).id;
const count = (portfolioId: string) => db.portfolioPosition.count({ where: { portfolioId } });

beforeAll(async () => {
  const run = await db.ingestionRun.findFirstOrThrow({ where: { dataSource: { name: { not: { startsWith: "ZZ" } } } }, select: { id: true, dataSourceId: true } });
  sourceId = run.dataSourceId;
  runId = run.id;
  bondId = await makeBond("B1");
  bond2Id = await makeBond("B2");
  maturedBondId = await makeBond("MAT", { issueDate: d("2020-01-01"), maturityDate: d("2025-01-01") });
  // REAL equities, read-only. Creating (then deleting) a security+company here would open a window in which other test files
  // — which load every security with its company — can see a security whose company has just been removed.
  const real = await db.security.findMany({ where: { active: true, currency: "GHS", NOT: { ticker: { startsWith: "ZZ" } } }, orderBy: { ticker: "asc" }, take: 2, select: { id: true } });
  if (real.length < 2) throw new Error("test needs two real active GHS equities");
  [equityId, equity2Id] = real.map((r) => r.id);
});

afterAll(async () => {
  await db.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
  await db.treasuryBill.deleteMany({ where: { OR: [{ maturityDate: d(BILL_MATURITY) }, { maturityDate: d(BILL_MATURITY_2) }], portfolioPositions: { none: {} }, scenarioShocks: { none: {} } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { startsWith: TAG } } });
});

describe("addPositionsBatch — successful batch", () => {
  it("adds a bond, an equity and a Treasury bill in one transaction, each in its own terms", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({
      portfolioId: pid,
      entries: [
        { key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1,500,000" },
        { key: "b", assetClass: "EQUITY", instrumentId: equityId, shares: "100,000" },
        { key: "c", assetClass: "TREASURY_BILL", tenorDays: 364, maturityDate: BILL_MATURITY, faceValueGhs: "1,000,000" },
      ],
    });
    expect(r).toMatchObject({ ok: true, positionCount: 3 });
    expect(await count(pid)).toBe(3);
    const rows = await db.portfolioPosition.findMany({ where: { portfolioId: pid }, orderBy: { assetClass: "asc" } });
    const bondRow = rows.find((x) => x.assetClass === "BOND")!;
    const eqRow = rows.find((x) => x.assetClass === "EQUITY")!;
    const billRow = rows.find((x) => x.assetClass === "TREASURY_BILL")!;
    expect(Number(bondRow.nominalGhs)).toBe(1_500_000);
    expect(bondRow.shares).toBeNull();
    expect(eqRow.shares).toBe(100_000);
    expect(eqRow.nominalGhs).toBeNull();
    expect(Number(billRow.nominalGhs)).toBe(1_000_000);
    expect(billRow.treasuryBillId).toBeTruthy();
    const p = await getPortfolio(pid, await getInstrumentContext());
    expect(p!.positions).toHaveLength(3);
  });

  it("reuses an existing bill record instead of duplicating it", async () => {
    const pid = await newPortfolio();
    const before = await db.treasuryBill.count({ where: { maturityDate: d(BILL_MATURITY) } });
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "c", assetClass: "TREASURY_BILL", tenorDays: 364, maturityDate: BILL_MATURITY, faceValueGhs: "500,000" }] });
    expect(r.ok).toBe(true);
    expect(await db.treasuryBill.count({ where: { maturityDate: d(BILL_MATURITY) } })).toBe(before);
  });
});

describe("addPositionsBatch — failure behaviour is all-or-nothing", () => {
  it("one invalid row → nothing is saved and the bad row is named", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({
      portfolioId: pid,
      entries: [
        { key: "good", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000" },
        { key: "bad", assetClass: "EQUITY", instrumentId: equityId, shares: "0" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors.map((e) => e.key)).toEqual(["bad"]);
    expect(await count(pid)).toBe(0);
  });

  it("a matured bond is refused with its reason, and the valid rows are not saved", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "ok", assetClass: "EQUITY", instrumentId: equity2Id, shares: "10" }, { key: "mat", assetClass: "BOND", instrumentId: maturedBondId, nominalGhs: "1000" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors).toEqual([{ key: "mat", error: "This bond has matured and can no longer be held." }]);
    expect(await count(pid)).toBe(0);
  });

  it("an instrument already in the portfolio is refused, nothing is added", async () => {
    const pid = await newPortfolio();
    expect((await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000" }] })).ok).toBe(true);
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a2", assetClass: "BOND", instrumentId: bondId, nominalGhs: "2000" }, { key: "b", assetClass: "BOND", instrumentId: bond2Id, nominalGhs: "2000" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors[0]).toMatchObject({ key: "a2", error: expect.stringMatching(/already in this portfolio/i) });
    expect(await count(pid)).toBe(1);
  });

  it("a duplicate within the basket is refused", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1" }, { key: "a2", assetClass: "BOND", instrumentId: bondId, nominalGhs: "2" }] });
    expect(r.ok).toBe(false);
    expect(await count(pid)).toBe(0);
  });

  it("an unknown instrument id is refused, never silently skipped", async () => {
    const pid = await newPortfolio();
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "x", assetClass: "BOND", instrumentId: "nope", nominalGhs: "1000" }] });
    expect(r).toMatchObject({ ok: false });
    expect(await count(pid)).toBe(0);
  });

  it("a failure inside the transaction rolls back rows already written (ISIN conflict on the bill)", async () => {
    const pid = await newPortfolio();
    expect((await addPositionsBatch({ portfolioId: await newPortfolio(), entries: [{ key: "s", assetClass: "TREASURY_BILL", tenorDays: 364, maturityDate: BILL_MATURITY_2, faceValueGhs: "1000", isin: `${TAG}000000A1` }] })).ok).toBe(true);
    const r = await addPositionsBatch({
      portfolioId: pid,
      entries: [
        { key: "first", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000" },
        { key: "bill", assetClass: "TREASURY_BILL", tenorDays: 364, maturityDate: BILL_MATURITY_2, faceValueGhs: "1000", isin: `${TAG}000000B2` },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors[0]).toMatchObject({ key: "bill", error: expect.stringMatching(/already recorded with ISIN/) });
    expect(await count(pid)).toBe(0); // the bond written before the failure was rolled back
  });

  it("an archived portfolio refuses the batch", async () => {
    const pid = await newPortfolio();
    await setPortfolioArchived(pid, true);
    const r = await addPositionsBatch({ portfolioId: pid, entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000" }] });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/archived/) });
  });

  it("a missing portfolio and an empty basket are refused", async () => {
    expect(await addPositionsBatch({ portfolioId: "nope", entries: [{ key: "a", assetClass: "BOND", instrumentId: bondId, nominalGhs: "1000" }] })).toMatchObject({ ok: false });
    expect(await addPositionsBatch({ portfolioId: await newPortfolio(), entries: [] })).toMatchObject({ ok: false });
  });
});
