// ---------------------------------------------------------------------------
// Portfolio mutations (M8.1). Every write re-validates on the server against
// the real instrument rows — the client's choices are never trusted — and goes
// through the pure domain rules (positions.ts / eligibility.ts); the database
// CHECK + unique constraints are the backstop.
//
// SECURITY NOTE (M8 internal MVP): there is NO authentication — a single
// shared workspace by explicit decision. These mutations are unsuitable for a
// publicly exposed deployment until authentication/authorisation is added.
// ---------------------------------------------------------------------------

import { getPrisma } from "./prisma";
import { classifyLifecycle, toValuationDate } from "./fixed-income";
import { getInstrumentContext, evaluateAssumption, type AssumptionEvaluation, type AssumptionTarget } from "./queries/portfolio";
import { validateAssumption, type AssumptionKind } from "./portfolio";
import { batchIdentity, checkBillAddable, checkBondAddable, checkEquityAddable, validateBatchEntries, validatePositionDraft, type BatchEntryInput, type BatchRowError, type ParsedBatchEntry, type PortfolioAssetClass } from "./portfolio";
import { checkBillIssued, parseIsoDate, validateBillTerms } from "./treasury-bills";

export type ServiceResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; /** Set when the instrument is already held — the caller should send the analyst to edit it. */ existingPositionId?: string };

const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;

const fail = (error: string, existingPositionId?: string): { ok: false; error: string; existingPositionId?: string } => ({ ok: false, error, existingPositionId });

