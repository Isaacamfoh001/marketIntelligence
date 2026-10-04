// ---------------------------------------------------------------------------
// Shared read queries for the Fixed Income domain (M7) — the ONE place
// Prisma querying for FixedIncomeSecurity/FixedIncomeObservation happens,
// mirroring companies.ts/equities.ts/market-data.ts. Combines stored data
// with the pure analytics engine in src/lib/fixed-income/ (M7 §19's
// pipeline: Fixed Income Data → Analytics → Security Analysis → UI).
//
// Treasury bills are read from the EXISTING Treasury domain (TreasuryRate/
// TreasuryInstrument via market-data.ts) rather than duplicated here — see
// FixedIncomeInstrumentType in schema.prisma.
//
// M7.3.1 — observation semantics:
//   - A security's MARKET OBSERVATION is its latest observation that is
//     not a carried price (tradeStatus TRADED, or null for sources that
//     don't report trading). GFIM NOT_TRADED rows repeat an earlier trade's
//     price and are surfaced only as `carriedPrice` provenance.
//   - Every market observation carries a quality assessment; only
//     analytics-eligible ones reach the curve, benchmarks, spreads,
//     opportunities and alternatives.
//   - Corporate spreads are DATE-MATCHED: the benchmark is an eligible
//     sovereign observation dated within BENCHMARK_DATE_WINDOW_DAYS of the
//     corporate observation (selectBenchmarkForObservation).
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { observationFreshness, type Freshness } from "../freshness";
import { TREASURY_INSTRUMENTS, getTreasurySnapshot } from "./market-data";
import {
  assessObservationQuality,
  benchmarkLabeller,
  buildSecurityAnalytics,
  buildSovereignYieldCurve,
  classifyInstrument,
  classifyLifecycle,
  computeDuration,
  computeSpreadBps,
  daysBetween,
  describeBenchmarkContext,
  isWithinCurveWindow,
  observationAgeDays,
  selectBenchmarkForObservation,
  solveObservedYtm,
  toValuationDate,
  treasuryBillToBondTerms,
  CURVE_MAX_AGE_DAYS,
  type BenchmarkContext,
  type BenchmarkSelection,
  type BondTerms,
  type ComparableRow,
  type FixedIncomeClassification,
  type ObservationIssue,
  type SecurityAnalytics,
  type SecurityLifecycle,
  type YieldCurvePoint,
} from "../fixed-income";

// ---------------------------------------------------------------------------
// Security identity + analytics
// ---------------------------------------------------------------------------

export interface CarriedPrice {
  cleanPrice: number | null;
  sourceYieldPct: number | null;
  /** The latest report date on which the source re-printed this carried price. */
  asOf: string;
}

export interface FixedIncomeSecurityRow {
  id: string;
  instrumentCode: string;
  isin: string | null;
  instrumentName: string;
  issuerName: string;
  companyTicker: string | null;
  instrumentType: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  classification: FixedIncomeClassification;
  currency: string;
  issueDate: string;
  maturityDate: string;
  couponType: "FIXED" | "FLOATING" | "ZERO_COUPON";
  couponRatePct: number | null;
  couponFrequency: "ANNUAL" | "SEMI_ANNUAL" | "QUARTERLY" | "MONTHLY" | null;
  faceValue: number;
  status: "ACTIVE" | "MATURED" | "CALLED" | "DEFAULTED";
  /** Date of the MARKET observation (latest real trade / reported price) — never a carried-price report date. */
  latestObservationDate: string | null;
  latestObservationVolumeGhs: number | null;
  latestObservationNumberOfTrades: number | null;
  /** The latest observation of ANY kind's raw price/yield as published — kept even after maturity (when `analytics` is empty) so historical research can show the final known quote. */
  latestObservationCleanPrice: number | null;
  latestObservationYieldPct: number | null;
  analytics: SecurityAnalytics;
  /** Derived from maturity vs valuation date — never from `status`, which the securities master leaves ACTIVE after maturity (M7.3 §4). */
  lifecycle: SecurityLifecycle;
  /**
   * Freshness of the market observation. Secondary bond trades are
   * sporadic, so they use the WEEKLY tolerance (current within 10 calendar
   * days — two trading weeks), not the business-day FX rule. MISSING when
   * the security has no market observation at all.
   */
  observationFreshness: Freshness;
  observationAgeDays: number | null;
  /** Data-integrity flag: some observation is dated on/after the contractual maturity. */
  observationAfterMaturity: boolean;
  /** True when the market observation passed every data-quality check — the only observations derived analytics may use. */
  analyticsEligible: boolean;
  /** A newer carried closing price the source keeps re-printing without a trade (provenance only — never a market price). */
  carriedPrice: CarriedPrice | null;
  /** When there is no market observation: the earliest date in our history from which the source has only carried prices for this security. */
  noTradeRecordedSince: string | null;
  /** Conflicts between the source's own description/maturity and the Securities Master's terms (affect every calculation, including scenarios). */
  termsIssues: ObservationIssue[];
  /** Contractual terms in the shape the analytics engine consumes (passed to client-side scenario/calculator components). */
  terms: BondTerms;
}

