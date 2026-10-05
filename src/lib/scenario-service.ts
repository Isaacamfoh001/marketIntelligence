// ---------------------------------------------------------------------------
// Scenario definition mutations (M8.3). Persists ASSUMPTIONS only — never a
// calculated result. Every write re-validates on the server against the real
// instrument/company rows and the pure domain rules (bounds, compatibility,
// duplicates); the database CHECK + unique constraints are the backstop.
//
// SECURITY NOTE (M8 internal MVP): no authentication — see portfolio-service.ts.
// ---------------------------------------------------------------------------

import { getPrisma } from "./prisma";
import {
  issuerNameKeyOf,
  rowToRule,
  selectorToColumns,
  shockTypeForAssetClass,
  validateRules,
  validateShockValue,
  checkCompatibility,
  type ScenarioShockRule,
  type ShockSelector,
  type ShockType,
  type StoredShockRow,
} from "./scenarios";
import type { ServiceResult } from "./portfolio-service";
import { getTemplate, TEMPLATE_DISCLAIMER } from "./scenario-studio/templates";
import type { ExposureAssetClass } from "./portfolio";

const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

export async function createScenario(input: { portfolioId: string; name: string; description?: string | null }): Promise<ServiceResult<{ id: string }>> {
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (name === "") return fail("Give the scenario a name.");
  if (name.length > NAME_MAX) return fail(`The name can be at most ${NAME_MAX} characters.`);
  if (description.length > DESCRIPTION_MAX) return fail(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findUnique({ where: { id: input.portfolioId }, select: { archivedAt: true } });
  if (!portfolio) return fail("Portfolio not found.");
  if (portfolio.archivedAt) return fail("This portfolio is archived — restore it before adding scenarios.");
  const created = await prisma.scenario.create({ data: { portfolioId: input.portfolioId, name, description: description === "" ? null : description } });
  return { ok: true, id: created.id };
}

/** Loads a scenario that may be edited: it must exist and neither it nor its portfolio may be archived. */
async function editableScenario(scenarioId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const s = await getPrisma().scenario.findUnique({ where: { id: scenarioId }, select: { id: true, archivedAt: true, portfolio: { select: { archivedAt: true } } } });
  if (!s) return fail("Scenario not found.");
  if (s.archivedAt) return fail("This scenario is archived — restore it before changing it.");
  if (s.portfolio.archivedAt) return fail("This portfolio is archived — restore it before changing its scenarios.");
  return { ok: true, id: s.id };
}

export async function updateScenario(input: { scenarioId: string; name: string; description?: string | null }): Promise<ServiceResult> {
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (name === "") return fail("Give the scenario a name.");
  if (name.length > NAME_MAX) return fail(`The name can be at most ${NAME_MAX} characters.`);
  if (description.length > DESCRIPTION_MAX) return fail(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  const e = await editableScenario(input.scenarioId);
  if (!e.ok) return e;
  await getPrisma().scenario.update({ where: { id: input.scenarioId }, data: { name, description: description === "" ? null : description } });
  return { ok: true };
}

export async function setScenarioArchived(scenarioId: string, archived: boolean): Promise<ServiceResult> {
  const prisma = getPrisma();
  const existing = await prisma.scenario.findUnique({ where: { id: scenarioId }, select: { id: true } });
  if (!existing) return fail("Scenario not found.");
  await prisma.scenario.update({ where: { id: scenarioId }, data: { archivedAt: archived ? new Date() : null } });
  return { ok: true };
}

export type ShockTarget = { kind: "ASSET_CLASS"; assetClass: "GOVERNMENT_BOND" | "CORPORATE_BOND" | "EQUITY" } | { kind: "ISSUER"; issuerKey: string; shockType: ShockType } | { kind: "SECURITY"; instrument: "BOND" | "EQUITY"; instrumentId: string };

const asSelector = (t: ShockTarget): ShockSelector => (t.kind === "ASSET_CLASS" ? { kind: "ASSET_CLASS", assetClass: t.assetClass } : t.kind === "ISSUER" ? { kind: "ISSUER", issuerKey: t.issuerKey } : { kind: "SECURITY", instrument: t.instrument, instrumentId: t.instrumentId });
const typeOf = (t: ShockTarget): ShockType => (t.kind === "ASSET_CLASS" ? shockTypeForAssetClass(t.assetClass) : t.kind === "SECURITY" ? (t.instrument === "BOND" ? "YIELD_BPS" : "PRICE_PCT") : t.shockType);

/** The target must refer to something that really exists — no shock may silently reference a security/issuer that never did. */
async function checkTargetExists(t: ShockTarget, type: ShockType): Promise<string | null> {
  const prisma = getPrisma();
  if (t.kind === "SECURITY") {
    if (t.instrument === "BOND") return (await prisma.fixedIncomeSecurity.findUnique({ where: { id: t.instrumentId }, select: { id: true } })) ? null : "That bond does not exist.";
    return (await prisma.security.findUnique({ where: { id: t.instrumentId }, select: { id: true } })) ? null : "That security does not exist.";
  }
  if (t.kind === "ISSUER") {
    if (t.issuerKey.startsWith("company:")) return (await prisma.company.findUnique({ where: { id: t.issuerKey.slice(8) }, select: { id: true } })) ? null : "That issuer does not exist.";
    if (!t.issuerKey.startsWith("name:")) return "Unrecognised issuer.";
    if (type === "PRICE_PCT") return "An equity price shock needs an issuer with a listed company — this issuer has none.";
    const key = t.issuerKey.slice(5);
    const names = await prisma.fixedIncomeSecurity.findMany({ where: { companyId: null }, distinct: ["issuerName"], select: { issuerName: true } });
    return names.some((n) => issuerNameKeyOf(n.issuerName) === key) ? null : "That issuer does not exist.";
  }
  return null;
}

const toStored = (r: { id: string; targetKind: StoredShockRow["targetKind"]; shockType: ShockType; value: unknown; assetClass: StoredShockRow["assetClass"]; companyId: string | null; issuerNameKey: string | null; fixedIncomeSecurityId: string | null; securityId: string | null }): StoredShockRow => ({ ...r, value: Number(r.value) });

export async function addShock(input: { scenarioId: string; target: ShockTarget; value: number }): Promise<ServiceResult<{ shockId: string }>> {
  const e = await editableScenario(input.scenarioId);
  if (!e.ok) return e;
  const type = typeOf(input.target);
  const selector = asSelector(input.target);
  const compat = checkCompatibility(selector, type);
  if (!compat.ok) return fail(compat.message);
  const v = validateShockValue(type, input.value);
  if (!v.ok) return fail(v.message);
  const missing = await checkTargetExists(input.target, type);
  if (missing) return fail(missing);

  const prisma = getPrisma();
  const existing = (await prisma.scenarioShock.findMany({ where: { scenarioId: input.scenarioId } })).map(toStored);
  const rules = existing.map((r) => rowToRule(r, "existing")).filter((r): r is ScenarioShockRule => r !== null);
  const candidate: ScenarioShockRule = { id: "new", selector, shockType: type, value: input.value, targetLabel: "This target" };
  if (validateRules([...rules, candidate]).some((x) => x.ruleId === "new" && x.code === "DUPLICATE")) return fail("This scenario already has an assumption for that target — edit it instead.");

  try {
    const created = await prisma.scenarioShock.create({ data: { scenarioId: input.scenarioId, shockType: type, value: input.value, ...selectorToColumns(selector) } });
    return { ok: true, shockId: created.id };
  } catch (err) {
    if (isUniqueViolation(err)) return fail("This scenario already has an assumption for that target — edit it instead.");
    throw err;
  }
}

export async function updateShock(input: { shockId: string; value: number }): Promise<ServiceResult> {
  const prisma = getPrisma();
  const shock = await prisma.scenarioShock.findUnique({ where: { id: input.shockId }, select: { scenarioId: true, shockType: true } });
  if (!shock) return fail("Assumption not found.");
  const e = await editableScenario(shock.scenarioId);
  if (!e.ok) return e;
  const v = validateShockValue(shock.shockType, input.value);
  if (!v.ok) return fail(v.message);
  await prisma.scenarioShock.update({ where: { id: input.shockId }, data: { value: input.value } });
  return { ok: true };
}

export async function removeShock(shockId: string): Promise<ServiceResult> {
  const prisma = getPrisma();
  const shock = await prisma.scenarioShock.findUnique({ where: { id: shockId }, select: { scenarioId: true } });
  if (!shock) return fail("Assumption not found.");
  const e = await editableScenario(shock.scenarioId);
  if (!e.ok) return e;
  await prisma.scenarioShock.delete({ where: { id: shockId } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scenario Studio writes (M8.4). Same validation as addShock — bounds,
// compatibility, target existence — but with "set" semantics: an analyst who
// says "government yields +200 bps" means THE government assumption is +200,
// whether or not one existed. Still assumptions only; nothing calculated is
// ever stored.
// ---------------------------------------------------------------------------

type ShockWhere = Pick<StoredShockRow, "targetKind" | "assetClass" | "companyId" | "issuerNameKey" | "fixedIncomeSecurityId" | "securityId">;

/** Sets the assumption for a target: updates it if one exists, creates it otherwise. */
export async function upsertShock(input: { scenarioId: string; target: ShockTarget; value: number }): Promise<ServiceResult<{ shockId: string }>> {
  const e = await editableScenario(input.scenarioId);
  if (!e.ok) return e;
  const type = typeOf(input.target);
  const selector = asSelector(input.target);
  const compat = checkCompatibility(selector, type);
  if (!compat.ok) return fail(compat.message);
  const v = validateShockValue(type, input.value);
  if (!v.ok) return fail(v.message);
  const missing = await checkTargetExists(input.target, type);
  if (missing) return fail(missing);
  const prisma = getPrisma();
  const where: ShockWhere = selectorToColumns(selector);
  const existing = await prisma.scenarioShock.findFirst({ where: { scenarioId: input.scenarioId, shockType: type, ...where } });
  if (existing) {
    await prisma.scenarioShock.update({ where: { id: existing.id }, data: { value: input.value } });
    return { ok: true, shockId: existing.id };
  }
  try {
    const created = await prisma.scenarioShock.create({ data: { scenarioId: input.scenarioId, shockType: type, value: input.value, ...where } });
    return { ok: true, shockId: created.id };
  } catch (err) {
    if (isUniqueViolation(err)) return fail("This scenario already has an assumption for that target \u2014 try again.");
    throw err;
  }
}

/** Sets (value) or clears (null) the three asset-class assumptions at once, atomically. Values are bps for bonds and percent for equities. */
export async function setAssetClassAssumptions(input: { scenarioId: string; entries: { assetClass: ExposureAssetClass; value: number | null }[] }): Promise<ServiceResult> {
  const e = await editableScenario(input.scenarioId);
  if (!e.ok) return e;
  for (const entry of input.entries) {
    if (entry.value === null) continue;
    const v = validateShockValue(shockTypeForAssetClass(entry.assetClass), entry.value);
    if (!v.ok) return fail(v.message);
  }
  await getPrisma().$transaction(async (tx) => {
    for (const { assetClass, value } of input.entries) {
      const type = shockTypeForAssetClass(assetClass);
      const where: ShockWhere = selectorToColumns({ kind: "ASSET_CLASS", assetClass });
      const existing = await tx.scenarioShock.findFirst({ where: { scenarioId: input.scenarioId, shockType: type, ...where } });
      if (value === null) {
        if (existing) await tx.scenarioShock.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.scenarioShock.update({ where: { id: existing.id }, data: { value } });
      } else {
        await tx.scenarioShock.create({ data: { scenarioId: input.scenarioId, shockType: type, value, ...where } });
      }
    }
  });
  return { ok: true };
}

/** Creates a scenario pre-filled from a hypothetical starting template. The result is an ordinary, independent, editable scenario. */
export async function createScenarioFromTemplate(input: { portfolioId: string; templateId: string }): Promise<ServiceResult<{ id: string }>> {
  const template = getTemplate(input.templateId);
  if (!template) return fail("That starting point does not exist.");
  for (const a of template.assumptions) {
    const v = validateShockValue(shockTypeForAssetClass(a.assetClass), a.value);
    if (!v.ok) return fail(v.message);
  }
  const created = await createScenario({ portfolioId: input.portfolioId, name: template.name, description: `${template.blurb} ${TEMPLATE_DISCLAIMER}` });
  if (!created.ok) return created;
  const set = await setAssetClassAssumptions({ scenarioId: created.id, entries: template.assumptions.map((a) => ({ assetClass: a.assetClass, value: a.value })) });
  if (!set.ok) return set;
  return { ok: true, id: created.id };
}
