// ---------------------------------------------------------------------------
// Portfolio read queries (M8.1) — the ONE place stored portfolios are joined
// to the market data that values them. All financial logic lives in the pure
// domain layer (src/lib/portfolio); this file only loads rows, assembles the
// domain's plain inputs from M7's fixed-income rows and the GSE price table,
// and calls the domain. Valuation is ALWAYS recomputed at read time as of
// today's valuation date — no valuation is ever stored.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { getFixedIncomeUniverse, type FixedIncomeSecurityRow } from "./fixed-income";
import { securityShortLabel, toValuationDate } from "../fixed-income";
import {
  checkBondAddable,
  checkEquityAddable,
  resolveBondValuationInput,
  resolveEquityValuationInput,
  summarizePortfolio,
  valueBondPosition,
  valueEquityPosition,
  type Addable,
  type BondValuationInput,
  type BondValuationSource,
  type EquityPriceRow,
  type EquityValuationInput,
  type PortfolioValuationSummary,
  type PositionHolding,
  type PositionValuation,
  type Unvalued,
} from "../portfolio";
import type { BondTerms, SecurityLifecycle } from "../fixed-income";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Instrument context — every holdable instrument with its resolved valuation input
// ---------------------------------------------------------------------------

export interface BondInstrument {
  kind: "BOND";
  id: string;
  instrumentCode: string;
  label: string;
  issuerName: string;
  instrumentType: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  couponRatePct: number | null;
  couponType: "FIXED" | "FLOATING" | "ZERO_COUPON";
  maturityDate: string;
  lifecycle: SecurityLifecycle;
  terms: BondTerms;
  input: BondValuationInput | Unvalued;
  addable: Addable;
}

export interface EquityInstrument {
  kind: "EQUITY";
  id: string;
  ticker: string;
  companyName: string;
  input: EquityValuationInput | Unvalued;
  addable: Addable;
}

export type HoldableInstrument = BondInstrument | EquityInstrument;

export interface InstrumentContext {
  valuationDate: Date;
  bonds: BondInstrument[];
  equities: EquityInstrument[];
  bondById: Map<string, BondInstrument>;
  equityById: Map<string, EquityInstrument>;
}

/** Adapts an M7 security row to the domain resolver's input — no logic, only field mapping. */
export function toBondValuationSource(row: FixedIncomeSecurityRow): BondValuationSource {
  const quality = row.analytics.quality;
  return {
    currency: row.currency,
    status: row.status,
    lifecycle: row.lifecycle,
    terms: row.terms,
    termsConflicts: row.termsIssues.filter((i) => i.severity === "REVIEW").map((i) => i.detail),
    latestReliableTrade: row.tradeHistory.latestReliableTrade,
    marketObservation:
      row.latestObservationDate && quality
        ? { date: row.latestObservationDate, status: quality.status, issues: quality.issues.filter((i) => i.severity !== "INFO").map((i) => i.detail) }
        : null,
    carriedOnly: row.latestObservationDate === null && (row.carriedPrice !== null || row.noTradeRecordedSince !== null),
  };
}

/**
 * Per security: every price row from its latest ACTUAL-trade row onward (so the
 * resolver can count the no-trade rows it skipped), or its whole history when it
 * has never traded (so "no trade since <first row>" is truthful).
 */
async function loadEquityPrices(securityIds: string[], valuationDate: Date): Promise<Map<string, EquityPriceRow[]>> {
  const prisma = getPrisma();
  const out = new Map<string, EquityPriceRow[]>(securityIds.map((id) => [id, []]));
  if (securityIds.length === 0) return out;

  const lastTraded = await prisma.securityPrice.groupBy({
    by: ["securityId"],
    where: { securityId: { in: securityIds }, volume: { gt: 0 }, tradingDate: { lte: valuationDate } },
    _max: { tradingDate: true },
  });
  const lastTradedBySecurity = new Map(lastTraded.map((r) => [r.securityId, r._max.tradingDate]));

  const rows = await prisma.securityPrice.findMany({
    where: {
      tradingDate: { lte: valuationDate },
      OR: securityIds.map((securityId) => {
        const from = lastTradedBySecurity.get(securityId);
        return from ? { securityId, tradingDate: { gte: from } } : { securityId };
      }),
    },
    select: { securityId: true, tradingDate: true, closeVwap: true, volume: true, valueTradedGhs: true },
  });
  for (const r of rows) {
    out.get(r.securityId)!.push({
      tradingDate: isoDay(r.tradingDate),
      closeVwap: Number(r.closeVwap),
      volume: r.volume === null ? null : Number(r.volume),
      valueTradedGhs: r.valueTradedGhs === null ? null : Number(r.valueTradedGhs),
    });
  }
  return out;
}

