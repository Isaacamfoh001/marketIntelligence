// ---------------------------------------------------------------------------
// Scenario read queries (M8.3) — loads saved assumptions and adapts the M8.1
// valued positions to the pure engine (src/lib/scenarios). Field mapping only;
// the maths lives in the engine. Results are ALWAYS recomputed at read time
// from current portfolio + current reference valuation + saved assumptions —
// nothing calculated is stored.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { EXPOSURE_ASSET_CLASS_LABEL, resolveIssuerRef, type ExposureAssetClass } from "../portfolio";
import { rowToRule, runScenario, shockTypeForAssetClass, type ScenarioPosition, type ScenarioResult, type ScenarioShockRule, type ShockType, type StoredShockRow } from "../scenarios";
import { toExposurePositions, type InstrumentContext, type PortfolioDetail, type PositionRow } from "./portfolio";

export interface ScenarioSummaryRow {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  updatedAt: string;
  shockCount: number;
}

export interface ScenarioShockView {
  rule: ScenarioShockRule;
  row: StoredShockRow;
}

export interface ScenarioDefinition {
  id: string;
  portfolioId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  shocks: ScenarioShockView[];
}

export async function getScenarios(portfolioId: string, opts: { archived: boolean }): Promise<ScenarioSummaryRow[]> {
  const rows = await getPrisma().scenario.findMany({
    where: { portfolioId, archivedAt: opts.archived ? { not: null } : null },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { shocks: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null, updatedAt: r.updatedAt.toISOString(), shockCount: r._count.shocks }));
}

/** Display label of a stored target, resolved against the current instrument universe (so a label is never stored). */
function targetLabel(row: StoredShockRow, ctx: InstrumentContext): string {
  if (row.targetKind === "ASSET_CLASS" && row.assetClass) return EXPOSURE_ASSET_CLASS_LABEL[row.assetClass];
  if (row.targetKind === "SECURITY") {
    if (row.fixedIncomeSecurityId) return ctx.bondById.get(row.fixedIncomeSecurityId)?.label ?? "Unknown bond";
    if (row.securityId) return ctx.equityById.get(row.securityId)?.ticker ?? "Unknown security";
  }
  const key = row.companyId ? `company:${row.companyId}` : `name:${row.issuerNameKey}`;
  return issuerNames(ctx).get(key) ?? row.issuerNameKey ?? "Unknown issuer";
}

function issuerNames(ctx: InstrumentContext): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of ctx.bonds) {
    const i = resolveIssuerRef({ companyId: b.companyId, issuerName: b.issuerName });
    m.set(i.key, i.name);
  }
  for (const e of ctx.equities) {
    const i = resolveIssuerRef({ companyId: e.companyId, issuerName: e.companyName });
    if (!m.has(i.key)) m.set(i.key, i.name);
  }
  return m;
}

export async function getScenario(id: string, ctx: InstrumentContext): Promise<ScenarioDefinition | null> {
  const s = await getPrisma().scenario.findUnique({ where: { id }, include: { shocks: { orderBy: { createdAt: "asc" } } } });
  if (!s) return null;
  const shocks: ScenarioShockView[] = [];
  for (const r of s.shocks) {
    const row: StoredShockRow = { id: r.id, targetKind: r.targetKind, shockType: r.shockType, value: Number(r.value), assetClass: r.assetClass, companyId: r.companyId, issuerNameKey: r.issuerNameKey, fixedIncomeSecurityId: r.fixedIncomeSecurityId, securityId: r.securityId };
    const rule = rowToRule(row, targetLabel(row, ctx));
    if (rule) shocks.push({ rule, row });
  }
  return { id: s.id, portfolioId: s.portfolioId, name: s.name, description: s.description, archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(), shocks };
}