export async function createPortfolio(input: { name: string; description?: string | null }): Promise<ServiceResult<{ id: string }>> {
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (name === "") return fail("Give the portfolio a name.");
  if (name.length > NAME_MAX) return fail(`The name can be at most ${NAME_MAX} characters.`);
  if (description.length > DESCRIPTION_MAX) return fail(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  const created = await getPrisma().portfolio.create({ data: { name, description: description === "" ? null : description } });
  return { ok: true, id: created.id };
}

export async function setPortfolioArchived(portfolioId: string, archived: boolean): Promise<ServiceResult> {
  const prisma = getPrisma();
  const existing = await prisma.portfolio.findUnique({ where: { id: portfolioId }, select: { id: true } });
  if (!existing) return fail("Portfolio not found.");
  await prisma.portfolio.update({ where: { id: portfolioId }, data: { archivedAt: archived ? new Date() : null } });
  return { ok: true };
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Adds a holding. Fails (never duplicates) when the instrument is already in the portfolio, returning the existing position's id. */
export async function addPosition(input: { portfolioId: string; assetClass: Exclude<PortfolioAssetClass, "TREASURY_BILL">; instrumentId: string; nominalGhs?: number | null; shares?: number | null }): Promise<ServiceResult<{ positionId: string }>> {
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findUnique({ where: { id: input.portfolioId }, select: { id: true, archivedAt: true } });
  if (!portfolio) return fail("Portfolio not found.");
  if (portfolio.archivedAt) return fail("This portfolio is archived — restore it before changing positions.");

  let currency: string;
  if (input.assetClass === "BOND") {
    const bond = await prisma.fixedIncomeSecurity.findUnique({ where: { id: input.instrumentId } });
    if (!bond) return fail("Bond not found.");
    const lifecycle = classifyLifecycle(bond.maturityDate, toValuationDate(new Date()));
    const addable = checkBondAddable({ currency: bond.currency, lifecycle, couponType: bond.couponType });
    if (!addable.addable) return fail(addable.reason);
    currency = bond.currency;
  } else {
    const security = await prisma.security.findUnique({ where: { id: input.instrumentId } });
    if (!security) return fail("Security not found.");
    const addable = checkEquityAddable({ currency: security.currency, active: security.active });
    if (!addable.addable) return fail(addable.reason);
    currency = security.currency;
  }

  const size = validatePositionDraft({ assetClass: input.assetClass, nominalGhs: input.nominalGhs, shares: input.shares, currency });
  if (!size.ok) return fail(size.error);
  if (size.assetClass === "TREASURY_BILL") return fail("Treasury bills are added with addTreasuryBillPosition.");

  const existing = await prisma.portfolioPosition.findFirst({
    where: input.assetClass === "BOND" ? { portfolioId: input.portfolioId, fixedIncomeSecurityId: input.instrumentId } : { portfolioId: input.portfolioId, securityId: input.instrumentId },
    select: { id: true },
  });
  if (existing) return fail("This instrument is already in the portfolio — edit the existing position instead.", existing.id);

  try {
    const [created] = await prisma.$transaction([
      prisma.portfolioPosition.create({
        data:
          size.assetClass === "BOND"
            ? { portfolioId: input.portfolioId, assetClass: "BOND", fixedIncomeSecurityId: input.instrumentId, nominalGhs: size.nominalGhs }
            : { portfolioId: input.portfolioId, assetClass: "EQUITY", securityId: input.instrumentId, shares: size.shares },
        select: { id: true },
      }),
      prisma.portfolio.update({ where: { id: input.portfolioId }, data: { updatedAt: new Date() } }),
    ]);
    return { ok: true, positionId: created.id };
  } catch (e) {
    // Lost a race with a concurrent add of the same instrument.
    if (isUniqueViolation(e)) return fail("This instrument is already in the portfolio — edit the existing position instead.");
    throw e;
  }
}

/**
 * Adds a Treasury-bill holding (M8.5). The analyst states the bill's original tenor, its maturity date and
 * the FACE (maturity) amount held; the bill instrument is found or created from (tenor, maturity). Nothing about
 * purchase cost or date is recorded — none is needed for a reference value, and Korbly has no transaction system.
 */
export async function addTreasuryBillPosition(input: { portfolioId: string; tenorDays: number; maturityDate: string; faceValueGhs: number; isin?: string | null }): Promise<ServiceResult<{ positionId: string; billId: string }>> {
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findUnique({ where: { id: input.portfolioId }, select: { id: true, archivedAt: true } });
  if (!portfolio) return fail("Portfolio not found.");
  if (portfolio.archivedAt) return fail("This portfolio is archived — restore it before changing positions.");

  const maturity = parseIsoDate(input.maturityDate);
  if (!maturity) return fail("Enter the maturity date as a valid date.");
  const isin = (input.isin ?? "").trim().toUpperCase() || null;
  const checked = validateBillTerms({ tenorDays: input.tenorDays, maturityDate: maturity, currency: "GHS", isin });
  if (!checked.ok) return fail(checked.error);
  const today = toValuationDate(new Date());
  const issued = checkBillIssued(checked.terms, today);
  if (!issued.ok) return fail(issued.error);
  const addable = checkBillAddable({ currency: "GHS", maturityDate: maturity }, today);
  if (!addable.addable) return fail(addable.reason);
  const size = validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: input.faceValueGhs, currency: "GHS" });
  if (!size.ok || size.assetClass !== "TREASURY_BILL") return fail(size.ok ? "Invalid face value." : size.error);

  const instrument = await prisma.treasuryInstrument.findFirst({ where: { tenorDays: input.tenorDays, instrumentType: "BILL", active: true }, select: { id: true } });
  if (!instrument) return fail(`No ${input.tenorDays}-day Treasury bill instrument is configured.`);

  let bill = await prisma.treasuryBill.findUnique({ where: { instrumentId_maturityDate: { instrumentId: instrument.id, maturityDate: maturity } } });
  if (bill && isin && bill.isin && bill.isin !== isin) return fail(`This bill is already recorded with ISIN ${bill.isin}.`);
  try {
    if (!bill) bill = await prisma.treasuryBill.create({ data: { instrumentId: instrument.id, issueDate: checked.terms.issueDate, maturityDate: maturity, isin } });
    else if (isin && !bill.isin) bill = await prisma.treasuryBill.update({ where: { id: bill.id }, data: { isin } });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That bill (or ISIN) is already recorded — check the ISIN.");
    throw e;
  }

  const existing = await prisma.portfolioPosition.findFirst({ where: { portfolioId: input.portfolioId, treasuryBillId: bill.id }, select: { id: true } });
  if (existing) return fail("This Treasury bill is already in the portfolio — edit the existing position instead.", existing.id);
  try {
    const [created] = await prisma.$transaction([
      prisma.portfolioPosition.create({ data: { portfolioId: input.portfolioId, assetClass: "TREASURY_BILL", treasuryBillId: bill.id, nominalGhs: size.faceValueGhs }, select: { id: true } }),
      prisma.portfolio.update({ where: { id: input.portfolioId }, data: { updatedAt: new Date() } }),
    ]);
    return { ok: true, positionId: created.id, billId: bill.id };
  } catch (e) {
    if (isUniqueViolation(e)) return fail("This Treasury bill is already in the portfolio — edit the existing position instead.");
    throw e;
  }
}