interface SecurityWithCompany {
  id: string;
  instrumentCode: string;
  isin: string | null;
  instrumentName: string;
  issuerName: string;
  company: { ticker: string | null } | null;
  instrumentType: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  classification: FixedIncomeClassification;
  currency: string;
  issueDate: Date;
  maturityDate: Date;
  couponType: "FIXED" | "FLOATING" | "ZERO_COUPON";
  couponRatePct: unknown;
  couponFrequency: "ANNUAL" | "SEMI_ANNUAL" | "QUARTERLY" | "MONTHLY" | null;
  faceValue: unknown;
  status: "ACTIVE" | "MATURED" | "CALLED" | "DEFAULTED";
}
interface ObservationRowShape {
  securityId: string;
  observationDate: Date;
  cleanPrice: unknown;
  sourceYieldPct: unknown;
  volumeTradedGhs: unknown;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET";
  tradeStatus: "TRADED" | "NOT_TRADED" | null;
  numberOfTrades: number | null;
  sourceSecurityDescription: string | null;
  sourceMaturityDate: Date | null;
}

const num = (v: unknown): number | null => (v !== null && v !== undefined ? Number(v) : null);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function toBondTerms(security: { issueDate: Date; maturityDate: Date; couponType: string; couponRatePct: unknown; couponFrequency: string | null; faceValue: unknown }): BondTerms {
  return {
    issueDate: security.issueDate,
    maturityDate: security.maturityDate,
    couponType: security.couponType as BondTerms["couponType"],
    couponRatePct: security.couponRatePct !== null ? Number(security.couponRatePct) : null,
    couponFrequency: security.couponFrequency as BondTerms["couponFrequency"],
    faceValue: Number(security.faceValue),
  };
}

const TERMS_ISSUE_CODES = new Set(["MATURITY_CONFLICT", "COUPON_CONFLICT", "MATURITY_DATE_ADJUSTMENT"]);

/**
 * The ONE place a FixedIncomeSecurity + its observations (newest first)
 * become a FixedIncomeSecurityRow — reused by the universe listing and the
 * single-security lookup so they can never compute analytics differently.
 */
