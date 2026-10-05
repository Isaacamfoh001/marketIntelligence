// ---------------------------------------------------------------------------
// GSE equity source status — one read model for Data Centre, Equities and the
// portfolio/scenario banners, so "is the equity data current?" has exactly one
// answer (see lib/equities/source-currency.ts for the semantics).
//
// `scope` exists for test isolation only: integration tests share one database
// with real data, so they restrict the read to their own synthetic tickers /
// ingestion runs. Production callers pass no scope.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import {
  classifyEquitySource,
  toIsoDay,
  type EquitySourceCurrency,
  type EquitySourceRunInfo,
} from "../equities/source-currency";

export const GSE_EQUITY_SOURCE_NAMES = [
  "Ghana Stock Exchange — Daily Shares & ETFs",
  "Ghana Stock Exchange — Market Report Backfill",
] as const;

/** A security absent from the latest report whose last row is older than this (vs the latest report date) is "dormant" rather than recently dropped. */
export const DORMANT_AFTER_DAYS = 30;

export interface EquitySourceScope {
  tickers?: string[];
  runIds?: string[];
}

export interface EquityRunSummary {
  runId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  artifactName: string | null;
  acquisitionMethod: string | null;
  triggeredBy: string | null;
  recordsRead: number | null;
  recordsAccepted: number | null;
  recordsRejected: number | null;
  errorMessage: string | null;
}

export interface EquityReportCoverage {
  reportDate: string;
  securitiesInReport: number;
  /** volume > 0: an actual trade on the report date. */
  withActualTrade: number;
  /** volume = 0: closeVwap is a carried previous close. */
  carriedNoTrade: number;
  /** volume null: not published; neither a trade nor a no-trade. */
  volumeUnknown: number;
}

export interface EquitySourceStatus {
  currency: EquitySourceCurrency;
  /** Newest date on which ANY security actually traded. */
  latestActualTradeDate: string | null;
  coverage: EquityReportCoverage | null;
  /** Active securities that appear in an earlier report but NOT in the latest one (suspended / delisted / dropped from the file). */
  absentFromLatestReport: { ticker: string; lastReportDate: string; /** No report row for more than DORMANT_AFTER_DAYS before the latest report: long gone, not a fresh drop. */ dormant: boolean }[];
  lastRun: EquityRunSummary | null;
  lastSuccessfulRun: EquityRunSummary | null;
  /** Provenance of the latest report date's rows (distinct runs). */
  latestReportRunIds: string[];
  now: Date;
}

export async function getEquitySourceStatus(opts: { now?: Date; scope?: EquitySourceScope } = {}): Promise<EquitySourceStatus> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const scope = opts.scope;
  const securityWhere = scope?.tickers ? { security: { ticker: { in: scope.tickers } } } : {};

  const latestRow = await prisma.securityPrice.findFirst({ where: securityWhere, orderBy: { tradingDate: "desc" }, select: { tradingDate: true } });
  const latestTradeRow = await prisma.securityPrice.findFirst({
    where: { ...securityWhere, volume: { gt: 0 } },
    orderBy: { tradingDate: "desc" },
    select: { tradingDate: true },
  });

  const runRows = await prisma.ingestionRun.findMany({
    where: {
      dataSource: { name: { in: [...GSE_EQUITY_SOURCE_NAMES] } },
      ...(scope?.runIds ? { id: { in: scope.runIds } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 25,
  });
  const toSummary = (r: (typeof runRows)[number]): EquityRunSummary => ({
    runId: r.id,
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    artifactName: r.artifactName,
    acquisitionMethod: r.acquisitionMethod,
    triggeredBy: r.triggeredBy,
    recordsRead: r.recordsRead,
    recordsAccepted: r.recordsAccepted,
    recordsRejected: r.recordsRejected,
    errorMessage: r.errorMessage,
  });
  const runInfos: EquitySourceRunInfo[] = runRows
    .filter((r) => r.status === "SUCCESS" || r.status === "FAILED" || r.status === "RUNNING" || r.status === "PENDING")
    .map((r) => ({ status: r.status as EquitySourceRunInfo["status"], at: r.completedAt ?? r.startedAt }));

  const latestReportDate = latestRow ? toIsoDay(latestRow.tradingDate) : null;
  const currency = classifyEquitySource({ latestReportDate, now, runs: runInfos });

  let coverage: EquityReportCoverage | null = null;
  let absent: EquitySourceStatus["absentFromLatestReport"] = [];
  let latestReportRunIds: string[] = [];
  if (latestRow) {
    const rows = await prisma.securityPrice.findMany({
      where: { ...securityWhere, tradingDate: latestRow.tradingDate },
      select: { volume: true, securityId: true, ingestionRunId: true },
    });
    coverage = {
      reportDate: latestReportDate!,
      securitiesInReport: rows.length,
      withActualTrade: rows.filter((r) => r.volume !== null && r.volume > BigInt(0)).length,
      carriedNoTrade: rows.filter((r) => r.volume !== null && r.volume === BigInt(0)).length,
      volumeUnknown: rows.filter((r) => r.volume === null).length,
    };
    latestReportRunIds = Array.from(new Set(rows.map((r) => r.ingestionRunId)));

    const present = new Set(rows.map((r) => r.securityId));
    const lastRows = await prisma.securityPrice.groupBy({
      by: ["securityId"],
      where: { ...securityWhere, security: { active: true, ...(scope?.tickers ? { ticker: { in: scope.tickers } } : {}) } },
      _max: { tradingDate: true },
    });
    const missingIds = lastRows.filter((r) => !present.has(r.securityId));
    if (missingIds.length > 0) {
      const secs = await prisma.security.findMany({ where: { id: { in: missingIds.map((m) => m.securityId) } }, select: { id: true, ticker: true } });
      const tickerById = new Map(secs.map((s) => [s.id, s.ticker]));
      absent = missingIds
        .map((m) => {
          const lastReportDate = toIsoDay(m._max.tradingDate!);
          const gapDays = (latestRow.tradingDate.getTime() - m._max.tradingDate!.getTime()) / 86_400_000;
          return { ticker: tickerById.get(m.securityId) ?? m.securityId, lastReportDate, dormant: gapDays > DORMANT_AFTER_DAYS };
        })
        .sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
  }

  const lastSuccess = runRows.find((r) => r.status === "SUCCESS");
  return {
    currency,
    latestActualTradeDate: latestTradeRow ? toIsoDay(latestTradeRow.tradingDate) : null,
    coverage,
    absentFromLatestReport: absent,
    lastRun: runRows[0] ? toSummary(runRows[0]) : null,
    lastSuccessfulRun: lastSuccess ? toSummary(lastSuccess) : null,
    latestReportRunIds,
    now,
  };
}
