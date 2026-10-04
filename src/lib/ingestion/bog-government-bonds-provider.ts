// ---------------------------------------------------------------------------
// Bank of Ghana government bond/note AUCTION ingestion (M7.1 §7) — a true
// Mode A automated collector: reuses the exact same open, already-proven
// endpoint as bog-treasury-provider.ts (same HTML page, same AJAX
// mechanism), just reading the rows that provider deliberately filters
// out (notes/bonds instead of bills).
//
// Persists into FixedIncomeSecurity/FixedIncomeObservation, NOT
// TreasuryInstrument/TreasuryRate — these are coupon-bearing instruments,
// architecturally identical to the GFIM-sourced government bonds (M7.1
// §7: "determine whether longer-dated government securities belong in
// FixedIncomeSecurity... choose the least duplicative design" — one
// coupon-bond model, not two).
//
// `instrumentCode` is derived deterministically from the auction's own
// tender number (BoG's own auction identifier) so a re-run of this
// collector always upserts the same row rather than creating a duplicate.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { fetchBogText, postBogForm } from "./http";
import { extractRowsFromAjaxJson, filterGovBondCandidateRows, isRecentEnough, validateGovBondRows, type NormalisedGovBondRow } from "./bog-government-bonds-parser";
import { extractNonce, extractTableId } from "./bog-treasury-provider";
import { startRun, completeRun, failRun } from "./ingestion-service";

const TREASURY_URL = "https://www.bog.gov.gh/treasury-and-the-markets/treasury-bill-rates/";
const AJAX_URL = "https://www.bog.gov.gh/wp-admin/admin-ajax.php?action=get_wdtable";
const DATA_SOURCE_NAME = "Bank of Ghana — Government Notes & Bonds (Auction)";
const ISSUER_NAME = "Government of Ghana";

// Government bond/note auctions are infrequent (M7.1 research: most recent
// across all tenors), so the main page's server-rendered ~10 most-recent
// rows (dominated by weekly bill auctions) usually won't contain one even
// when a recent bond auction exists. This reads the same bounded,
// unauthenticated historical AJAX mechanism bog-treasury-provider.ts's
// backfill already uses (equivalent to a visitor clicking "Show All") —
// not a new access path, just reused for a different filter.
const HISTORY_PAGE_SIZE = 2000;

/** Only an auction within this many days of "now" is imported as currently active — see bog-government-bonds-parser.ts header for why. */
export const MAX_AUCTION_AGE_DAYS = 400;

const MONTHS_PER_YEAR = 12;