/** Changes a position's size. The instrument itself can never change — remove and add instead. */
export async function updatePosition(input: { positionId: string; nominalGhs?: number | null; shares?: number | null }): Promise<ServiceResult> {
  const prisma = getPrisma();
  const position = await prisma.portfolioPosition.findUnique({
    where: { id: input.positionId },
    include: { portfolio: { select: { archivedAt: true } }, fixedIncomeSecurity: { select: { currency: true } }, security: { select: { currency: true } }, treasuryBill: { select: { currency: true } } },
  });
  if (!position) return fail("Position not found.");
  if (position.portfolio.archivedAt) return fail("This portfolio is archived — restore it before changing positions.");

  const currency = position.assetClass === "BOND" ? position.fixedIncomeSecurity!.currency : position.assetClass === "TREASURY_BILL" ? position.treasuryBill!.currency : position.security!.currency;
  const size = validatePositionDraft({ assetClass: position.assetClass, nominalGhs: input.nominalGhs, shares: input.shares, currency });
  if (!size.ok) return fail(size.error);

  await prisma.$transaction([
    prisma.portfolioPosition.update({ where: { id: position.id }, data: size.assetClass === "BOND" ? { nominalGhs: size.nominalGhs } : size.assetClass === "TREASURY_BILL" ? { nominalGhs: size.faceValueGhs } : { shares: size.shares } }),
    prisma.portfolio.update({ where: { id: position.portfolioId }, data: { updatedAt: new Date() } }),
  ]);
  return { ok: true };
}

