// ---------------------------------------------------------------------------
// Company Financials — import provider (M7).
//
// Source reality: GSE's own site (which publishes listed-company financial
// statements alongside market data) is blocked to this agent by the same
// site-wide robots.txt opt-out documented in gse-security-provider.ts.
// Issuer investor-relations sites vary — some are reachable, at least one
// showed an active bot-verification challenge during discovery, which is
// exactly the kind of technical access control this project does not
// attempt to defeat. Combined with the much higher correctness stakes of
// financial-statement figures (CLAUDE.md/M7 §39: "Never allow an LLM/PDF
// parser to silently write financial values into production"), this
// milestone does not attempt automated PDF extraction at all. This is
// Mode B/C only: an analyst transcribes verified figures from an official
// statement into the long-format CSV/Excel template and imports them
// through the same validated preview/confirm pipeline as GSE market data.
//
// Single shared DataSource across every company (CLAUDE.md/M7 §37: "one
// well-structured source + artifact provenance is cleaner" than a
// DataSource per issuer) — Company + FinancialPeriod already disambiguate
// which company/period each observation belongs to; the artifactName on
// each IngestionRun records which specific file supplied it.
//
// Idempotency/restatement rule (M7 §20/§21): no source-priority tiers
// here (unlike GSE's daily-vs-backfill) — a re-import always upserts in
// place, and a changed value is reported as a "restatement" (not
// silently applied) so an analyst can see exactly what moved.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { parseImportFile } from "./file-parse";
import { extractFinancialRows, validateFinancialRows, type NormalisedFinancialRow, type RawFinancialRow } from "./financials-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";
import { KNOWN_COMPANY_NAMES, KNOWN_COMPANY_SECTORS } from "../gse-known-companies";
import { FINANCIAL_METRICS, unitScaleFactor } from "../financial-metrics";

const DATA_SOURCE_NAME = "Ghana Stock Exchange — Listed Company Financial Statements";

export const PREVIEW_SAMPLE_SIZE = 50;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function ensureFinancialsDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Stock Exchange",
      sourceType: "MANUAL",
      url: "https://gse.com.gh/listed-companies/",
      expectedFrequency: "AD_HOC",
      ingestionMethod: "FILE_IMPORT",
      active: true,
    },
  });
}

async function ensureMetrics(): Promise<Map<string, string>> {
  const db = getPrisma();
  const entries = await Promise.all(
    Object.values(FINANCIAL_METRICS).map(async (def) => {
      const metric = await db.financialMetric.upsert({
        where: { code: def.code },
        update: { name: def.name, unit: def.canonicalUnit, category: def.category },
        create: { code: def.code, name: def.name, unit: def.canonicalUnit, category: def.category },
      });
      return [def.code, metric.id] as const;
    }),
  );
  return new Map(entries);
}

async function ensureCompanyByTicker(ticker: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(ticker);
  if (cached) return cached;

  const db = getPrisma();
  const existing = await db.company.findUnique({ where: { ticker } });
  if (existing) {
    cache.set(ticker, existing.id);
    return existing.id;
  }

  // Mirrors ensureSecurity's Security-side lookup (gse-security-provider.ts):
  // a Company may already exist for this ticker via an existing Security
  // without a `ticker` set on Company yet (shouldn't happen post-M7, but
  // defensive against data created before this field existed).
  const viaSecurity = await db.security.findUnique({ where: { ticker }, select: { companyId: true, company: { select: { ticker: true } } } });
  if (viaSecurity) {
    if (!viaSecurity.company.ticker) {
      await db.company.update({ where: { id: viaSecurity.companyId }, data: { ticker } });
    }
    cache.set(ticker, viaSecurity.companyId);
    return viaSecurity.companyId;
  }

  const company = await db.company.create({
    data: {
      name: KNOWN_COMPANY_NAMES[ticker] ?? ticker,
      ticker,
      sector: KNOWN_COMPANY_SECTORS[ticker] ?? null,
    },
  });
  cache.set(ticker, company.id);
  return company.id;
}

function periodCacheKey(row: NormalisedFinancialRow): string {
  return `${row.ticker}|${row.periodType}|${row.fiscalYear}|${row.fiscalQuarter}|${row.statementScope}`;
}

