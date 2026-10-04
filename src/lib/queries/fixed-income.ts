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
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { TREASURY_INSTRUMENTS, getTreasurySnapshot } from "./market-data";
import {
  buildSecurityAnalytics,
  buildSovereignYieldCurve,
  classifyInstrument,
  selectBenchmark,
  computeSpreadBps,
  treasuryBillToBondTerms,
  computeDuration,
  type SecurityAnalytics,
  type YieldCurvePoint,
  type BondTerms,
  type ComparableRow,
  type FixedIncomeClassification,
} from "../fixed-income";

// ---------------------------------------------------------------------------
// Security identity + analytics
// ---------------------------------------------------------------------------

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
  latestObservationDate: string | null;
  latestObservationVolumeGhs: number | null;
  analytics: SecurityAnalytics;
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
  observationDate: Date;
  cleanPrice: unknown;
  sourceYieldPct: unknown;
  volumeTradedGhs: unknown;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET";
}
type ObservationRow = ObservationRowShape | null;

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

/** The ONE place a FixedIncomeSecurity + its latest observation become a FixedIncomeSecurityRow — reused by both the universe listing and the single-security lookup so they can never compute analytics differently. */
function toSecurityRow(sec: SecurityWithCompany, latestObservation: ObservationRow, settlementDate: Date): FixedIncomeSecurityRow {
  const terms = toBondTerms(sec);
  const analytics = buildSecurityAnalytics(
    terms,
    latestObservation
      ? {
          observationDate: latestObservation.observationDate,
          cleanPrice: latestObservation.cleanPrice !== null ? Number(latestObservation.cleanPrice) : null,
          sourceYieldPct: latestObservation.sourceYieldPct !== null ? Number(latestObservation.sourceYieldPct) : null,
          observationKind: latestObservation.observationKind,
        }
      : null,
    settlementDate,
  );

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
    issueDate: sec.issueDate.toISOString().slice(0, 10),
    maturityDate: sec.maturityDate.toISOString().slice(0, 10),
    couponType: sec.couponType,
    couponRatePct: sec.couponRatePct !== null ? Number(sec.couponRatePct) : null,
    couponFrequency: sec.couponFrequency,
    faceValue: Number(sec.faceValue),
    status: sec.status,
    latestObservationDate: latestObservation ? latestObservation.observationDate.toISOString().slice(0, 10) : null,
    latestObservationVolumeGhs: latestObservation?.volumeTradedGhs !== null && latestObservation?.volumeTradedGhs !== undefined ? Number(latestObservation.volumeTradedGhs) : null,
    analytics,
  };
}

/** Every Fixed Income security (government + corporate bonds) with its latest observation and computed analytics, as of `settlementDate` (defaults to now). */
export async function getFixedIncomeUniverse(settlementDate: Date = new Date()): Promise<FixedIncomeSecurityRow[]> {
  const prisma = getPrisma();
  const securities = await prisma.fixedIncomeSecurity.findMany({
    include: { company: { select: { ticker: true } } },
    orderBy: [{ classification: "asc" }, { maturityDate: "asc" }],
  });

  return Promise.all(
    securities.map(async (sec) => {
      const latestObservation = await prisma.fixedIncomeObservation.findFirst({
        where: { securityId: sec.id },
        orderBy: { observationDate: "desc" },
      });
      return toSecurityRow(sec, latestObservation, settlementDate);
    }),
  );
}

export async function getFixedIncomeSecurityByCode(instrumentCode: string, settlementDate: Date = new Date()): Promise<FixedIncomeSecurityRow | null> {
  const prisma = getPrisma();
  const sec = await prisma.fixedIncomeSecurity.findUnique({
    where: { instrumentCode },
    include: { company: { select: { ticker: true } } },
  });
  if (!sec) return null;

  const latestObservation = await prisma.fixedIncomeObservation.findFirst({
    where: { securityId: sec.id },
    orderBy: { observationDate: "desc" },
  });

  return toSecurityRow(sec, latestObservation, settlementDate);
}

export interface FixedIncomeObservationPoint {
  date: string;
  cleanPrice: number | null;
  yieldPct: number | null;
}

/** Full observation history for one security, ascending by date — for the price/yield chart. */
export async function getFixedIncomeObservationHistory(securityId: string): Promise<FixedIncomeObservationPoint[]> {
  const prisma = getPrisma();
  const rows = await prisma.fixedIncomeObservation.findMany({
    where: { securityId },
    orderBy: { observationDate: "asc" },
  });
  return rows.map((r) => ({
    date: r.observationDate.toISOString().slice(0, 10),
    cleanPrice: r.cleanPrice !== null ? Number(r.cleanPrice) : null,
    yieldPct: r.sourceYieldPct !== null ? Number(r.sourceYieldPct) : null,
  }));
}

