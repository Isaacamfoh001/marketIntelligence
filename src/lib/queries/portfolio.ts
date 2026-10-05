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
import { billDaysToMaturity, billLabel, GOVERNMENT_OF_GHANA, selectLatestCompleteCurve, type AuctionCurve, type AuctionRateRow } from "../treasury-bills";
import {
  checkBillAddable,
  checkBondAddable,
  resolveBillValuationInput,
  valueBillPosition,
  type BillValuationInput,
  checkEquityAddable,
  resolveBondValuationInput,
  resolveEquityValuationInput,
  summarizePortfolio,
  computeExposures,
  resolveIssuerRef,
  valueBondPosition,
  valueBondWithAssumption,
  valueEquityPosition,
  valueBillWithAssumption,
  valueEquityWithAssumption,
  resolveValuation,
  validateAssumption,
  assumptionAvailability,
  type ValuedPosition,
  type StoredAssumption,
  type Addable,
  type BondValuationInput,
  type BondValuationSource,
  type ExposurePosition,
  type PortfolioExposures,
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
  /** The linked Company, when the Securities Master has one (issuer identity for exposure aggregation). */
  companyId: string | null;
  instrumentType: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  currency: string;
  status: "ACTIVE" | "MATURED" | "CALLED" | "DEFAULTED";
  /** M7 REVIEW-severity source-vs-master conflicts, split by the contractual term they affect. */
  maturityConflict: boolean;
  couponConflict: boolean;
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
  companyId: string;
  input: EquityValuationInput | Unvalued;
  addable: Addable;
}

/** A Treasury bill that can be held. Valued from the BoG auction curve, never from a stored per-bill price (none exists). */
export interface BillInstrument {
  kind: "TREASURY_BILL";
  id: string;
  label: string;
  issuerName: string;
  /** The Government of Ghana Company record the sovereign bonds link to (null when none exists) — so a bill and a government bond are ONE issuer in exposure and scenario targeting. */
  companyId: string | null;
  tenorDays: number;
  issueDate: string;
  maturityDate: string;
  isin: string | null;
  currency: string;
  input: BillValuationInput | Unvalued;
  addable: Addable;
}

export type HoldableInstrument = BondInstrument | EquityInstrument | BillInstrument;

export interface InstrumentContext {
  valuationDate: Date;
  /** The latest complete BoG auction curve at the valuation date — what every Treasury bill (existing or not yet recorded) is valued from. */
  curve: AuctionCurve | null;
  bonds: BondInstrument[];
  equities: EquityInstrument[];
  bills: BillInstrument[];
  bondById: Map<string, BondInstrument>;
  equityById: Map<string, EquityInstrument>;
  billById: Map<string, BillInstrument>;
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

/** BoG auction rows near the valuation date — enough history (120 days) to find the latest COMPLETE weekly curve. */
async function loadAuctionRows(valuationDate: Date): Promise<AuctionRateRow[]> {
  const from = new Date(valuationDate.getTime() - 120 * 86_400_000);
  const rows = await getPrisma().treasuryRate.findMany({
    where: { observationDate: { gte: from, lte: valuationDate } },
    include: { instrument: { select: { tenorDays: true } } },
  });
  return rows.map((r) => ({ tenorDays: r.instrument.tenorDays, observationDate: isoDay(r.observationDate), interestRatePct: Number(r.interestRate), discountRatePct: Number(r.discountRate), tenderNumber: r.tenderNumber }));
}

/** The latest complete BoG auction curve at/before the valuation date — the evidence every Treasury bill is valued from. */
export async function getLatestAuctionCurve(valuationDate: Date = toValuationDate(new Date())) {
  return selectLatestCompleteCurve(await loadAuctionRows(valuationDate), isoDay(valuationDate));
}

export async function getInstrumentContext(valuationDate: Date = toValuationDate(new Date())): Promise<InstrumentContext> {
  const prisma = getPrisma();
  const [universe, securities, bondCompanies, billRows, auctionRows] = await Promise.all([
    getFixedIncomeUniverse(valuationDate),
    prisma.security.findMany({ include: { company: { select: { name: true } } }, orderBy: { ticker: "asc" } }),
    // companyId is not on M7's security row; read it here rather than widening M7's query.
    prisma.fixedIncomeSecurity.findMany({ select: { id: true, companyId: true } }),
    prisma.treasuryBill.findMany({ include: { instrument: { select: { tenorDays: true } } }, orderBy: { maturityDate: "asc" } }),
    loadAuctionRows(valuationDate),
  ]);
  const curve = selectLatestCompleteCurve(auctionRows, isoDay(valuationDate));
  const companyIdByBond = new Map(bondCompanies.map((b) => [b.id, b.companyId]));
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
    companyId: companyIdByBond.get(row.id) ?? null,
    instrumentType: row.instrumentType,
    currency: row.currency,
    status: row.status,
    maturityConflict: row.termsIssues.some((i) => i.severity === "REVIEW" && i.code === "MATURITY_CONFLICT"),
    couponConflict: row.termsIssues.some((i) => i.severity === "REVIEW" && i.code === "COUPON_CONFLICT"),
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
    companyId: s.companyId,
    input: resolveEquityValuationInput({ currency: s.currency, active: s.active, prices: prices.get(s.id) ?? [] }, valuationDate),
    addable: checkEquityAddable({ currency: s.currency, active: s.active }),
  }));

  const sovereignCompanyId = universe.map((row) => (row.issuerName === GOVERNMENT_OF_GHANA ? companyIdByBond.get(row.id) ?? null : null)).find((id) => id !== null) ?? null;
  const bills: BillInstrument[] = billRows.map((b) => ({
    kind: "TREASURY_BILL",
    id: b.id,
    label: billLabel(b.instrument.tenorDays, b.maturityDate),
    issuerName: GOVERNMENT_OF_GHANA,
    companyId: sovereignCompanyId,
    tenorDays: b.instrument.tenorDays,
    issueDate: isoDay(b.issueDate),
    maturityDate: isoDay(b.maturityDate),
    isin: b.isin,
    currency: b.currency,
    input: resolveBillValuationInput({ currency: b.currency, tenorDays: b.instrument.tenorDays, issueDate: b.issueDate, maturityDate: b.maturityDate, curve }, valuationDate),
    addable: checkBillAddable({ currency: b.currency, maturityDate: b.maturityDate }, valuationDate),
  }));

  return {
    valuationDate,
    curve,
    bonds,
    equities,
    bills,
    bondById: new Map(bonds.map((b) => [b.id, b])),
    equityById: new Map(equities.map((e) => [e.id, e])),
    billById: new Map(bills.map((b) => [b.id, b])),
  };
}

