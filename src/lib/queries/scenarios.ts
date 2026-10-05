// ---------------------------------------------------------------------------
// Scenario read queries (M8.3) — loads saved assumptions and adapts the M8.1
// valued positions to the pure engine (src/lib/scenarios). Field mapping only;
// the maths lives in the engine. Results are ALWAYS recomputed at read time
// from current portfolio + current reference valuation + saved assumptions —
// nothing calculated is stored.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { GOVERNMENT_OF_GHANA } from "../treasury-bills";
import { EXPOSURE_ASSET_CLASS_LABEL, resolveIssuerRef, type ExposureAssetClass } from "../portfolio";
import { rowToRule, runScenario, shockTypeForAssetClass, type ScenarioPosition, type ScenarioResult, type ScenarioShockRule, type ShockType, type StoredShockRow } from "../scenarios";
import { getPositionProvenance, toExposurePositions, type InstrumentContext, type PortfolioDetail, type PositionRow } from "./portfolio";
import { buildComparison, buildStudioView, summariseAssumptions, type Comparison, type PositionLinks, type Provenance, type StudioView } from "../scenario-studio";

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
    if (row.treasuryBillId) return ctx.billById.get(row.treasuryBillId)?.label ?? "Unknown Treasury bill";
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
  for (const b of ctx.bills) {
    const i = resolveIssuerRef({ companyId: b.companyId, issuerName: b.issuerName });
    if (!m.has(i.key)) m.set(i.key, i.name);
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
    const row: StoredShockRow = { id: r.id, targetKind: r.targetKind, shockType: r.shockType, value: Number(r.value), assetClass: r.assetClass, companyId: r.companyId, issuerNameKey: r.issuerNameKey, fixedIncomeSecurityId: r.fixedIncomeSecurityId, securityId: r.securityId, treasuryBillId: r.treasuryBillId };
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
  /** The bare name of the target ("Kasapreko Company PLC", "GoG Jul-34") for plain-English sentences. */
  targetName: string;
  group: "Asset class" | "Issuer" | "Security";
  kind: "ASSET_CLASS" | "ISSUER" | "SECURITY";
  shockType: ShockType;
}