function toSecurityRow(sec: SecurityWithCompany, observationsDesc: ObservationRowShape[], settlementDate: Date): FixedIncomeSecurityRow {
  const terms = toBondTerms(sec);
  const latestAny = observationsDesc[0] ?? null;
  const market = observationsDesc.find((o) => o.tradeStatus !== "NOT_TRADED") ?? null;

  const analytics = buildSecurityAnalytics(
    terms,
    market
      ? {
          observationDate: market.observationDate,
          cleanPrice: num(market.cleanPrice),
          sourceYieldPct: num(market.sourceYieldPct),
          observationKind: market.observationKind,
          tradeStatus: market.tradeStatus,
          sourceMaturityDate: market.sourceMaturityDate,
          sourceSecurityDescription: market.sourceSecurityDescription,
        }
      : null,
    settlementDate,
  );

  // Carried price: newer than the market observation (or the only kind there is).
  const carried = latestAny && latestAny.tradeStatus === "NOT_TRADED" && (!market || latestAny.observationDate > market.observationDate) ? latestAny : null;
  // With no market observation at all, the oldest stored row is the earliest report in which the source already showed only a carried price.
  const noTradeRecordedSince = !market && observationsDesc.length > 0 ? isoDay(observationsDesc[observationsDesc.length - 1].observationDate) : null;

  // Terms cross-check uses the newest observation carrying the source's own description/maturity (carried rows included — terms don't depend on trading).
  const withSourceTerms = observationsDesc.find((o) => o.sourceSecurityDescription !== null || o.sourceMaturityDate !== null);
  const termsIssues = withSourceTerms
    ? assessObservationQuality({
        terms,
        observationDate: withSourceTerms.observationDate,
        tradeStatus: null,
        cleanPrice: null,
        sourceYieldPct: null,
        sourceMaturityDate: withSourceTerms.sourceMaturityDate,
        sourceSecurityDescription: withSourceTerms.sourceSecurityDescription,
      }).issues.filter((i) => TERMS_ISSUE_CODES.has(i.code))
    : [];

  const marketDateIso = market ? isoDay(market.observationDate) : null;
  return {
    id: sec.id,
    instrumentCode: sec.instrumentCode,
    isin: sec.isin,
    instrumentName: sec.instrumentName,
    issuerName: sec.issuerName,
    companyTicker: sec.company?.ticker ?? null,
    instrumentType: sec.instrumentType,
    classification: sec.classification,
    currency: sec.currency,
    issueDate: isoDay(sec.issueDate),
    maturityDate: isoDay(sec.maturityDate),
    couponType: sec.couponType,
    couponRatePct: num(sec.couponRatePct),
    couponFrequency: sec.couponFrequency,
    faceValue: Number(sec.faceValue),
    status: sec.status,
    latestObservationDate: marketDateIso,
    latestObservationVolumeGhs: market ? num(market.volumeTradedGhs) : null,
    latestObservationNumberOfTrades: market?.numberOfTrades ?? null,
    latestObservationCleanPrice: latestAny ? num(latestAny.cleanPrice) : null,
    latestObservationYieldPct: latestAny ? num(latestAny.sourceYieldPct) : null,
    analytics,
    lifecycle: classifyLifecycle(sec.maturityDate, settlementDate),
    observationFreshness: observationFreshness("WEEKLY", market?.observationDate ?? null, settlementDate),
    observationAgeDays: observationAgeDays(marketDateIso, settlementDate),
    observationAfterMaturity: observationsDesc.some((o) => o.observationDate.getTime() >= sec.maturityDate.getTime()),
    analyticsEligible: analytics.quality?.analyticsEligible === true && analytics.ytmPct !== null,
    carriedPrice: carried ? { cleanPrice: num(carried.cleanPrice), sourceYieldPct: num(carried.sourceYieldPct), asOf: isoDay(carried.observationDate) } : null,
    noTradeRecordedSince,
    termsIssues,
    terms,
  };
}

const SECURITY_INCLUDE = { company: { select: { ticker: true } } } as const;

async function observationsBySecurity(securityIds: string[]): Promise<Map<string, ObservationRowShape[]>> {
  const rows = await getPrisma().fixedIncomeObservation.findMany({
    where: { securityId: { in: securityIds } },
    orderBy: { observationDate: "desc" },
    select: {
      securityId: true,
      observationDate: true,
      cleanPrice: true,
      sourceYieldPct: true,
      volumeTradedGhs: true,
      observationKind: true,
      tradeStatus: true,
      numberOfTrades: true,
      sourceSecurityDescription: true,
      sourceMaturityDate: true,
    },
  });
  const map = new Map<string, ObservationRowShape[]>();
  for (const r of rows) {
    const list = map.get(r.securityId) ?? [];
    list.push(r);
    map.set(r.securityId, list);
  }
  return map;
}