// ---------------------------------------------------------------------------
// Evaluating an assumption (M9.0.1) — what would this holding be worth, and on
// what basis, if the analyst assumed X? Shared by the single-position editor,
// the batch builder and the server-side write path so a preview can never
// disagree with what is saved. Nothing is stored here.
// ---------------------------------------------------------------------------

export type AssumptionTarget =
  | { assetClass: "BOND"; instrumentId: string; nominalGhs: number }
  | { assetClass: "EQUITY"; instrumentId: string; shares: number }
  | { assetClass: "TREASURY_BILL"; tenorDays: number; maturityDate: string; faceValueGhs: number };

export type AssumptionEvaluation =
  | { ok: true; valuation: ValuedPosition; korbly: PositionValuation; overridesReference: boolean }
  | { ok: false; error: string };

export function evaluateAssumption(ctx: InstrumentContext, target: AssumptionTarget, draft: { kind: StoredAssumption["kind"]; value: number | null }): AssumptionEvaluation {
  const checked = validateAssumption(target.assetClass, draft.kind, draft.value);
  if (!checked.ok) return { ok: false, error: checked.error };

  let korbly: PositionValuation;
  let assumed: (a: StoredAssumption) => PositionValuation;
  if (target.assetClass === "BOND") {
    const bond = ctx.bondById.get(target.instrumentId);
    if (!bond) return { ok: false, error: "Bond not found." };
    korbly = valueBondPosition(target.nominalGhs, bond.terms, bond.input, ctx.valuationDate);
    assumed = (a) => valueBondWithAssumption(target.nominalGhs, bond.terms, a, ctx.valuationDate);
  } else if (target.assetClass === "EQUITY") {
    const equity = ctx.equityById.get(target.instrumentId);
    if (!equity) return { ok: false, error: "Security not found." };
    korbly = valueEquityPosition(target.shares, equity.input);
    assumed = (a) => valueEquityWithAssumption(target.shares, a, ctx.valuationDate);
  } else {
    const maturity = new Date(`${target.maturityDate}T00:00:00.000Z`);
    const input = resolveBillValuationInput({ currency: "GHS", tenorDays: target.tenorDays, issueDate: maturity, maturityDate: maturity, curve: ctx.curve }, ctx.valuationDate);
    korbly = valueBillPosition(target.faceValueGhs, input, ctx.valuationDate);
    assumed = (a) => valueBillWithAssumption(target.faceValueGhs, billDaysToMaturity(maturity, ctx.valuationDate), a, ctx.valuationDate);
  }

  if (korbly.status === "UNVALUED") {
    const availability = assumptionAvailability(target.assetClass, korbly.code);
    if (!availability.assumable) return { ok: false, error: `An assumption cannot be used here. ${availability.reason}` };
  }
  const stored: StoredAssumption = { kind: draft.kind, value: draft.value, overridesReference: korbly.status === "VALUED" };
  const valuation = assumed(stored);
  if (valuation.status !== "VALUED") return { ok: false, error: valuation.assumptionProblem ? `That assumption cannot be applied: ${valuation.assumptionProblem.reason}` : valuation.reason };
  return { ok: true, valuation: { ...valuation, korblyBasis: korbly.status === "VALUED" ? { basis: korbly.basis as "REFERENCE" | "INDICATIVE", valueGhs: korbly.referenceValueGhs, inputDate: korbly.inputDate, recency: korbly.recency } : null }, korbly, overridesReference: stored.overridesReference };
}

