// ---------------------------------------------------------------------------
// Shared read queries for market-data snapshots (FX, Treasury, MPR).
//
// Used by both the Overview and Macro & Rates pages so the underlying
// Prisma queries are written once, not duplicated per page.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";

const FX_PAIR_CODE = "USDGHS";

export const TREASURY_INSTRUMENTS = [
  { code: "91_DAY_BILL", label: "91-Day" },
  { code: "182_DAY_BILL", label: "182-Day" },
  { code: "364_DAY_BILL", label: "364-Day" },
] as const;

export interface ChartPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------

export interface FxObservation {
  observationDate: Date;
  midRate: unknown;
  buyingRate: unknown;
  sellingRate: unknown;
}

export async function getUsdGhsSnapshot(): Promise<{ latestTwo: FxObservation[]; history: ChartPoint[] }> {
  const prisma = getPrisma();
  const pair = await prisma.currencyPair.findUnique({ where: { code: FX_PAIR_CODE } });
  if (!pair) return { latestTwo: [], history: [] };

  const [latestTwo, history] = await Promise.all([
    prisma.exchangeRate.findMany({
      where: { currencyPairId: pair.id },
      orderBy: { observationDate: "desc" },
      take: 2,
    }),
    prisma.exchangeRate.findMany({
      where: { currencyPairId: pair.id },
      orderBy: { observationDate: "asc" },
      select: { observationDate: true, midRate: true },
    }),
  ]);

  return {
    latestTwo,
    history: history.map((row) => ({ date: row.observationDate.toISOString().slice(0, 10), value: Number(row.midRate) })),
  };
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

export interface TreasuryObservation {
  observationDate: Date;
  interestRate: unknown;
  discountRate: unknown;
  tenderNumber: string | null;
}

export interface TreasuryInstrumentSnapshot {
  code: string;
  label: string;
  latestTwo: TreasuryObservation[];
  history: ChartPoint[];
}

export async function getTreasurySnapshot(): Promise<TreasuryInstrumentSnapshot[]> {
  const prisma = getPrisma();

  return Promise.all(
    TREASURY_INSTRUMENTS.map(async ({ code, label }) => {
      const instrument = await prisma.treasuryInstrument.findUnique({ where: { code } });
      if (!instrument) return { code, label, latestTwo: [], history: [] };

      const [latestTwo, history] = await Promise.all([
        prisma.treasuryRate.findMany({
          where: { instrumentId: instrument.id },
          orderBy: { observationDate: "desc" },
          take: 2,
        }),
        prisma.treasuryRate.findMany({
          where: { instrumentId: instrument.id },
          orderBy: { observationDate: "asc" },
          select: { observationDate: true, interestRate: true },
        }),
      ]);

      return {
        code,
        label,
        latestTwo,
        history: history.map((row) => ({ date: row.observationDate.toISOString().slice(0, 10), value: Number(row.interestRate) })),
      };
    }),
  );
}

export interface RecentTreasuryRow {
  observationDate: Date;
  instrumentLabel: string;
  tenderNumber: string | null;
  discountRate: unknown;
  interestRate: unknown;
}

/** Recent auction observations across all supported tenors, newest first. */
export async function getRecentTreasuryRates(limit: number = 20): Promise<RecentTreasuryRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.treasuryRate.findMany({
    where: { instrument: { code: { in: TREASURY_INSTRUMENTS.map((t) => t.code) } } },
    orderBy: [{ observationDate: "desc" }, { instrument: { tenorDays: "asc" } }],
    take: limit,
    include: { instrument: true },
  });
  const labelByCode = new Map<string, string>(TREASURY_INSTRUMENTS.map((t) => [t.code, t.label]));
  return rows.map((row) => ({
    observationDate: row.observationDate,
    instrumentLabel: labelByCode.get(row.instrument.code) ?? row.instrument.name,
    tenderNumber: row.tenderNumber,
    discountRate: row.discountRate,
    interestRate: row.interestRate,
  }));
}

// ---------------------------------------------------------------------------
// Monetary Policy Rate
//
// Backed by PolicyDecision, not MacroObservation — see prisma/schema.prisma
// for why. Distinguishes:
//   - latestDecision: the most recent MPC decision of any kind (may be a HOLD)
//   - lastChange: the most recent decision that actually changed the rate
// A HOLD latestDecision must never be presented as though the rate moved.
// ---------------------------------------------------------------------------

export interface PolicyDecisionRow {
  decisionDate: Date;
  resultingRate: unknown;
  decisionType: "HIKE" | "CUT" | "HOLD";
  changeBps: number | null;
}

export interface MprSnapshot {
  latestDecision: PolicyDecisionRow | null;
  lastChange: PolicyDecisionRow | null;
  history: ChartPoint[];
}

export async function getMprSnapshot(): Promise<MprSnapshot> {
  const prisma = getPrisma();

  const [latestDecision, lastChange, history] = await Promise.all([
    prisma.policyDecision.findFirst({ orderBy: { decisionDate: "desc" } }),
    prisma.policyDecision.findFirst({ where: { decisionType: { not: "HOLD" } }, orderBy: { decisionDate: "desc" } }),
    prisma.policyDecision.findMany({
      orderBy: { decisionDate: "asc" },
      select: { decisionDate: true, resultingRate: true },
    }),
  ]);

  return {
    latestDecision,
    lastChange,
    history: history.map((row) => ({ date: row.decisionDate.toISOString().slice(0, 10), value: Number(row.resultingRate) })),
  };
}

/** Recent MPC decisions, newest first — includes HOLDs. */
export async function getRecentMprDecisions(limit: number = 15): Promise<PolicyDecisionRow[]> {
  const prisma = getPrisma();
  return prisma.policyDecision.findMany({ orderBy: { decisionDate: "desc" }, take: limit });
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

export function formatObservationDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Basis-point change: (current − prior) × 100, for rates stored as percentage points. */
export function bpsChange(current: number, prior: number): number {
  return Math.round((current - prior) * 100);
}