/** Every Fixed Income security (government + corporate bonds) with its market observation and computed analytics, as of `settlementDate` (defaults to today's UTC valuation date). */
export async function getFixedIncomeUniverse(settlementDate: Date = toValuationDate(new Date())): Promise<FixedIncomeSecurityRow[]> {
  const securities = await getPrisma().fixedIncomeSecurity.findMany({
    include: SECURITY_INCLUDE,
    orderBy: [{ classification: "asc" }, { maturityDate: "asc" }],
  });
  const obs = await observationsBySecurity(securities.map((s) => s.id));
  return securities.map((sec) => toSecurityRow(sec, obs.get(sec.id) ?? [], settlementDate));
}

export async function getFixedIncomeSecurityByCode(instrumentCode: string, settlementDate: Date = toValuationDate(new Date())): Promise<FixedIncomeSecurityRow | null> {
  const sec = await getPrisma().fixedIncomeSecurity.findUnique({ where: { instrumentCode }, include: SECURITY_INCLUDE });
  if (!sec) return null;
  const obs = await observationsBySecurity([sec.id]);
  return toSecurityRow(sec, obs.get(sec.id) ?? [], settlementDate);
}

export interface FixedIncomeObservationPoint {
  date: string;
  cleanPrice: number | null;
  yieldPct: number | null;
}

export interface FixedIncomeObservationRecord {
  date: string;
  cleanPrice: number | null;
  sourceYieldPct: number | null;
  volumeTradedGhs: number | null;
  numberOfTrades: number | null;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET";
  tradeStatus: "TRADED" | "NOT_TRADED" | null;
  sourceSecurityDescription: string | null;
  sourceName: string;
  ingestionRunId: string;
  retrievedAt: string;
}

/** Price/yield history of real trades only (carried prices excluded — they would draw a flat line that never traded), ascending — for the history charts. */
export async function getFixedIncomeObservationHistory(securityId: string): Promise<FixedIncomeObservationPoint[]> {
  const rows = await getPrisma().fixedIncomeObservation.findMany({
    where: { securityId, OR: [{ tradeStatus: null }, { tradeStatus: "TRADED" }] },
    orderBy: { observationDate: "asc" },
  });
  return rows.map((r) => ({ date: isoDay(r.observationDate), cleanPrice: num(r.cleanPrice), yieldPct: num(r.sourceYieldPct) }));
}

