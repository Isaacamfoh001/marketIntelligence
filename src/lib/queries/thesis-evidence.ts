// ---------------------------------------------------------------------------
// Korbly observations as thesis evidence (M9.2). This module READS existing observation tables and
// freezes what it finds into an EvidenceSnapshot; it never writes market data and never copies a value
// into a free-text field. Linking works the same for every dataset: (kind, dataset key, date) → one row.
//
// Only observations that are real market/official facts can be linked: an equity day with no shares
// traded, or a bond row the source marks NOT_TRADED, is a carried price rather than a dated observation
// (the same rule the portfolio valuation uses), so it is refused rather than linked with a quality flag.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { observationFreshness, type Cadence } from "../freshness";
import { EQUITY_RECENT_WINDOW_DAYS } from "../portfolio/types";
import { buildSnapshot, formatDay, type EvidenceRefKind, type EvidenceSnapshot, type SnapshotArgs, type SnapshotSource } from "../thesis";

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v);
const pct = (v: unknown, dp = 2) => `${num(v).toFixed(dp)}%`;
const ghs = (v: unknown, dp = 2) => `GHS ${num(v).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const MACRO_UNIT_SUFFIX = (unit: string) => (unit === "%" ? "%" : ` ${unit}`);

type Described = { ok: true; refId: string; observationDate: string; snapshot: EvidenceSnapshot } | { ok: false; error: string };
type Run = { id: string; acquisitionMethod: string | null };
type Src = { name: string; provider: string };
const source = (src: Src, run: Run, retrievedAt: Date): SnapshotSource => ({ name: src.name, provider: src.provider, ingestionRunId: run.id, retrievedAt: retrievedAt.toISOString(), acquisitionMethod: run.acquisitionMethod });
const done = (refId: string, args: Omit<SnapshotArgs, "refKind"> & { refKind: EvidenceRefKind }): Described => ({ ok: true, refId, observationDate: args.observationDate, snapshot: buildSnapshot(args) });

/** Reads one observation row and freezes it. `now` is injectable for tests. */
export async function describeObservation(kind: EvidenceRefKind, id: string, now: Date = new Date()): Promise<Described> {
  const prisma = getPrisma();
  const missing: Described = { ok: false, error: "That Korbly observation no longer exists, so it cannot be linked." };
  switch (kind) {
    case "MACRO_OBSERVATION": {
      const o = await prisma.macroObservation.findUnique({ where: { id }, include: { series: { include: { source: true } }, ingestionRun: true } });
      if (!o) return missing;
      const date = day(o.observationDate);
      return done(o.id, { refKind: kind, datasetLabel: o.series.name, displayValue: `${num(o.value).toFixed(2)}${MACRO_UNIT_SUFFIX(o.series.unit)}`, unit: o.series.unit, observationDate: date, details: [{ label: "Frequency", value: o.series.frequency.toLowerCase().replace("_", " ") }, ...(o.revisionStatus ? [{ label: "Revision status", value: o.revisionStatus }] : [])], source: source(o.series.source, o.ingestionRun, o.retrievedAt), fingerprint: `${num(o.value)}|${o.revisionStatus ?? ""}`, stale: observationFreshness(o.series.frequency as Cadence, o.observationDate, now) === "STALE", now });
    }
    case "POLICY_DECISION": {
      const o = await prisma.policyDecision.findUnique({ where: { id }, include: { source: true, ingestionRun: true } });
      if (!o) return missing;
      return done(o.id, { refKind: kind, datasetLabel: "Bank of Ghana policy rate (MPR) decision", displayValue: pct(o.resultingRate), unit: "%", observationDate: day(o.decisionDate), details: [{ label: "Decision", value: o.decisionType.toLowerCase() }, { label: "Change", value: o.changeBps === null ? "First decision on record" : `${o.changeBps > 0 ? "+" : ""}${o.changeBps} bps` }], source: source(o.source, o.ingestionRun, o.retrievedAt), fingerprint: `${num(o.resultingRate)}|${o.decisionType}|${o.changeBps}`, stale: false, now });
    }
    case "TREASURY_RATE": {
      const o = await prisma.treasuryRate.findUnique({ where: { id }, include: { instrument: true, source: true, ingestionRun: true } });
      if (!o) return missing;
      return done(o.id, { refKind: kind, datasetLabel: `${o.instrument.tenorDays}-day Treasury bill auction rate`, displayValue: pct(o.interestRate), unit: "%", observationDate: day(o.observationDate), details: [{ label: "Discount rate", value: pct(o.discountRate) }, ...(o.tenderNumber ? [{ label: "Tender", value: o.tenderNumber }] : [])], source: source(o.source, o.ingestionRun, o.retrievedAt), fingerprint: `${num(o.interestRate)}|${num(o.discountRate)}`, stale: observationFreshness("WEEKLY", o.observationDate, now) === "STALE", now });
    }
    case "FX_RATE": {
      const o = await prisma.exchangeRate.findUnique({ where: { id }, include: { currencyPair: true, source: true, ingestionRun: true } });
      if (!o) return missing;
      const p = o.currencyPair;
      return done(o.id, { refKind: kind, datasetLabel: `${p.baseCurrency}/${p.quoteCurrency} mid rate`, displayValue: `${num(o.midRate).toFixed(4)} ${p.quoteCurrency} per ${p.baseCurrency}`, unit: `${p.quoteCurrency} per ${p.baseCurrency}`, observationDate: day(o.observationDate), details: [...(o.buyingRate ? [{ label: "Buying", value: num(o.buyingRate).toFixed(4) }] : []), ...(o.sellingRate ? [{ label: "Selling", value: num(o.sellingRate).toFixed(4) }] : [])], source: source(o.source, o.ingestionRun, o.retrievedAt), fingerprint: `${num(o.midRate)}|${num(o.buyingRate)}|${num(o.sellingRate)}`, stale: observationFreshness("DAILY", o.observationDate, now) === "STALE", now });
    }
    case "EQUITY_PRICE": {
      const o = await prisma.securityPrice.findUnique({ where: { id }, include: { security: { include: { company: { select: { name: true } } } }, source: true, ingestionRun: true } });
      if (!o) return missing;
      if (o.volume === null || o.volume <= BigInt(0)) return { ok: false, error: "No shares traded on that date, so its closing price is carried forward rather than an observation. Choose a day with trading." };
      const age = Math.max(0, Math.floor((now.getTime() - o.tradingDate.getTime()) / 86_400_000));
      return done(o.id, { refKind: kind, datasetLabel: `${o.security.company.name} (${o.security.ticker}) closing price`, displayValue: ghs(o.closeVwap), unit: "GHS per share", observationDate: day(o.tradingDate), details: [{ label: "Basis", value: "GSE volume-weighted closing price" }, { label: "Shares traded", value: Number(o.volume).toLocaleString("en-GB") }, ...(o.valueTradedGhs ? [{ label: "Value traded", value: ghs(o.valueTradedGhs) }] : [])], source: source(o.source, o.ingestionRun, o.retrievedAt), fingerprint: `${num(o.closeVwap)}|${o.volume}`, stale: age > EQUITY_RECENT_WINDOW_DAYS, now });
    }
    case "BOND_OBSERVATION": {
      const o = await prisma.fixedIncomeObservation.findUnique({ where: { id }, include: { security: true, source: true, ingestionRun: true } });
      if (!o) return missing;
      if (o.tradeStatus === "NOT_TRADED") return { ok: false, error: "The source reports no trade in this bond on that date, so the price is carried forward rather than an observation. Choose a traded date." };
      const head = o.sourceYieldPct !== null ? `${pct(o.sourceYieldPct)} yield` : o.cleanPrice !== null ? `${num(o.cleanPrice).toFixed(2)} clean price` : null;
      if (!head) return { ok: false, error: "That observation carries neither a yield nor a price, so there is nothing to link." };
      return done(o.id, { refKind: kind, datasetLabel: `${o.security.instrumentCode} ${o.observationKind === "AUCTION_PRIMARY" ? "auction" : "secondary-market"} observation`, displayValue: head, unit: o.sourceYieldPct !== null ? "% yield" : "clean price", observationDate: day(o.observationDate), details: [...(o.sourceYieldPct !== null ? [{ label: "Source yield", value: pct(o.sourceYieldPct) }] : []), ...(o.cleanPrice !== null ? [{ label: "Clean price", value: num(o.cleanPrice).toFixed(4) }] : []), ...(o.volumeTradedGhs ? [{ label: "Volume traded", value: ghs(o.volumeTradedGhs) }] : []), ...(o.numberOfTrades !== null ? [{ label: "Trades", value: String(o.numberOfTrades) }] : [])], source: source(o.source, o.ingestionRun, o.retrievedAt), fingerprint: `${num(o.sourceYieldPct)}|${num(o.cleanPrice)}|${num(o.volumeTradedGhs)}`, stale: observationFreshness("WEEKLY", o.observationDate, now) === "STALE", now });
    }
  }
}

/** For linked evidence still shown today: has the source published a different figure since? Returns the current headline when it has. */
export async function currentFigureIfRevised(items: { id: string; refKind: EvidenceRefKind; refId: string; fingerprint: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    items.map(async (i) => {
      const d = await describeObservation(i.refKind, i.refId);
      if (d.ok && d.snapshot.fingerprint !== i.fingerprint) out.set(i.id, d.snapshot.displayValue);
    }),
  );
  return out;
}

// --- Choosing what to link ---------------------------------------------------------------------------

export interface DatasetOption {
  /** "KIND:key" — one query-string value. */
  id: string;
  kind: EvidenceRefKind;
  key: string;
  label: string;
  group: "About this thesis" | "Macro" | "Rates & FX";
}
export interface ObservationOption {
  id: string;
  date: string;
  /** What the picker shows beside the date: the headline figure. */
  summary: string;
}

export const datasetId = (kind: EvidenceRefKind, key: string) => `${kind}:${key}`;
export function parseDatasetId(v: unknown): { kind: EvidenceRefKind; key: string } | null {
  if (typeof v !== "string") return null;
  const i = v.indexOf(":");
  const kind = v.slice(0, i);
  const key = v.slice(i + 1);
  return ["MACRO_OBSERVATION", "POLICY_DECISION", "TREASURY_RATE", "FX_RATE", "EQUITY_PRICE", "BOND_OBSERVATION"].includes(kind) && key !== "" ? { kind: kind as EvidenceRefKind, key } : null;
}

export async function listDatasets(subject: { ref: { type: "SECURITY" | "FIXED_INCOME" | "TREASURY_INSTRUMENT"; id: string }; label: string; sublabel: string }): Promise<DatasetOption[]> {
  const prisma = getPrisma();
  const [series, instruments, pairs] = await Promise.all([
    prisma.macroSeries.findMany({ where: { observations: { some: {} } }, orderBy: { name: "asc" }, select: { code: true, name: true } }),
    prisma.treasuryInstrument.findMany({ where: { instrumentType: "BILL" }, orderBy: { tenorDays: "asc" }, select: { id: true, tenorDays: true } }),
    prisma.currencyPair.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { code: true, baseCurrency: true, quoteCurrency: true } }),
  ]);
  const out: DatasetOption[] = [];
  if (subject.ref.type === "SECURITY") out.push({ id: datasetId("EQUITY_PRICE", subject.ref.id), kind: "EQUITY_PRICE", key: subject.ref.id, label: `${subject.label} — closing prices`, group: "About this thesis" });
  if (subject.ref.type === "FIXED_INCOME") out.push({ id: datasetId("BOND_OBSERVATION", subject.ref.id), kind: "BOND_OBSERVATION", key: subject.ref.id, label: `${subject.sublabel} — yield & price observations`, group: "About this thesis" });
  for (const s of series) out.push({ id: datasetId("MACRO_OBSERVATION", s.code), kind: "MACRO_OBSERVATION", key: s.code, label: s.name, group: "Macro" });
  out.push({ id: datasetId("POLICY_DECISION", "BOG"), kind: "POLICY_DECISION", key: "BOG", label: "Bank of Ghana policy rate (MPR) decisions", group: "Macro" });
  for (const t of instruments) out.push({ id: datasetId("TREASURY_RATE", t.id), kind: "TREASURY_RATE", key: t.id, label: `${t.tenorDays}-day Treasury bill auction rates`, group: "Rates & FX" });
  for (const p of pairs) out.push({ id: datasetId("FX_RATE", p.code), kind: "FX_RATE", key: p.code, label: `${p.baseCurrency}/${p.quoteCurrency} exchange rate`, group: "Rates & FX" });
  return out;
}

/** The most recent linkable observations of a dataset, newest first. */
export async function listObservations(kind: EvidenceRefKind, key: string, limit = 15): Promise<ObservationOption[]> {
  const prisma = getPrisma();
  switch (kind) {
    case "MACRO_OBSERVATION": {
      const rows = await prisma.macroObservation.findMany({ where: { series: { code: key } }, orderBy: { observationDate: "desc" }, take: limit, include: { series: { select: { unit: true } } } });
      return rows.map((r) => ({ id: r.id, date: day(r.observationDate), summary: `${num(r.value).toFixed(2)}${MACRO_UNIT_SUFFIX(r.series.unit)}` }));
    }
    case "POLICY_DECISION": {
      const rows = await prisma.policyDecision.findMany({ orderBy: { decisionDate: "desc" }, take: limit });
      return rows.map((r) => ({ id: r.id, date: day(r.decisionDate), summary: `${pct(r.resultingRate)} · ${r.decisionType.toLowerCase()}` }));
    }
    case "TREASURY_RATE": {
      const rows = await prisma.treasuryRate.findMany({ where: { instrumentId: key }, orderBy: { observationDate: "desc" }, take: limit });
      return rows.map((r) => ({ id: r.id, date: day(r.observationDate), summary: pct(r.interestRate) }));
    }
    case "FX_RATE": {
      const rows = await prisma.exchangeRate.findMany({ where: { currencyPair: { code: key } }, orderBy: { observationDate: "desc" }, take: limit });
      return rows.map((r) => ({ id: r.id, date: day(r.observationDate), summary: num(r.midRate).toFixed(4) }));
    }
    case "EQUITY_PRICE": {
      const rows = await prisma.securityPrice.findMany({ where: { securityId: key, volume: { gt: 0 } }, orderBy: { tradingDate: "desc" }, take: limit });
      return rows.map((r) => ({ id: r.id, date: day(r.tradingDate), summary: `${ghs(r.closeVwap)} · ${Number(r.volume).toLocaleString("en-GB")} shares` }));
    }
    case "BOND_OBSERVATION": {
      const rows = await prisma.fixedIncomeObservation.findMany({ where: { securityId: key, OR: [{ tradeStatus: null }, { tradeStatus: "TRADED" }] }, orderBy: { observationDate: "desc" }, take: limit });
      return rows.map((r) => ({ id: r.id, date: day(r.observationDate), summary: r.sourceYieldPct !== null ? `${pct(r.sourceYieldPct)} yield` : r.cleanPrice !== null ? `${num(r.cleanPrice).toFixed(2)} clean price` : "—" }));
    }
  }
}

/** Resolves a context fact ("latest actual trade on 2026-10-02") to the observation row behind it. */
export async function findObservationId(kind: EvidenceRefKind, key: string, date: string): Promise<string | null> {
  const prisma = getPrisma();
  const d = new Date(`${date}T00:00:00.000Z`);
  switch (kind) {
    case "MACRO_OBSERVATION": return (await prisma.macroObservation.findFirst({ where: { series: { code: key }, observationDate: d }, select: { id: true } }))?.id ?? null;
    case "POLICY_DECISION": return (await prisma.policyDecision.findFirst({ where: { decisionDate: d }, select: { id: true } }))?.id ?? null;
    case "TREASURY_RATE": return (await prisma.treasuryRate.findFirst({ where: { instrumentId: key, observationDate: d }, select: { id: true } }))?.id ?? null;
    case "FX_RATE": return (await prisma.exchangeRate.findFirst({ where: { currencyPair: { code: key }, observationDate: d }, select: { id: true } }))?.id ?? null;
    case "EQUITY_PRICE": return (await prisma.securityPrice.findFirst({ where: { securityId: key, tradingDate: d }, select: { id: true } }))?.id ?? null;
    case "BOND_OBSERVATION": return (await prisma.fixedIncomeObservation.findFirst({ where: { securityId: key, observationDate: d }, select: { id: true } }))?.id ?? null;
  }
}

export { formatDay };