// ---------------------------------------------------------------------------
// Portfolios
// ---------------------------------------------------------------------------

export interface PositionRow {
  positionId: string;
  holding: PositionHolding;
  instrument: HoldableInstrument;
  /** The value the position is CARRIED at in every analysis: Korbly-supported, or the analyst's assumption (see `valuation.basis`). */
  valuation: PositionValuation;
  /** What Korbly alone supports — untouched by any assumption. */
  korblyValuation: PositionValuation;
  /** The analyst assumption stored for this position, if any (whether or not it is currently in force). */
  assumption: StoredAssumption | null;
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
  assetClass: "BOND" | "EQUITY" | "TREASURY_BILL";
  fixedIncomeSecurityId: string | null;
  treasuryBillId?: string | null;
  nominalGhs: unknown;
  securityId: string | null;
  shares: number | null;
  createdAt: Date;
  assumption?: { kind: StoredAssumption["kind"]; value: unknown; overridesReference: boolean } | null;
}

const toStoredAssumption = (a: StoredPosition["assumption"]): StoredAssumption | null => (a ? { kind: a.kind, value: a.value === null || a.value === undefined ? null : Number(a.value), overridesReference: a.overridesReference } : null);

function valuePosition(p: StoredPosition, ctx: InstrumentContext): PositionRow | null {
  const stored = toStoredAssumption(p.assumption);
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  if (p.assetClass === "BOND" && p.fixedIncomeSecurityId) {
    const bond = ctx.bondById.get(p.fixedIncomeSecurityId);
    if (!bond) return null;
    const nominalGhs = Number(p.nominalGhs);
    const korbly = valueBondPosition(nominalGhs, bond.terms, bond.input, ctx.valuationDate);
    return {
      positionId: p.id,
      holding: { assetClass: "BOND", positionId: p.id, fixedIncomeSecurityId: bond.id, nominalGhs },
      instrument: bond,
      valuation: resolveValuation(korbly, stored, () => valueBondWithAssumption(nominalGhs, bond.terms, stored!, ctx.valuationDate)),
      korblyValuation: korbly,
      assumption: stored,
    };
  }
  if (p.assetClass === "TREASURY_BILL" && p.treasuryBillId) {
    const bill = ctx.billById.get(p.treasuryBillId);
    if (!bill) return null;
    const faceValueGhs = Number(p.nominalGhs);
    const korbly = valueBillPosition(faceValueGhs, bill.input, ctx.valuationDate);
    return {
      positionId: p.id,
      holding: { assetClass: "TREASURY_BILL", positionId: p.id, treasuryBillId: bill.id, faceValueGhs },
      instrument: bill,
      valuation: resolveValuation(korbly, stored, () => valueBillWithAssumption(faceValueGhs, billDaysToMaturity(day(bill.maturityDate), ctx.valuationDate), stored!, ctx.valuationDate)),
      korblyValuation: korbly,
      assumption: stored,
    };
  }
  if (p.assetClass === "EQUITY" && p.securityId) {
    const equity = ctx.equityById.get(p.securityId);
    if (!equity) return null;
    const shares = p.shares as number;
    const korbly = valueEquityPosition(shares, equity.input);
    return {
      positionId: p.id,
      holding: { assetClass: "EQUITY", positionId: p.id, securityId: equity.id, shares },
      instrument: equity,
      valuation: resolveValuation(korbly, stored, () => valueEquityWithAssumption(shares, stored!, ctx.valuationDate)),
      korblyValuation: korbly,
      assumption: stored,
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

const positionSortKey = (p: PositionRow) => `${p.holding.assetClass === "TREASURY_BILL" ? "0|" + (p.instrument as BillInstrument).maturityDate : p.holding.assetClass === "BOND" ? "1" : "2"}|${p.instrument.kind === "BOND" || p.instrument.kind === "TREASURY_BILL" ? p.instrument.label : p.instrument.ticker}`;

const POSITION_SELECT = { id: true, assetClass: true, fixedIncomeSecurityId: true, treasuryBillId: true, nominalGhs: true, securityId: true, shares: true, createdAt: true, assumption: { select: { kind: true, value: true, overridesReference: true } } } as const;

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
// Exposure analytics (M8.2) — field mapping only; the maths is in src/lib/portfolio/exposures.ts
// ---------------------------------------------------------------------------

/** Adapts valued position rows to the exposure domain's plain inputs. */
export function toExposurePositions(rows: PositionRow[]): ExposurePosition[] {
  return rows.map((r): ExposurePosition => {
    if (r.instrument.kind === "BOND" && r.holding.assetClass === "BOND") {
      const b = r.instrument;
      return {
        positionId: r.positionId,
        label: b.label,
        assetClass: b.instrumentType,
        issuer: resolveIssuerRef({ companyId: b.companyId, issuerName: b.issuerName }),
        valuation: r.valuation,
        bond: { nominalGhs: r.holding.nominalGhs, currency: b.currency, status: b.status, terms: b.terms, maturityConflict: b.maturityConflict, couponConflict: b.couponConflict },
      };
    }
    if (r.instrument.kind === "TREASURY_BILL" && r.holding.assetClass === "TREASURY_BILL") {
      const b = r.instrument;
      return {
        positionId: r.positionId,
        label: b.label,
        assetClass: "TREASURY_BILL",
        issuer: resolveIssuerRef({ companyId: b.companyId, issuerName: b.issuerName }),
        valuation: r.valuation,
        bond: null,
        bill: { faceValueGhs: r.holding.faceValueGhs, currency: b.currency, tenorDays: b.tenorDays, issueDate: new Date(`${b.issueDate}T00:00:00.000Z`), maturityDate: new Date(`${b.maturityDate}T00:00:00.000Z`) },
      };
    }
    const e = r.instrument as EquityInstrument;
    return {
      positionId: r.positionId,
      label: e.ticker,
      assetClass: "EQUITY",
      issuer: resolveIssuerRef({ companyId: e.companyId, issuerName: e.companyName }),
      valuation: r.valuation,
      bond: null,
    };
  });
}

export function getPortfolioExposures(portfolio: PortfolioDetail): PortfolioExposures {
  return computeExposures(toExposurePositions(portfolio.positions), portfolio.summary, new Date(`${portfolio.valuationDate}T00:00:00.000Z`));
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

/**
 * Source, ingestion run and the raw row facts behind the exact observation KORBLY's own valuation rests on — null when Korbly has
 * no supported valuation. It deliberately reads `korblyValuation`: an analyst assumption has no market source, and must never be
 * given one (or be shown beside an unrelated observation that happens to share the valuation date).
 */
export async function getPositionProvenance(row: PositionRow): Promise<InputProvenance | null> {
  if (row.korblyValuation.status !== "VALUED") return null;
  const prisma = getPrisma();
  if (row.korblyValuation.detail.assetClass === "BOND" && row.instrument.kind === "BOND") {
    const obs = await prisma.fixedIncomeObservation.findUnique({
      where: { securityId_observationDate: { securityId: row.instrument.id, observationDate: new Date(`${row.korblyValuation.detail.observationDate}T00:00:00.000Z`) } },
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
  if (row.korblyValuation.detail.assetClass === "TREASURY_BILL" && row.instrument.kind === "TREASURY_BILL") {
    const d = row.korblyValuation.detail;
    const auctionDate = new Date(`${d.rateObservationDate}T00:00:00.000Z`);
    const rates = await prisma.treasuryRate.findMany({
      where: { observationDate: auctionDate, instrument: { tenorDays: { in: d.nodes.map((n) => n.tenorDays) } } },
      include: { instrument: { select: { tenorDays: true } }, source: { select: { name: true } } },
      orderBy: { instrument: { tenorDays: "asc" } },
    });
    if (rates.length === 0) return null;
    const newest = rates.reduce((a, b) => (a.retrievedAt > b.retrievedAt ? a : b));
    return {
      sourceName: newest.source.name,
      ingestionRunId: newest.ingestionRunId,
      retrievedAt: newest.retrievedAt.toISOString(),
      facts: [
        { label: "Evidence type", value: "Bank of Ghana primary-auction rates (not a secondary-market quote)" },
        { label: "Auction date", value: d.rateObservationDate },
        ...rates.map((r) => ({ label: `${r.instrument.tenorDays}-day bill, tender ${r.tenderNumber ?? "—"}`, value: `interest rate ${fmtNum(r.interestRate, 4)}% · discount rate ${fmtNum(r.discountRate, 4)}%` })),
        { label: "Rate used for this bill", value: `${fmtNum(d.referenceRatePct, 4)}% — ${d.methodDescription}` },
      ],
    };
  }
  if (row.korblyValuation.detail.assetClass === "EQUITY" && row.instrument.kind === "EQUITY") {
    const price = await prisma.securityPrice.findUnique({
      where: { securityId_tradingDate: { securityId: row.instrument.id, tradingDate: new Date(`${row.korblyValuation.detail.priceDate}T00:00:00.000Z`) } },
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