/** The most recent observations of every kind with full provenance (source, ingestion run) — for the security page's provenance panel. */
export async function getFixedIncomeObservationRecords(securityId: string, limit = 12): Promise<FixedIncomeObservationRecord[]> {
  const rows = await getPrisma().fixedIncomeObservation.findMany({
    where: { securityId },
    orderBy: { observationDate: "desc" },
    take: limit,
    include: { source: { select: { name: true } } },
  });
  return rows.map((r) => ({
    date: isoDay(r.observationDate),
    cleanPrice: num(r.cleanPrice),
    sourceYieldPct: num(r.sourceYieldPct),
    volumeTradedGhs: num(r.volumeTradedGhs),
    numberOfTrades: r.numberOfTrades,
    observationKind: r.observationKind,
    tradeStatus: r.tradeStatus,
    sourceSecurityDescription: r.sourceSecurityDescription,
    sourceName: r.source.name,
    ingestionRunId: r.ingestionRunId,
    retrievedAt: r.retrievedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Sovereign observations — the pool for the curve and benchmarks (M7.3.1).
// ---------------------------------------------------------------------------

/** A government bond whose latest market observation is NOT drawn on the curve, and why — so exclusions are inspectable, never silent. */
export interface ExcludedCurvePoint {
  instrumentCode: string;
  instrumentLabel: string;
  observationDate: string | null;
  reason: string;
}

export interface SovereignCurve {
  /** Eligible points drawn on today's curve (latest per security, within CURVE_MAX_AGE_DAYS) plus the latest T-bill auctions. */
  points: YieldCurvePoint[];
  excluded: ExcludedCurvePoint[];
  /** Every eligible sovereign observation in history (bond trades + T-bill auctions), tenor measured at each observation's own date — the benchmark pool. */
  pool: YieldCurvePoint[];
}

function tenorLabel(days: number): string {
  return days < 365 ? `${Math.max(1, Math.round(days / 30.4375))}M` : `${Math.round(days / 365)}Y`;
}

async function buildSovereignCurve(settlementDate: Date, universe: FixedIncomeSecurityRow[]): Promise<SovereignCurve> {
  const valuationIso = isoDay(settlementDate);
  const pool: YieldCurvePoint[] = [];
  const points: YieldCurvePoint[] = [];

  // --- Treasury bills: every BoG auction result is an eligible PRIMARY point (official clearing rate).
  const treasurySnapshot = await getTreasurySnapshot();
  for (const { code, label } of TREASURY_INSTRUMENTS) {
    const snapshot = treasurySnapshot.find((t) => t.code === code);
    const instrument = await getPrisma().treasuryInstrument.findUnique({ where: { code } });
    if (!snapshot || !instrument) continue;
    let latest: YieldCurvePoint | null = null;
    // snapshot.history is the full auction series as {date, value = interest rate %}.
    for (const rate of snapshot.history) {
      if (rate.date > valuationIso) continue;
      const point: YieldCurvePoint = {
        tenorDays: instrument.tenorDays,
        tenorLabel: label,
        yieldPct: rate.value,
        instrumentLabel: `${label} T-Bill`,
        instrumentCode: null,
        isGovernmentBond: false,
        observationDate: rate.date,
        // The BoG weekly auction rate is always a PRIMARY rate.
        observationKind: "AUCTION_PRIMARY",
      };
      pool.push(point);
      if (!latest || point.observationDate > latest.observationDate) latest = point;
    }
    if (latest && isWithinCurveWindow(latest.observationDate, valuationIso)) points.push(latest);
  }

  // --- Government bonds: every eligible market observation in history.
  const govRows = universe.filter((s) => s.instrumentType === "GOVERNMENT_BOND");
  const govObs = await observationsBySecurity(govRows.map((s) => s.id));
  for (const s of govRows) {
    for (const o of govObs.get(s.id) ?? []) {
      if (o.tradeStatus === "NOT_TRADED" || o.observationDate.getTime() > settlementDate.getTime()) continue;
      const quality = assessObservationQuality({
        terms: s.terms,
        observationDate: o.observationDate,
        tradeStatus: o.tradeStatus,
        cleanPrice: num(o.cleanPrice),
        sourceYieldPct: num(o.sourceYieldPct),
        sourceMaturityDate: o.sourceMaturityDate,
        sourceSecurityDescription: o.sourceSecurityDescription,
      });
      if (!quality.analyticsEligible) continue;
      const price = num(o.cleanPrice);
      const solved = price !== null ? solveObservedYtm(s.terms, o.observationDate, price) : null;
      const yieldPct = solved ? (solved.ok ? solved.ytmPct : null) : num(o.sourceYieldPct);
      if (yieldPct === null) continue;
      const tenorDays = daysBetween(o.observationDate, s.terms.maturityDate);
      pool.push({
        tenorDays,
        tenorLabel: tenorLabel(tenorDays),
        yieldPct,
        instrumentLabel: s.instrumentName,
        instrumentCode: s.instrumentCode,
        isGovernmentBond: true,
        observationDate: isoDay(o.observationDate),
        observationKind: o.observationKind,
      });
    }
  }

  // --- Today's curve: each outstanding bond's MARKET observation, if eligible and recent.
  const excluded: ExcludedCurvePoint[] = [];
  for (const s of govRows) {
    if (s.lifecycle === "MATURED") continue;
    const label = s.instrumentName;
    if (!s.latestObservationDate) {
      excluded.push({
        instrumentCode: s.instrumentCode,
        instrumentLabel: label,
        observationDate: null,
        reason: s.noTradeRecordedSince ? `No trade recorded since at least ${s.noTradeRecordedSince}` : "No market observation",
      });
      continue;
    }
    if (!s.analyticsEligible) {
      const why = s.analytics.quality?.issues.filter((i) => i.severity !== "INFO").map((i) => i.label).join(", ") || "Yield not computable";
      excluded.push({ instrumentCode: s.instrumentCode, instrumentLabel: label, observationDate: s.latestObservationDate, reason: `Data quality: ${why}` });
      continue;
    }
    if (!isWithinCurveWindow(s.latestObservationDate, valuationIso)) {
      excluded.push({ instrumentCode: s.instrumentCode, instrumentLabel: label, observationDate: s.latestObservationDate, reason: `Last trade older than ${CURVE_MAX_AGE_DAYS} days` });
      continue;
    }
    points.push({
      tenorDays: s.analytics.tenorDays,
      tenorLabel: tenorLabel(s.analytics.tenorDays),
      yieldPct: s.analytics.ytmPct!,
      instrumentLabel: label,
      instrumentCode: s.instrumentCode,
      isGovernmentBond: true,
      observationDate: s.latestObservationDate,
      observationKind: s.analytics.observationKind ?? "SECONDARY_MARKET",
    });
  }

  return { points: buildSovereignYieldCurve(points), excluded, pool };
}

/** `universe` may be passed when the caller already loaded it for the same settlement date, avoiding a second full universe query. */
export async function getSovereignYieldCurve(settlementDate: Date = toValuationDate(new Date()), universe?: FixedIncomeSecurityRow[]): Promise<YieldCurvePoint[]> {
  const rows = universe ?? (await getFixedIncomeUniverse(settlementDate));
  return (await buildSovereignCurve(settlementDate, rows)).points;
}

// ---------------------------------------------------------------------------
// Decision workspace — one load of the universe, curve, benchmarks and
// comparables, shared by the landing page, Compare, and Security Detail.
// ---------------------------------------------------------------------------

export interface BenchmarkedSecurity extends FixedIncomeSecurityRow {
  /**
   * Date-matched sovereign benchmark for an eligible CORPORATE market
   * observation (null for sovereigns, matured, unquoted, ineligible, or
   * when no eligible sovereign observation lies within the date window —
   * "Suitable benchmark unavailable").
   */
  benchmark: BenchmarkSelection | null;
  /** Observed YTM minus the date-matched benchmark yield, in bps. Null whenever `benchmark` is null. */
  spreadBps: number | null;
  /** The nearest-tenor sovereign benchmark as of the VALUATION date — compares today's scenario returns with today's government yields, for any outstanding corporate. */
  currentBenchmark: BenchmarkSelection | null;
}

export interface WorkspaceSecurity extends BenchmarkedSecurity {
  /**
   * How the benchmark figures may be presented (M7.3.2 §8): an OBSERVED
   * SPREAD (date-matched, the corporate really traded) or a REFERENCE
   * government yield (context only — no spread exists). Derived from the
   * fields above by describeBenchmarkContext; labelled with the full universe
   * so a benchmark bond reads "GoG 19.25% Jan-27", not a database string.
   */
  benchmarkContext: BenchmarkContext;
}

export interface FixedIncomeWorkspace {
  valuationDateIso: string;
  securities: WorkspaceSecurity[];
  curve: YieldCurvePoint[];
  excludedCurvePoints: ExcludedCurvePoint[];
  comparables: ComparableRow[];
}

export function attachBenchmarks(row: FixedIncomeSecurityRow, pool: YieldCurvePoint[], valuationIso: string): BenchmarkedSecurity {
  if (row.classification !== "CORPORATE" || row.lifecycle === "MATURED") return { ...row, benchmark: null, spreadBps: null, currentBenchmark: null };
  const currentBenchmark = selectBenchmarkForObservation(row.analytics.tenorDays, valuationIso, pool);
  if (!row.analyticsEligible || !row.latestObservationDate) return { ...row, benchmark: null, spreadBps: null, currentBenchmark };
  const tenorAtObservation = daysBetween(new Date(`${row.latestObservationDate}T00:00:00.000Z`), row.terms.maturityDate);
  const benchmark = selectBenchmarkForObservation(tenorAtObservation, row.latestObservationDate, pool);
  const spreadBps = benchmark ? computeSpreadBps(row.analytics.ytmPct!, benchmark.benchmark.yieldPct) : null;
  return { ...row, benchmark, spreadBps, currentBenchmark };
}

function toComparableRow(s: BenchmarkedSecurity): ComparableRow {
  return {
    instrumentCode: s.instrumentCode,
    instrumentName: s.instrumentName,
    issuerName: s.issuerName,
    classification: s.classification,
    instrumentType: s.instrumentType,
    maturityDate: s.maturityDate,
    couponRatePct: s.couponRatePct,
    tenorDays: s.analytics.tenorDays,
    ytmPct: s.analytics.ytmPct,
    currentYieldPct: s.analytics.currentYieldPct,
    modifiedDurationYears: s.analytics.modifiedDurationYears,
    dv01: s.analytics.dv01,
    spreadBps: s.spreadBps,
    observationDate: s.latestObservationDate,
    observationKind: s.analytics.observationKind,
    freshness: s.observationFreshness,
    analyticsEligible: s.analyticsEligible,
  };
}

async function treasuryBillComparables(settlementDate: Date): Promise<ComparableRow[]> {
  const prisma = getPrisma();
  const treasurySnapshot = await getTreasurySnapshot();
  const billRows: ComparableRow[] = [];
  for (const { code, label } of TREASURY_INSTRUMENTS) {
    const snapshot = treasurySnapshot.find((t) => t.code === code);
    const [latest] = snapshot?.latestTwo ?? [];
    if (!latest) continue;
    const instrument = await prisma.treasuryInstrument.findUnique({ where: { code } });
    if (!instrument) continue;
    const terms = treasuryBillToBondTerms(latest.observationDate, instrument.tenorDays);
    const ytmPct = Number(latest.interestRate);
    const durationResult = computeDuration(terms, settlementDate, ytmPct);
    billRows.push({
      instrumentCode: `TBILL-${code}`,
      instrumentName: `${label} Treasury Bill`,
      issuerName: "Government of Ghana",
      classification: "SOVEREIGN",
      instrumentType: "TREASURY_BILL",
      maturityDate: isoDay(new Date(latest.observationDate.getTime() + instrument.tenorDays * 24 * 60 * 60 * 1000)),
      couponRatePct: null,
      // A new bill bought at auction runs its full tenor.
      tenorDays: instrument.tenorDays,
      ytmPct,
      currentYieldPct: null,
      modifiedDurationYears: durationResult.ok ? durationResult.modifiedDurationYears : null,
      dv01: durationResult.ok ? durationResult.dv01 : null,
      spreadBps: null,
      observationDate: isoDay(latest.observationDate),
      observationKind: "AUCTION_PRIMARY",
      // Weekly BoG auctions — judged on the weekly cadence.
      freshness: observationFreshness("WEEKLY", latest.observationDate, settlementDate),
      analyticsEligible: true,
    });
  }
  return billRows;
}

export async function getFixedIncomeWorkspace(valuationDate: Date = toValuationDate(new Date())): Promise<FixedIncomeWorkspace> {
  const valuationIso = isoDay(valuationDate);
  const universe = await getFixedIncomeUniverse(valuationDate);
  const curve = await buildSovereignCurve(valuationDate, universe);
  const labelOf = benchmarkLabeller(universe);
  const securities = universe.map((row): WorkspaceSecurity => {
    const attached = attachBenchmarks(row, curve.pool, valuationIso);
    return { ...attached, benchmarkContext: describeBenchmarkContext(attached, labelOf) };
  });
  const comparables = [...securities.map(toComparableRow), ...(await treasuryBillComparables(valuationDate))];
  return { valuationDateIso: valuationIso, securities, curve: curve.points, excludedCurvePoints: curve.excluded, comparables };
}

/** Comparable rows (bonds + Treasury bills), computed exactly as the workspace does. */
export async function getComparableUniverse(settlementDate: Date = toValuationDate(new Date())): Promise<ComparableRow[]> {
  return (await getFixedIncomeWorkspace(settlementDate)).comparables;
}

export { classifyInstrument };