export async function getInstrumentContext(valuationDate: Date = toValuationDate(new Date())): Promise<InstrumentContext> {
  const prisma = getPrisma();
  const [universe, securities] = await Promise.all([
    getFixedIncomeUniverse(valuationDate),
    prisma.security.findMany({ include: { company: { select: { name: true } } }, orderBy: { ticker: "asc" } }),
  ]);
  const prices = await loadEquityPrices(
    securities.map((s) => s.id),
    valuationDate,
  );

  const bonds: BondInstrument[] = universe.map((row) => ({
    kind: "BOND",
    id: row.id,
    instrumentCode: row.instrumentCode,
    label: securityShortLabel(row.issuerName, row.couponRatePct, row.maturityDate),
    issuerName: row.issuerName,
    instrumentType: row.instrumentType,
    couponRatePct: row.couponRatePct,
    couponType: row.couponType,
    maturityDate: row.maturityDate,
    lifecycle: row.lifecycle,
    terms: row.terms,
    input: resolveBondValuationInput(toBondValuationSource(row), valuationDate),
    addable: checkBondAddable({ currency: row.currency, lifecycle: row.lifecycle, couponType: row.couponType }),
  }));

  const equities: EquityInstrument[] = securities.map((s) => ({
    kind: "EQUITY",
    id: s.id,
    ticker: s.ticker,
    companyName: s.company.name,
    input: resolveEquityValuationInput({ currency: s.currency, active: s.active, prices: prices.get(s.id) ?? [] }, valuationDate),
    addable: checkEquityAddable({ currency: s.currency, active: s.active }),
  }));

  return {
    valuationDate,
    bonds,
    equities,
    bondById: new Map(bonds.map((b) => [b.id, b])),
    equityById: new Map(equities.map((e) => [e.id, e])),
  };
}

// ---------------------------------------------------------------------------
// Portfolios
// ---------------------------------------------------------------------------

export interface PositionRow {
  positionId: string;
  holding: PositionHolding;
  instrument: HoldableInstrument;
  valuation: PositionValuation;
}

export interface PortfolioDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  valuationDate: string;
  positions: PositionRow[];
  summary: PortfolioValuationSummary;
}

interface StoredPosition {
  id: string;
  assetClass: "BOND" | "EQUITY";
  fixedIncomeSecurityId: string | null;
  nominalGhs: unknown;
  securityId: string | null;
  shares: number | null;
  createdAt: Date;
}

function valuePosition(p: StoredPosition, ctx: InstrumentContext): PositionRow | null {
  if (p.assetClass === "BOND" && p.fixedIncomeSecurityId) {
    const bond = ctx.bondById.get(p.fixedIncomeSecurityId);
    if (!bond) return null;
    const nominalGhs = Number(p.nominalGhs);
    return {
      positionId: p.id,
      holding: { assetClass: "BOND", positionId: p.id, fixedIncomeSecurityId: bond.id, nominalGhs },
      instrument: bond,
      valuation: valueBondPosition(nominalGhs, bond.terms, bond.input, ctx.valuationDate),
    };
  }
  if (p.assetClass === "EQUITY" && p.securityId) {
    const equity = ctx.equityById.get(p.securityId);
    if (!equity) return null;
    return {
      positionId: p.id,
      holding: { assetClass: "EQUITY", positionId: p.id, securityId: equity.id, shares: p.shares as number },
      instrument: equity,
      valuation: valueEquityPosition(p.shares as number, equity.input),
    };
  }
  return null;
}

function toDetail(
  portfolio: { id: string; name: string; description: string | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date; positions: StoredPosition[] },
  ctx: InstrumentContext,
): PortfolioDetail {
  const positions = portfolio.positions
    .map((p) => valuePosition(p, ctx))
    .filter((p): p is PositionRow => p !== null)
    .sort((a, b) => positionSortKey(a).localeCompare(positionSortKey(b)));
  return {
    id: portfolio.id,
    name: portfolio.name,
    description: portfolio.description,
    archivedAt: portfolio.archivedAt ? portfolio.archivedAt.toISOString() : null,
    createdAt: portfolio.createdAt.toISOString(),
    updatedAt: portfolio.updatedAt.toISOString(),
    valuationDate: isoDay(ctx.valuationDate),
    positions,
    summary: summarizePortfolio(
      positions.map((p) => p.valuation),
      ctx.valuationDate,
    ),
  };
}