/** Adapts valued position rows to the engine: the exposure mapping plus the instrument id and bond terms the engine needs. */
export function toScenarioPositions(rows: PositionRow[]): ScenarioPosition[] {
  const exposure = toExposurePositions(rows);
  return rows.map((r, i): ScenarioPosition => {
    const e = exposure[i];
    return { positionId: e.positionId, label: e.label, assetClass: e.assetClass, issuer: e.issuer, instrumentId: r.instrument.id, valuation: e.valuation, terms: e.bond ? e.bond.terms : null };
  });
}

/** Runs the saved assumptions against the portfolio's current reference valuation — the SAME valuation date as M8.1. */
export function runScenarioForPortfolio(portfolio: PortfolioDetail, scenario: ScenarioDefinition): ScenarioResult {
  return runScenario({ valuationDate: new Date(`${portfolio.valuationDate}T00:00:00.000Z`), positions: toScenarioPositions(portfolio.positions), rules: scenario.shocks.map((s) => s.rule) });
}

// ---------------------------------------------------------------------------
// Target options for the assumption form. The shock type is IMPLIED by the
// option (a bond target takes bps, an equity target takes %), so an
// incompatible pairing cannot be composed in the UI; the server re-validates.
// ---------------------------------------------------------------------------

export interface TargetOption {
  /** Encoded as "KIND|key|SHOCKTYPE" and parsed by the server action. */
  value: string;
  label: string;
  group: "Asset class" | "Issuer" | "Security";
  shockType: ShockType;
}

export function buildTargetOptions(portfolio: PortfolioDetail): TargetOption[] {
  const opts: TargetOption[] = (["GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"] as ExposureAssetClass[]).map((c) => ({ value: `ASSET_CLASS|${c}|${shockTypeForAssetClass(c)}`, label: EXPOSURE_ASSET_CLASS_LABEL[c], group: "Asset class", shockType: shockTypeForAssetClass(c) }));
  const exposure = toExposurePositions(portfolio.positions);
  const issuerSeen = new Set<string>();
  const issuers: TargetOption[] = [];
  const securities: TargetOption[] = [];
  portfolio.positions.forEach((row: PositionRow, i) => {
    const e = exposure[i];
    const type: ShockType = e.assetClass === "EQUITY" ? "PRICE_PCT" : "YIELD_BPS";
    const issuerId = `${e.issuer.key}|${type}`;
    if (!issuerSeen.has(issuerId)) {
      issuerSeen.add(issuerId);
      issuers.push({ value: `ISSUER|${e.issuer.key}|${type}`, label: `${e.issuer.name} — ${type === "YIELD_BPS" ? "bonds" : "equity"}`, group: "Issuer", shockType: type });
    }
    securities.push({ value: `SECURITY|${e.assetClass === "EQUITY" ? "EQUITY" : "BOND"}:${row.instrument.id}|${type}`, label: e.label, group: "Security", shockType: type });
  });
  const by = (a: TargetOption, b: TargetOption) => a.label.localeCompare(b.label);
  return [...opts, ...issuers.sort(by), ...securities.sort(by)];
}

/** Parses a TargetOption.value. Null for anything malformed — the caller must reject, never guess. */
export function parseTargetOption(raw: string): import("../scenario-service").ShockTarget | null {
  const parts = raw.split("|");
  const kind = parts[0];
  const type = parts[parts.length - 1];
  const key = parts.slice(1, -1).join("|");
  if (parts.length < 3 || !kind || !key || !type) return null;
  if (kind === "ASSET_CLASS" && (key === "GOVERNMENT_BOND" || key === "CORPORATE_BOND" || key === "EQUITY")) return { kind, assetClass: key };
  if (kind === "ISSUER" && (type === "YIELD_BPS" || type === "PRICE_PCT")) return { kind, issuerKey: key, shockType: type };
  if (kind === "SECURITY") {
    const [instrument, ...rest] = key.split(":");
    const id = rest.join(":");
    if ((instrument === "BOND" || instrument === "EQUITY") && id) return { kind, instrument, instrumentId: id };
  }
  return null;
}