export async function removePosition(positionId: string): Promise<ServiceResult> {
  const prisma = getPrisma();
  const position = await prisma.portfolioPosition.findUnique({ where: { id: positionId }, include: { portfolio: { select: { archivedAt: true } } } });
  if (!position) return fail("Position not found.");
  if (position.portfolio.archivedAt) return fail("This portfolio is archived — restore it before changing positions.");
  await prisma.$transaction([prisma.portfolioPosition.delete({ where: { id: positionId } }), prisma.portfolio.update({ where: { id: position.portfolioId }, data: { updatedAt: new Date() } })]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Batch add (M9.0) — several instruments, ALL-OR-NOTHING. Every row is checked
// against the real instrument rows first (the same rules as addPosition /
// addTreasuryBillPosition); if any row fails, nothing is written and every
// failure is returned by row key. The writes then happen in ONE transaction.
// ---------------------------------------------------------------------------

export type BatchResult = { ok: true; positionIds: string[]; positionCount: number } | { ok: false; error: string; rowErrors: BatchRowError[] };

export async function addPositionsBatch(input: { portfolioId: string; entries: BatchEntryInput[] }): Promise<BatchResult> {
  const prisma = getPrisma();
  const failAll = (rowErrors: BatchRowError[], error = "Nothing was added. Fix the highlighted rows and try again."): BatchResult => ({ ok: false, error, rowErrors });

  const portfolio = await prisma.portfolio.findUnique({ where: { id: input.portfolioId }, select: { id: true, archivedAt: true } });
  if (!portfolio) return failAll([], "Portfolio not found.");
  if (portfolio.archivedAt) return failAll([], "This portfolio is archived — restore it before changing positions.");

  const checked = validateBatchEntries(input.entries);
  if (!checked.ok) return failAll(checked.errors);

  const today = toValuationDate(new Date());
  const errors: BatchRowError[] = [];
  const existing = await prisma.portfolioPosition.findMany({ where: { portfolioId: input.portfolioId }, select: { fixedIncomeSecurityId: true, securityId: true, treasuryBill: { select: { instrument: { select: { tenorDays: true } }, maturityDate: true } } } });
  const held = new Set<string>();
  for (const p of existing) {
    if (p.fixedIncomeSecurityId) held.add(`BOND:${p.fixedIncomeSecurityId}`);
    if (p.securityId) held.add(`EQUITY:${p.securityId}`);
    if (p.treasuryBill) held.add(`BILL:${p.treasuryBill.instrument.tenorDays}:${p.treasuryBill.maturityDate.toISOString().slice(0, 10)}`);
  }

  const bondIds = checked.entries.flatMap((e) => (e.assetClass === "BOND" ? [e.instrumentId] : []));
  const equityIds = checked.entries.flatMap((e) => (e.assetClass === "EQUITY" ? [e.instrumentId] : []));
  const [bonds, equities, instruments] = await Promise.all([
    prisma.fixedIncomeSecurity.findMany({ where: { id: { in: bondIds } } }),
    prisma.security.findMany({ where: { id: { in: equityIds } } }),
    prisma.treasuryInstrument.findMany({ where: { instrumentType: "BILL", active: true }, select: { id: true, tenorDays: true } }),
  ]);
  const bondById = new Map(bonds.map((b) => [b.id, b]));
  const equityById = new Map(equities.map((s) => [s.id, s]));
  const instrumentByTenor = new Map(instruments.map((i) => [i.tenorDays, i.id]));

  type Plan = { entry: ParsedBatchEntry; terms?: { issueDate: Date; maturity: Date; tenorDays: number; isin: string | null; instrumentId: string } };
  const plans: Plan[] = [];
  for (const e of checked.entries) {
    if (held.has(batchIdentity(e))) {
      errors.push({ key: e.key, error: "Already in this portfolio — edit the existing position instead." });
      continue;
    }
    if (e.assetClass === "BOND") {
      const bond = bondById.get(e.instrumentId);
      if (!bond) { errors.push({ key: e.key, error: "Bond not found." }); continue; }
      const addable = checkBondAddable({ currency: bond.currency, lifecycle: classifyLifecycle(bond.maturityDate, today), couponType: bond.couponType });
      if (!addable.addable) { errors.push({ key: e.key, error: addable.reason }); continue; }
      plans.push({ entry: e });
    } else if (e.assetClass === "EQUITY") {
      const sec = equityById.get(e.instrumentId);
      if (!sec) { errors.push({ key: e.key, error: "Security not found." }); continue; }
      const addable = checkEquityAddable({ currency: sec.currency, active: sec.active });
      if (!addable.addable) { errors.push({ key: e.key, error: addable.reason }); continue; }
      plans.push({ entry: e });
    } else {
      const maturity = parseIsoDate(e.maturityDate);
      if (!maturity) { errors.push({ key: e.key, error: "Enter the maturity date as a valid date." }); continue; }
      const terms = validateBillTerms({ tenorDays: e.tenorDays, maturityDate: maturity, currency: "GHS", isin: e.isin });
      if (!terms.ok) { errors.push({ key: e.key, error: terms.error }); continue; }
      const issued = checkBillIssued(terms.terms, today);
      if (!issued.ok) { errors.push({ key: e.key, error: issued.error }); continue; }
      const addable = checkBillAddable({ currency: "GHS", maturityDate: maturity }, today);
      if (!addable.addable) { errors.push({ key: e.key, error: addable.reason }); continue; }
      const instrumentId = instrumentByTenor.get(e.tenorDays);
      if (!instrumentId) { errors.push({ key: e.key, error: `No ${e.tenorDays}-day Treasury bill instrument is configured.` }); continue; }
      plans.push({ entry: e, terms: { issueDate: terms.terms.issueDate, maturity, tenorDays: e.tenorDays, isin: e.isin, instrumentId } });
    }
  }
  if (errors.length > 0) return failAll(errors);

  // Starting valuation assumptions (M9.0.1): each is evaluated against the real instrument and Korbly's own valuation BEFORE
  // anything is written, so an impossible assumption fails the whole batch (all-or-nothing) with the row it belongs to.
  const stored = new Map<string, { kind: AssumptionKind; value: number | null; overridesReference: boolean }>();
  if (plans.some((p) => p.entry.assumption)) {
    const ctx = await getInstrumentContext(today);
    for (const { entry } of plans) {
      if (!entry.assumption) continue;
      const target: AssumptionTarget = entry.assetClass === "BOND" ? { assetClass: "BOND", instrumentId: entry.instrumentId, nominalGhs: entry.nominalGhs } : entry.assetClass === "EQUITY" ? { assetClass: "EQUITY", instrumentId: entry.instrumentId, shares: entry.shares } : { assetClass: "TREASURY_BILL", tenorDays: entry.tenorDays, maturityDate: entry.maturityDate, faceValueGhs: entry.faceValueGhs };
      const evaluated = evaluateAssumption(ctx, target, entry.assumption);
      if (!evaluated.ok) errors.push({ key: entry.key, error: evaluated.error });
      else stored.set(entry.key, { kind: entry.assumption.kind, value: entry.assumption.value, overridesReference: evaluated.overridesReference });
    }
    if (errors.length > 0) return failAll(errors);
  }

  try {
    const positionIds = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const { entry, terms } of plans) {
        if (entry.assetClass === "BOND") {
          ids.push((await tx.portfolioPosition.create({ data: { portfolioId: input.portfolioId, assetClass: "BOND", fixedIncomeSecurityId: entry.instrumentId, nominalGhs: entry.nominalGhs, ...assumptionData(stored.get(entry.key)) }, select: { id: true } })).id);
        } else if (entry.assetClass === "EQUITY") {
          ids.push((await tx.portfolioPosition.create({ data: { portfolioId: input.portfolioId, assetClass: "EQUITY", securityId: entry.instrumentId, shares: entry.shares, ...assumptionData(stored.get(entry.key)) }, select: { id: true } })).id);
        } else if (terms) {
          let bill = await tx.treasuryBill.findUnique({ where: { instrumentId_maturityDate: { instrumentId: terms.instrumentId, maturityDate: terms.maturity } } });
          if (bill && terms.isin && bill.isin && bill.isin !== terms.isin) throw new BatchRowFailure(entry.key, `This bill is already recorded with ISIN ${bill.isin}.`);
          if (!bill) bill = await tx.treasuryBill.create({ data: { instrumentId: terms.instrumentId, issueDate: terms.issueDate, maturityDate: terms.maturity, isin: terms.isin } });
          else if (terms.isin && !bill.isin) bill = await tx.treasuryBill.update({ where: { id: bill.id }, data: { isin: terms.isin } });
          ids.push((await tx.portfolioPosition.create({ data: { portfolioId: input.portfolioId, assetClass: "TREASURY_BILL", treasuryBillId: bill.id, nominalGhs: entry.faceValueGhs, ...assumptionData(stored.get(entry.key)) }, select: { id: true } })).id);
        }
      }
      await tx.portfolio.update({ where: { id: input.portfolioId }, data: { updatedAt: new Date() } });
      return ids;
    });
    return { ok: true, positionIds, positionCount: positionIds.length };
  } catch (e) {
    if (e instanceof BatchRowFailure) return failAll([{ key: e.key, error: e.message }]);
    if (isUniqueViolation(e)) return failAll([], "One of these instruments was added by someone else at the same time. Nothing was added — reload and try again.");
    throw e;
  }
}