export function buildTargetOptions(portfolio: PortfolioDetail): TargetOption[] {
  const opts: TargetOption[] = (["TREASURY_BILL", "GOVERNMENT_BOND", "CORPORATE_BOND", "EQUITY"] as ExposureAssetClass[]).map((c) => ({ value: `ASSET_CLASS|${c}|${shockTypeForAssetClass(c)}`, label: EXPOSURE_ASSET_CLASS_LABEL[c], targetName: EXPOSURE_ASSET_CLASS_LABEL[c], group: "Asset class", kind: "ASSET_CLASS", shockType: shockTypeForAssetClass(c) }));
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
      issuers.push({ value: `ISSUER|${e.issuer.key}|${type}`, label: `${e.issuer.name} — ${type === "YIELD_BPS" ? (e.issuer.name === GOVERNMENT_OF_GHANA ? "bonds and Treasury bills" : "bonds") : "equity"}`, targetName: e.issuer.name, group: "Issuer", kind: "ISSUER", shockType: type });
    }
    securities.push({ value: `SECURITY|${e.assetClass === "EQUITY" ? "EQUITY" : e.assetClass === "TREASURY_BILL" ? "TREASURY_BILL" : "BOND"}:${row.instrument.id}|${type}`, label: e.label, targetName: e.label, group: "Security", kind: "SECURITY", shockType: type });
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
  if (kind === "ASSET_CLASS" && (key === "TREASURY_BILL" || key === "GOVERNMENT_BOND" || key === "CORPORATE_BOND" || key === "EQUITY")) return { kind, assetClass: key };
  if (kind === "ISSUER" && (type === "YIELD_BPS" || type === "PRICE_PCT")) return { kind, issuerKey: key, shockType: type };
  if (kind === "SECURITY") {
    const [instrument, ...rest] = key.split(":");
    const id = rest.join(":");
    if ((instrument === "BOND" || instrument === "EQUITY" || instrument === "TREASURY_BILL") && id) return { kind, instrument, instrumentId: id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scenario Studio (M8.4) — gathers what the pure view-model needs: the engine
// result (always computed here, from current data), the routes that really
// exist for each position, and the provenance of the observation behind it.
// ---------------------------------------------------------------------------

/** Destinations for each position, built only from routes that exist. */
export async function getPositionLinks(portfolio: PortfolioDetail): Promise<Record<string, PositionLinks>> {
  const companyIds = [...new Set(portfolio.positions.flatMap((p) => (p.instrument.kind === "EQUITY" ? [p.instrument.companyId] : [])))];
  const companies = companyIds.length > 0 ? await getPrisma().company.findMany({ where: { id: { in: companyIds } }, select: { id: true, ticker: true } }) : [];
  const tickerOf = new Map(companies.map((c) => [c.id, c.ticker]));
  const out: Record<string, PositionLinks> = {};
  for (const row of portfolio.positions) {
    const inspect = { href: `/portfolios/${portfolio.id}?position=${row.positionId}#inspect`, label: "Inspect holding" };
    if (row.instrument.kind === "BOND") {
      const code = encodeURIComponent(row.instrument.instrumentCode);
      out[row.positionId] = { analysis: { href: `/fixed-income/${code}`, label: "Open fixed-income analysis" }, evidence: { href: `/fixed-income/${code}#evidence`, label: "Review underlying market evidence" }, inspect };
    } else if (row.instrument.kind === "TREASURY_BILL") {
      // The rate evidence for every bill is the Treasury-bill auction history on Macro & Rates.
      out[row.positionId] = { analysis: null, evidence: { href: "/macro-rates#treasury-bills", label: "Review Bank of Ghana auction rates" }, inspect };
    } else {
      const ticker = tickerOf.get(row.instrument.companyId);
      out[row.positionId] = { analysis: ticker ? { href: `/companies/${encodeURIComponent(ticker)}`, label: "Open company page" } : null, evidence: inspect, inspect };
    }
  }
  return out;
}

/** Source / ingestion-run provenance for every valued position (null when unvalued or not found). */
export async function getProvenances(portfolio: PortfolioDetail): Promise<Record<string, Provenance | null>> {
  const entries = await Promise.all(portfolio.positions.map(async (row) => [row.positionId, await getPositionProvenance(row)] as const));
  return Object.fromEntries(entries);
}

export interface ScenarioStudioData {
  result: ScenarioResult;
  view: StudioView | null;
}

/** Runs one scenario and builds its view. `view` is null only when the saved assumptions fail validation. */
export async function getScenarioStudio(portfolio: PortfolioDetail, scenario: ScenarioDefinition): Promise<ScenarioStudioData> {
  const result = runScenarioForPortfolio(portfolio, scenario);
  if (!result.ok) return { result, view: null };
  const [links, provenance] = await Promise.all([getPositionLinks(portfolio), getProvenances(portfolio)]);
  return { result, view: buildStudioView({ result, links, provenance }) };
}

export interface LibraryRow {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  assumptionSummary: string;
  assumptionCount: number;
  /** Null when the saved assumptions cannot be run or nothing is valued. */
  impactText: string | null;
  impactPctText: string | null;
  impactGhs: number | null;
  primaryDriver: string | null;
  quality: { label: string; tone: "ok" | "caution" } | null;
  invalid: boolean;
}

/** Saved scenarios with their CURRENT calculated effect — recomputed now, not a stored historical run. */
export async function getScenarioLibrary(portfolio: PortfolioDetail, ctx: InstrumentContext): Promise<{ active: LibraryRow[]; archived: { id: string; name: string }[] }> {
  const [activeRows, archivedRows] = await Promise.all([getScenarios(portfolio.id, { archived: false }), getScenarios(portfolio.id, { archived: true })]);
  const active: LibraryRow[] = [];
  for (const row of activeRows) {
    const def = await getScenario(row.id, ctx);
    if (!def) continue;
    const result = runScenarioForPortfolio(portfolio, def);
    const base = { id: row.id, name: row.name, description: row.description, updatedAt: row.updatedAt, assumptionSummary: summariseAssumptions(def.shocks.map((s) => s.rule)), assumptionCount: def.shocks.length };
    if (!result.ok) {
      active.push({ ...base, impactText: null, impactPctText: null, impactGhs: null, primaryDriver: null, quality: null, invalid: true });
      continue;
    }
    const view = buildStudioView({ result, links: {}, provenance: {} });
    const flag = view.confidence.flags[0];
    active.push({
      ...base,
      impactText: view.headline.impactWhole,
      impactPctText: view.headline.impactPctText,
      impactGhs: view.headline.impactGhs,
      primaryDriver: view.mainClass ? view.mainClass.label : null,
      quality: view.headline.status === "RESULT" && flag ? { label: flag.code === "RECENT_INPUTS" ? "Recent inputs" : flag.code === "STALE_DEPENDENCE" ? `${view.confidence.staleBasisPct!.toFixed(0)}% stale basis` : flag.label, tone: flag.code === "RECENT_INPUTS" ? "ok" : "caution" } : null,
      invalid: false,
    });
  }
  return { active, archived: archivedRows.map((r) => ({ id: r.id, name: r.name })) };
}

/** Runs several scenarios against ONE already-loaded portfolio snapshot — the same valuation date and reference valuations — and compares them. */
export async function getScenarioComparison(portfolio: PortfolioDetail, ctx: InstrumentContext, ids: string[]): Promise<{ comparison: Comparison | null; invalid: string[]; missing: string[] }> {
  const inputs: { id: string; name: string; result: Extract<ScenarioResult, { ok: true }> }[] = [];
  const invalid: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const def = await getScenario(id, ctx);
    if (!def || def.portfolioId !== portfolio.id) {
      missing.push(id);
      continue;
    }
    const result = runScenarioForPortfolio(portfolio, def);
    if (!result.ok) invalid.push(def.name);
    else inputs.push({ id: def.id, name: def.name, result });
  }
  return { comparison: inputs.length >= 2 ? buildComparison(inputs) : null, invalid, missing };
}
