// ---------------------------------------------------------------------------
// Fixed Income Securities (Master) — import provider (M7).
//
// Treasury bills are intentionally NOT imported through this path — they
// already have a complete, working domain (TreasuryInstrument/TreasuryRate,
// ingested via scripts/ingest-bog-treasury.ts). This provider only creates
// GOVERNMENT_BOND and CORPORATE_BOND rows, the two coupon-bearing shapes
// Treasury doesn't cover (see FixedIncomeInstrumentType in schema.prisma).
//
// Issuer identity reuses the existing Company model (CLAUDE.md §4: reuse
// existing patterns) for BOTH corporates and sovereigns — a Government of
// Ghana bond's issuer is just a Company row with no ticker and sector
// "Sovereign", exactly like any other issuer. `ticker` links to an existing
// GSE-listed Company/Security when the issuer is also publicly traded
// (e.g. Kasapreko/KASA); it is optional because many corporate bond
// issuers (e.g. a savings & loans company) are not GSE-listed at all.
//
// Idempotency (M7 §9/§20): a re-import always upserts by `instrumentCode`;
// a changed contractual term is reported as a restatement (never silently
// applied), mirroring financials-provider.ts's restatement handling.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { parseImportFile } from "./file-parse";
import {
  extractFixedIncomeSecurityRows,
  validateFixedIncomeSecurityRows,
  type NormalisedFixedIncomeSecurityRow,
  type RawFixedIncomeSecurityRow,
} from "./fixed-income-securities-parser";
import { startRun, completeRun, failRun } from "./ingestion-service";
import { classifyInstrument } from "../fixed-income/classification";

const DATA_SOURCE_NAME = "Ghana Fixed Income Market — Securities Master";

export const PREVIEW_SAMPLE_SIZE = 50;

export async function ensureFixedIncomeSecuritiesDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Ghana Fixed Income Market",
      sourceType: "MANUAL",
      url: null,
      expectedFrequency: "AD_HOC",
      ingestionMethod: "FILE_IMPORT",
      active: true,
    },
  });
}