/** Nested-create payload for a position's assumption (one transaction with the position itself). */
const assumptionData = (a: { kind: AssumptionKind; value: number | null; overridesReference: boolean } | undefined) => (a ? { assumption: { create: { kind: a.kind, value: a.value, overridesReference: a.overridesReference } } } : {});

class BatchRowFailure extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Valuation assumptions on an existing position (M9.0.1). The assumption is the
// analyst's INPUT only (kind + value); the resulting value is recomputed at read
// time. Setting it never touches market data or Korbly's valuation. Every write
// is checked against the real instrument and Korbly's own valuation first.
// ---------------------------------------------------------------------------

async function loadPositionTarget(positionId: string): Promise<{ ok: true; portfolioId: string; archived: boolean; target: AssumptionTarget } | { ok: false; error: string }> {
  const position = await getPrisma().portfolioPosition.findUnique({
    where: { id: positionId },
    include: { portfolio: { select: { archivedAt: true } }, treasuryBill: { select: { maturityDate: true, instrument: { select: { tenorDays: true } } } } },
  });
  if (!position) return { ok: false, error: "Position not found." };
  const base = { ok: true as const, portfolioId: position.portfolioId, archived: position.portfolio.archivedAt !== null };
  if (position.assetClass === "BOND" && position.fixedIncomeSecurityId) return { ...base, target: { assetClass: "BOND", instrumentId: position.fixedIncomeSecurityId, nominalGhs: Number(position.nominalGhs) } };
  if (position.assetClass === "EQUITY" && position.securityId) return { ...base, target: { assetClass: "EQUITY", instrumentId: position.securityId, shares: position.shares as number } };
  if (position.assetClass === "TREASURY_BILL" && position.treasuryBill) return { ...base, target: { assetClass: "TREASURY_BILL", tenorDays: position.treasuryBill.instrument.tenorDays, maturityDate: position.treasuryBill.maturityDate.toISOString().slice(0, 10), faceValueGhs: Number(position.nominalGhs) } };
  return { ok: false, error: "This position is malformed." };
}