async function ensureFinancialPeriod(companyId: string, row: NormalisedFinancialRow, cache: Map<string, string>): Promise<string> {
  const key = periodCacheKey(row);
  const cached = cache.get(key);
  if (cached) return cached;

  const db = getPrisma();
  const period = await db.financialPeriod.upsert({
    where: {
      companyId_periodType_fiscalYear_fiscalQuarter_statementScope: {
        companyId,
        periodType: row.periodType,
        fiscalYear: row.fiscalYear,
        fiscalQuarter: row.fiscalQuarter,
        statementScope: row.statementScope,
      },
    },
    update: {
      startDate: row.periodStart,
      endDate: row.periodEnd,
      reportingCurrency: row.currency,
      audited: row.audited,
    },
    create: {
      companyId,
      periodType: row.periodType,
      fiscalYear: row.fiscalYear,
      fiscalQuarter: row.fiscalQuarter,
      statementScope: row.statementScope,
      startDate: row.periodStart,
      endDate: row.periodEnd,
      reportingCurrency: row.currency,
      audited: row.audited,
    },
  });
  cache.set(key, period.id);
  return period.id;
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

export interface FinancialRestatement {
  ticker: string;
  periodLabel: string;
  metricCode: string;
  previousValue: string;
  newValue: string;
}

async function persistObservations(
  runId: string,
  sourceId: string,
  rows: NormalisedFinancialRow[],
  companyCache: Map<string, string>,
  periodCache: Map<string, string>,
  metricIdByCode: Map<string, string>,
): Promise<{ inserted: number; updated: number; restatements: FinancialRestatement[] }> {
  const db = getPrisma();
  let inserted = 0;
  let updated = 0;
  const restatements: FinancialRestatement[] = [];

  for (const row of rows) {
    const companyId = await ensureCompanyByTicker(row.ticker, companyCache);
    const financialPeriodId = await ensureFinancialPeriod(companyId, row, periodCache);
    const metricId = metricIdByCode.get(row.metricCode);
    if (!metricId) continue;

    const scaledValue = (Number(row.value) * unitScaleFactor(row.unit)).toString();

    const existing = await db.companyFinancialObservation.findUnique({
      where: { financialPeriodId_metricId: { financialPeriodId, metricId } },
    });

    if (existing && Number(existing.value) !== Number(scaledValue)) {
      restatements.push({
        ticker: row.ticker,
        periodLabel: `${row.periodType}${row.fiscalQuarter ? ` Q${row.fiscalQuarter}` : ""} ${row.fiscalYear}`,
        metricCode: row.metricCode,
        previousValue: existing.value.toString(),
        newValue: scaledValue,
      });
    }

    await db.companyFinancialObservation.upsert({
      where: { financialPeriodId_metricId: { financialPeriodId, metricId } },
      update: {
        value: scaledValue,
        reportedValue: row.value,
        reportedUnit: row.unit,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        financialPeriodId,
        metricId,
        value: scaledValue,
        reportedValue: row.value,
        reportedUnit: row.unit,
        sourceId,
        ingestionRunId: runId,
      },
    });

    if (existing) updated++;
    else inserted++;
  }

  return { inserted, updated, restatements };
}

// ---------------------------------------------------------------------------
// Import entrypoint — two-phase (preview / commit), mirrors
// gse-security-provider.ts / gse-index-provider.ts exactly.
// ---------------------------------------------------------------------------

export interface FinancialsImportResult {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "PREVIEW";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  inserted: number;
  updated: number;
  tickers: string[];
  errors: { row: RawFinancialRow; errors: string[]; rowNumber: number }[];
  restatements: FinancialRestatement[];
  sampleValid: NormalisedFinancialRow[];
}

export async function importCompanyFinancials(
  filename: string,
  buffer: Buffer,
  opts: { commit: boolean; triggeredBy?: string } = { commit: false },
): Promise<FinancialsImportResult> {
  if (!opts.commit) {
    try {
      const parsedFile = await parseImportFile(filename, buffer);
      const rawRows = extractFinancialRows(parsedFile);
      const validation = validateFinancialRows(rawRows);
      const tickers = Array.from(new Set(validation.valid.map((r) => r.ticker))).sort();
      return {
        runId: null,
        status: "PREVIEW",
        recordsRead: rawRows.length,
        recordsAccepted: validation.valid.length,
        recordsRejected: validation.invalid.length,
        inserted: 0,
        updated: 0,
        tickers,
        errors: validation.invalid,
        restatements: [],
        sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        runId: null,
        status: "PREVIEW",
        recordsRead: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        inserted: 0,
        updated: 0,
        tickers: [],
        errors: [{ row: {}, errors: [message], rowNumber: 0 }],
        restatements: [],
        sampleValid: [],
      };
    }
  }

  const dataSource = await ensureFinancialsDataSource();
  const { runId } = await startRun({ dataSourceId: dataSource.id, triggeredBy: opts.triggeredBy ?? "cli", artifactName: filename });

  try {
    const parsedFile = await parseImportFile(filename, buffer);
    const rawRows = extractFinancialRows(parsedFile);
    const validation = validateFinancialRows(rawRows);
    const tickers = Array.from(new Set(validation.valid.map((r) => r.ticker))).sort();

    const metricIdByCode = await ensureMetrics();
    const companyCache = new Map<string, string>();
    const periodCache = new Map<string, string>();

    const { inserted, updated, restatements } = await persistObservations(
      runId,
      dataSource.id,
      validation.valid,
      companyCache,
      periodCache,
      metricIdByCode,
    );

    const run = await completeRun(runId, {
      recordsRead: rawRows.length,
      recordsAccepted: validation.valid.length,
      recordsRejected: validation.invalid.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      inserted,
      updated,
      tickers,
      errors: validation.invalid,
      restatements,
      sampleValid: validation.valid.slice(0, PREVIEW_SAMPLE_SIZE),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await failRun(runId, message);
    return {
      runId: run.runId,
      status: "FAILED",
      recordsRead: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      inserted: 0,
      updated: 0,
      tickers: [],
      errors: [],
      restatements: [],
      sampleValid: [],
    };
  }
}
