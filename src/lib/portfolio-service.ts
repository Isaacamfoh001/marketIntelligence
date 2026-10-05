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
import { checkBillAddable, checkBondAddable, checkEquityAddable, validatePositionDraft, type PortfolioAssetClass } from "./portfolio";
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
