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
import { checkBondAddable, checkEquityAddable, validatePositionDraft, type PortfolioAssetClass } from "./portfolio";

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
export async function addPosition(input: { portfolioId: string; assetClass: PortfolioAssetClass; instrumentId: string; nominalGhs?: number | null; shares?: number | null }): Promise<ServiceResult<{ positionId: string }>> {
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

/** Changes a position's size. The instrument itself can never change — remove and add instead. */
export async function updatePosition(input: { positionId: string; nominalGhs?: number | null; shares?: number | null }): Promise<ServiceResult> {
  const prisma = getPrisma();
  const position = await prisma.portfolioPosition.findUnique({
    where: { id: input.positionId },
    include: { portfolio: { select: { archivedAt: true } }, fixedIncomeSecurity: { select: { currency: true } }, security: { select: { currency: true } } },
  });
  if (!position) return fail("Position not found.");
  if (position.portfolio.archivedAt) return fail("This portfolio is archived — restore it before changing positions.");

  const currency = position.assetClass === "BOND" ? position.fixedIncomeSecurity!.currency : position.security!.currency;
  const size = validatePositionDraft({ assetClass: position.assetClass, nominalGhs: input.nominalGhs, shares: input.shares, currency });
  if (!size.ok) return fail(size.error);

  await prisma.$transaction([
    prisma.portfolioPosition.update({ where: { id: position.id }, data: size.assetClass === "BOND" ? { nominalGhs: size.nominalGhs } : { shares: size.shares } }),
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