// ---------------------------------------------------------------------------
// Ghana sovereign yield curve (M7 §11) — Treasury bills (existing domain)
// plus Government Bonds (new domain), observed points only.
// ---------------------------------------------------------------------------

export async function getSovereignYieldCurve(settlementDate: Date = new Date()): Promise<YieldCurvePoint[]> {
  const treasurySnapshot = await getTreasurySnapshot();
  const billPoints: YieldCurvePoint[] = [];
  for (const { code, label } of TREASURY_INSTRUMENTS) {
    const snapshot = treasurySnapshot.find((t) => t.code === code);
    const [latest] = snapshot?.latestTwo ?? [];
    if (!latest) continue;
    const instrument = await getPrisma().treasuryInstrument.findUnique({ where: { code } });
    if (!instrument) continue;
    billPoints.push({
      tenorDays: instrument.tenorDays,
      tenorLabel: label,
      yieldPct: Number(latest.interestRate),
      instrumentLabel: `${label} T-Bill`,
      instrumentCode: null,
      isGovernmentBond: false,
      observationDate: latest.observationDate.toISOString().slice(0, 10),
      // The BoG weekly auction rate is always a PRIMARY rate — Ghana's
      // T-bills are not quoted on the GFIM secondary-market trading report.
      observationKind: "AUCTION_PRIMARY",
    });
  }

  const universe = await getFixedIncomeUniverse(settlementDate);
  const bondPoints: YieldCurvePoint[] = universe
    .filter((s) => s.instrumentType === "GOVERNMENT_BOND" && s.analytics.ytmPct !== null && !s.analytics.isMatured)
    .map((s) => ({
      tenorDays: s.analytics.tenorDays,
      tenorLabel: `${Math.round(s.analytics.tenorDays / 365)}Y`,
      yieldPct: s.analytics.ytmPct!,
      instrumentLabel: s.instrumentName,
      instrumentCode: s.instrumentCode,
      isGovernmentBond: true,
      observationDate: s.latestObservationDate!,
      observationKind: s.analytics.observationKind ?? "AUCTION_PRIMARY",
    }));

  return buildSovereignYieldCurve([...billPoints, ...bondPoints]);
}

// ---------------------------------------------------------------------------
// Comparables universe (M7 §14) — bonds + Treasury bills, unified.
// ---------------------------------------------------------------------------

export async function getComparableUniverse(settlementDate: Date = new Date()): Promise<ComparableRow[]> {
  const universe = await getFixedIncomeUniverse(settlementDate);
  const curve = await getSovereignYieldCurve(settlementDate);

  const bondRows: ComparableRow[] = universe.map((s) => {
    const benchmark = s.analytics.ytmPct !== null ? selectBenchmark(s.analytics.tenorDays, curve.filter((p) => p.instrumentCode !== s.instrumentCode)) : null;
    return {
      instrumentCode: s.instrumentCode,
      instrumentName: s.instrumentName,
      issuerName: s.issuerName,
      classification: s.classification,
      instrumentType: s.instrumentType,
      maturityDate: s.maturityDate,
      tenorDays: s.analytics.tenorDays,
      ytmPct: s.analytics.ytmPct,
      currentYieldPct: s.analytics.currentYieldPct,
      modifiedDurationYears: s.analytics.modifiedDurationYears,
      dv01: s.analytics.dv01,
      spreadBps: benchmark && s.classification === "CORPORATE" ? computeSpreadBps(s.analytics.ytmPct!, benchmark.benchmark.yieldPct) : null,
      observationDate: s.latestObservationDate,
      observationKind: s.analytics.observationKind,
    };
  });

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
      maturityDate: new Date(latest.observationDate.getTime() + instrument.tenorDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      tenorDays: instrument.tenorDays,
      ytmPct,
      currentYieldPct: null,
      modifiedDurationYears: durationResult.ok ? durationResult.modifiedDurationYears : null,
      dv01: durationResult.ok ? durationResult.dv01 : null,
      spreadBps: null,
      observationDate: latest.observationDate.toISOString().slice(0, 10),
      observationKind: "AUCTION_PRIMARY",
    });
  }

  return [...bondRows, ...billRows];
}

export { classifyInstrument };