async function ensureDataSource() {
  const db = getPrisma();
  return db.dataSource.upsert({
    where: { name: DATA_SOURCE_NAME },
    update: {},
    create: {
      name: DATA_SOURCE_NAME,
      provider: "Bank of Ghana",
      sourceType: "AUTOMATED",
      url: TREASURY_URL,
      // Irregular/infrequent — unlike weekly bills, GoG notes/bonds auction
      // on no fixed calendar cadence post-2022 (M7.1 research finding).
      expectedFrequency: "AD_HOC",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
}

async function ensureGovernmentIssuerCompany(): Promise<string> {
  const db = getPrisma();
  const existing = await db.company.findFirst({ where: { name: ISSUER_NAME, ticker: null } });
  if (existing) return existing.id;
  const created = await db.company.create({ data: { name: ISSUER_NAME, ticker: null, sector: "Sovereign" } });
  return created.id;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12;
  return new Date(Date.UTC(targetYear, targetMonth, d.getUTCDate()));
}

function instrumentCodeFor(row: NormalisedGovBondRow): string {
  const tender = row.tenderNumber ?? row.observationDate.toISOString().slice(0, 10).replace(/-/g, "");
  return `GOG-${row.tenorYears}Y-AUCTION-${tender}`;
}

async function persistGovBonds(
  runId: string,
  sourceId: string,
  companyId: string,
  rows: NormalisedGovBondRow[],
): Promise<{ inserted: number; updated: number }> {
  const db = getPrisma();
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const instrumentCode = instrumentCodeFor(row);
    const maturityDate = addMonths(row.observationDate, row.tenorYears * MONTHS_PER_YEAR);

    const existing = await db.fixedIncomeSecurity.findUnique({ where: { instrumentCode } });

    // `update` deliberately omits maturityDate/instrumentName/isin: the
    // auction feed only ever gives an APPROXIMATE maturity (issue date +
    // tenor in whole years) — once a more authoritative maturity/ISIN has
    // been attached to this instrumentCode (e.g. cross-referenced against
    // GFIM's secondary-market sheets, which publish the bond's real legal
    // maturity — see M7.2 §10's GOG-4Y-AUCTION-2023 correction), a later
    // re-run of this collector must never regress it back to the
    // estimate. couponRatePct/status are safe to keep syncing from BoG,
    // since BoG is the sole authority for those.
    const security = await db.fixedIncomeSecurity.upsert({
      where: { instrumentCode },
      update: {
        issuerName: ISSUER_NAME,
        companyId,
        instrumentType: "GOVERNMENT_BOND",
        classification: "SOVEREIGN",
        currency: "GHS",
        issueDate: row.observationDate,
        couponType: "FIXED",
        couponRatePct: row.ratePct,
        couponFrequency: "SEMI_ANNUAL",
        faceValue: "100",
        status: "ACTIVE",
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        instrumentCode,
        instrumentName: `Government of Ghana ${row.tenorYears}-Year Bond (${row.observationDate.toISOString().slice(0, 10)} auction)`,
        issuerName: ISSUER_NAME,
        companyId,
        instrumentType: "GOVERNMENT_BOND",
        classification: "SOVEREIGN",
        currency: "GHS",
        issueDate: row.observationDate,
        maturityDate,
        couponType: "FIXED",
        couponRatePct: row.ratePct,
        couponFrequency: "SEMI_ANNUAL",
        faceValue: "100",
        status: "ACTIVE",
        sourceId,
        ingestionRunId: runId,
      },
    });
    if (existing) updated++;
    else inserted++;

    await db.fixedIncomeObservation.upsert({
      where: { securityId_observationDate: { securityId: security.id, observationDate: row.observationDate } },
      update: {
        cleanPrice: null,
        sourceYieldPct: row.ratePct,
        volumeTradedGhs: null,
        observationKind: "AUCTION_PRIMARY",
        sourceId,
        retrievedAt: new Date(),
        ingestionRunId: runId,
      },
      create: {
        securityId: security.id,
        observationDate: row.observationDate,
        cleanPrice: null,
        sourceYieldPct: row.ratePct,
        volumeTradedGhs: null,
        observationKind: "AUCTION_PRIMARY",
        sourceId,
        ingestionRunId: runId,
      },
    });
  }

  return { inserted, updated };
}

export interface GovBondIngestResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  inserted: number;
  updated: number;
  securities: { instrumentCode: string; tenorYears: number; observationDate: string; ratePct: string }[];
}

export async function ingestBogGovernmentBonds(now: Date = new Date()): Promise<GovBondIngestResult> {
  const dataSource = await ensureDataSource();
  const companyId = await ensureGovernmentIssuerCompany();

  const { runId } = await startRun({ dataSourceId: dataSource.id, triggeredBy: "cli", artifactName: TREASURY_URL });

  try {
    const pageHtml = await fetchBogText(TREASURY_URL);
    const nonce = extractNonce(pageHtml);
    const tableId = extractTableId(pageHtml);

    const json = await postBogForm(`${AJAX_URL}&table_id=${tableId}`, TREASURY_URL, {
      draw: "1",
      start: "0",
      length: String(HISTORY_PAGE_SIZE),
      "order[0][column]": "0",
      "order[0][dir]": "desc",
      wdtNonce: nonce,
    });
    const parsed: unknown = JSON.parse(json);
    const candidateRows = filterGovBondCandidateRows(extractRowsFromAjaxJson(parsed));
    const validation = validateGovBondRows(candidateRows);
    const recentRows = validation.valid.filter((r) => isRecentEnough(r.observationDate, now, MAX_AUCTION_AGE_DAYS));

    const { inserted, updated } = await persistGovBonds(runId, dataSource.id, companyId, recentRows);

    const run = await completeRun(runId, {
      recordsRead: candidateRows.length,
      recordsAccepted: recentRows.length,
      recordsRejected: candidateRows.length - recentRows.length,
    });

    return {
      runId: run.runId,
      status: run.status,
      recordsRead: run.recordsRead,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      inserted,
      updated,
      securities: recentRows.map((r) => ({
        instrumentCode: instrumentCodeFor(r),
        tenorYears: r.tenorYears,
        observationDate: r.observationDate.toISOString().slice(0, 10),
        ratePct: r.ratePct,
      })),
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
      securities: [],
    };
  }
}