/** Shows what an assumption would give, without saving anything — the SAME evaluation the save uses. */
export async function previewPositionAssumption(input: { positionId: string; kind: AssumptionKind; value: number | null }): Promise<ServiceResult<{ evaluation: Extract<AssumptionEvaluation, { ok: true }> }>> {
  const loaded = await loadPositionTarget(input.positionId);
  if (!loaded.ok) return fail(loaded.error);
  const evaluated = evaluateAssumption(await getInstrumentContext(), loaded.target, { kind: input.kind, value: input.value });
  if (!evaluated.ok) return fail(evaluated.error);
  return { ok: true, evaluation: evaluated };
}

/** Creates or replaces (edit) the position's assumption. One assumption per position; the instrument and its size are untouched. */
export async function setPositionAssumption(input: { positionId: string; kind: AssumptionKind; value: number | null }): Promise<ServiceResult<{ overridesReference: boolean }>> {
  const loaded = await loadPositionTarget(input.positionId);
  if (!loaded.ok) return fail(loaded.error);
  if (loaded.archived) return fail("This portfolio is archived — restore it before changing positions.");
  const checked = validateAssumption(loaded.target.assetClass, input.kind, input.value);
  if (!checked.ok) return fail(checked.error);
  const evaluated = evaluateAssumption(await getInstrumentContext(), loaded.target, checked.assumption);
  if (!evaluated.ok) return fail(evaluated.error);
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.positionAssumption.upsert({
      where: { positionId: input.positionId },
      create: { positionId: input.positionId, kind: checked.assumption.kind, value: checked.assumption.value, overridesReference: evaluated.overridesReference },
      update: { kind: checked.assumption.kind, value: checked.assumption.value, overridesReference: evaluated.overridesReference },
    }),
    prisma.portfolio.update({ where: { id: loaded.portfolioId }, data: { updatedAt: new Date() } }),
  ]);
  return { ok: true, overridesReference: evaluated.overridesReference };
}

/** Removes the assumption: the position returns to Korbly's own valuation, or to unvalued if Korbly has none. */
export async function removePositionAssumption(positionId: string): Promise<ServiceResult> {
  const loaded = await loadPositionTarget(positionId);
  if (!loaded.ok) return fail(loaded.error);
  if (loaded.archived) return fail("This portfolio is archived — restore it before changing positions.");
  const prisma = getPrisma();
  await prisma.$transaction([prisma.positionAssumption.deleteMany({ where: { positionId } }), prisma.portfolio.update({ where: { id: loaded.portfolioId }, data: { updatedAt: new Date() } })]);
  return { ok: true };
}