async function ensureIssuerCompany(issuerName: string, ticker: string | null, cache: Map<string, string>): Promise<string | null> {
  const cacheKey = ticker ?? `name:${issuerName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const db = getPrisma();
  if (ticker) {
    const existing = await db.company.findUnique({ where: { ticker } });
    if (existing) {
      cache.set(cacheKey, existing.id);
      return existing.id;
    }
    const created = await db.company.create({ data: { name: issuerName, ticker } });
    cache.set(cacheKey, created.id);
    return created.id;
  }

  // No ticker (not GSE-listed, e.g. a sovereign issuer or an unlisted
  // NBFI) — de-duplicate by exact issuer name instead, since Company.name
  // has no uniqueness constraint of its own.
  const existing = await db.company.findFirst({ where: { name: issuerName, ticker: null } });
  if (existing) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }
  const created = await db.company.create({ data: { name: issuerName, ticker: null } });
  cache.set(cacheKey, created.id);
  return created.id;
}

export interface FixedIncomeSecurityRestatement {
  instrumentCode: string;
  field: string;
  previousValue: string;
  newValue: string;
}

async function persistSecurities(
  runId: string,
  sourceId: string,
  rows: NormalisedFixedIncomeSecurityRow[],
  companyCache: Map<string, string>,
): Promise<{ inserted: number; updated: number; restatements: FixedIncomeSecurityRestatement[] }> {
  const db = getPrisma();
  let inserted = 0;
  let updated = 0;
  const restatements: FixedIncomeSecurityRestatement[] = [];

  for (const row of rows) {
    const companyId = await ensureIssuerCompany(row.issuerName, row.ticker, companyCache);
    const classification = classifyInstrument(row.instrumentType);

    const existing = await db.fixedIncomeSecurity.findUnique({ where: { instrumentCode: row.instrumentCode } });

    if (existing) {
      const checks: [string, string | null, string | null][] = [
        ["couponRatePct", existing.couponRatePct?.toString() ?? null, row.couponRatePct],
        ["maturityDate", existing.maturityDate.toISOString().slice(0, 10), row.maturityDate.toISOString().slice(0, 10)],
        ["faceValue", existing.faceValue.toString(), row.faceValue],
      ];
      for (const [field, previousValue, newValue] of checks) {
        if (previousValue !== newValue) {
          restatements.push({ instrumentCode: row.instrumentCode, field, previousValue: previousValue ?? "—", newValue: newValue ?? "—" });
        }
      }
    }

    await db.fixedIncomeSecurity.upsert({
      where: { instrumentCode: row.instrumentCode },
      update: {
        instrumentName: row.instrumentName,
        issuerName: row.issuerName,
        companyId,
        instrumentType: row.instrumentType,
        classification,
        currency: row.currency,
        issueDate: row.issueDate,
        maturityDate: row.maturityDate,
        couponType: row.couponType,
        couponRatePct: row.couponRatePct,
        couponFrequency: row.couponFrequency,
        faceValue: row.faceValue,
        status: row.status,
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        instrumentCode: row.instrumentCode,
        instrumentName: row.instrumentName,
        issuerName: row.issuerName,
        companyId,
        instrumentType: row.instrumentType,
        classification,
        currency: row.currency,
        issueDate: row.issueDate,
        maturityDate: row.maturityDate,
        couponType: row.couponType,
        couponRatePct: row.couponRatePct,
        couponFrequency: row.couponFrequency,
        faceValue: row.faceValue,
        status: row.status,
        sourceId,
        ingestionRunId: runId,
      },
    });

    if (existing) updated++;
    else inserted++;
  }

  return { inserted, updated, restatements };
}

export interface FixedIncomeSecuritiesImportResult {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "PREVIEW";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  inserted: number;
  updated: number;
  instrumentCodes: string[];
  errors: { row: RawFixedIncomeSecurityRow; errors: string[]; rowNumber: number }[];
  restatements: FixedIncomeSecurityRestatement[];
  sampleValid: NormalisedFixedIncomeSecurityRow[];
}

export async function importFixedIncomeSecurities(
  filename: string,
  buffer: Buffer,
  opts: { commit: boolean; triggeredBy?: string } = { commit: false },
): Promise<FixedIncomeSecuritiesImportResult> {
  if (!opts.commit) {
    try {
      const parsedFile = await parseImportFile(filename, buffer);
      const rawRows = extractFixedIncomeSecurityRows(parsedFile);
      const validation = validateFixedIncomeSecurityRows(rawRows);
      const instrumentCodes = Array.from(new Set(validation.valid.map((r) => r.instrumentCode))).sort();
      return {
        runId: null,
        status: "PREVIEW",
        recordsRead: rawRows.length,
        recordsAccepted: validation.valid.length,
        recordsRejected: validation.invalid.length,
        inserted: 0,
        updated: 0,
        instrumentCodes,
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
        instrumentCodes: [],
        errors: [{ row: {}, errors: [message], rowNumber: 0 }],
        restatements: [],
        sampleValid: [],
      };
    }
  }

  const dataSource = await ensureFixedIncomeSecuritiesDataSource();
  const { runId } = await startRun({
    dataSourceId: dataSource.id,
    triggeredBy: opts.triggeredBy ?? "cli",
    artifactName: filename,
    acquisitionMethod: "MANUAL_FILE_IMPORT",
  });

  try {
    const parsedFile = await parseImportFile(filename, buffer);
    const rawRows = extractFixedIncomeSecurityRows(parsedFile);
    const validation = validateFixedIncomeSecurityRows(rawRows);
    const instrumentCodes = Array.from(new Set(validation.valid.map((r) => r.instrumentCode))).sort();

    const companyCache = new Map<string, string>();
    const { inserted, updated, restatements } = await persistSecurities(runId, dataSource.id, validation.valid, companyCache);

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
      instrumentCodes,
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
      instrumentCodes: [],
      errors: [],
      restatements: [],
      sampleValid: [],
    };
  }
}