const positionSortKey = (p: PositionRow) => `${p.holding.assetClass === "BOND" ? "0" : "1"}|${p.instrument.kind === "BOND" ? p.instrument.label : p.instrument.ticker}`;

const POSITION_SELECT = { id: true, assetClass: true, fixedIncomeSecurityId: true, nominalGhs: true, securityId: true, shares: true, createdAt: true } as const;

/** Active (not archived) or archived portfolios, newest-updated first, each with its valuation summary. */
export async function getPortfolios(opts: { archived: boolean }, ctx?: InstrumentContext): Promise<PortfolioDetail[]> {
  const context = ctx ?? (await getInstrumentContext());
  const rows = await getPrisma().portfolio.findMany({
    where: opts.archived ? { archivedAt: { not: null } } : { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { positions: { select: POSITION_SELECT } },
  });
  return rows.map((r) => toDetail(r, context));
}

export async function getPortfolio(id: string, ctx?: InstrumentContext): Promise<PortfolioDetail | null> {
  const row = await getPrisma().portfolio.findUnique({ where: { id }, include: { positions: { select: POSITION_SELECT } } });
  if (!row) return null;
  return toDetail(row, ctx ?? (await getInstrumentContext()));
}

// ---------------------------------------------------------------------------
// Provenance of the observation behind a valued position
// ---------------------------------------------------------------------------

export interface InputProvenance {
  sourceName: string;
  ingestionRunId: string;
  retrievedAt: string;
  facts: { label: string; value: string }[];
}

const fmtNum = (v: unknown, dp = 2) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

/** Source, ingestion run and the raw row facts behind the exact observation a position's value rests on — null when the position is unvalued. */
export async function getPositionProvenance(row: PositionRow): Promise<InputProvenance | null> {
  if (row.valuation.status !== "VALUED") return null;
  const prisma = getPrisma();
  if (row.valuation.detail.assetClass === "BOND" && row.instrument.kind === "BOND") {
    const obs = await prisma.fixedIncomeObservation.findUnique({
      where: { securityId_observationDate: { securityId: row.instrument.id, observationDate: new Date(`${row.valuation.detail.observationDate}T00:00:00.000Z`) } },
      include: { source: { select: { name: true } } },
    });
    if (!obs) return null;
    return {
      sourceName: obs.source.name,
      ingestionRunId: obs.ingestionRunId,
      retrievedAt: obs.retrievedAt.toISOString(),
      facts: [
        { label: "Observation kind", value: obs.observationKind === "SECONDARY_MARKET" ? "Secondary-market trade" : "Primary auction" },
        { label: "Trade status", value: obs.tradeStatus ?? "Not reported by source" },
        { label: "Published clean price", value: obs.cleanPrice === null ? "—" : fmtNum(obs.cleanPrice, 4) },
        { label: "Published yield", value: obs.sourceYieldPct === null ? "—" : `${fmtNum(obs.sourceYieldPct)}%` },
        { label: "Volume traded", value: obs.volumeTradedGhs === null ? "—" : `GHS ${fmtNum(obs.volumeTradedGhs)}` },
        { label: "Number of trades", value: obs.numberOfTrades === null ? "—" : String(obs.numberOfTrades) },
      ],
    };
  }
  if (row.valuation.detail.assetClass === "EQUITY" && row.instrument.kind === "EQUITY") {
    const price = await prisma.securityPrice.findUnique({
      where: { securityId_tradingDate: { securityId: row.instrument.id, tradingDate: new Date(`${row.valuation.detail.priceDate}T00:00:00.000Z`) } },
      include: { source: { select: { name: true } } },
    });
    if (!price) return null;
    return {
      sourceName: price.source.name,
      ingestionRunId: price.ingestionRunId,
      retrievedAt: price.retrievedAt.toISOString(),
      facts: [
        { label: "Closing price (VWAP)", value: `GHS ${fmtNum(price.closeVwap, 4)}` },
        { label: "Previous close", value: price.previousCloseVwap === null ? "—" : `GHS ${fmtNum(price.previousCloseVwap, 4)}` },
        { label: "Shares traded", value: price.volume === null ? "—" : Number(price.volume).toLocaleString("en-GB") },
        { label: "Value traded", value: price.valueTradedGhs === null ? "—" : `GHS ${fmtNum(price.valueTradedGhs)}` },
      ],
    };
  }
  return null;
}
