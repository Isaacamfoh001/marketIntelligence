#!/usr/bin/env node
// ---------------------------------------------------------------------------
// GFIM Daily Trading Report ingestion CLI (M7.2). Mode A automated:
// discovers the latest report via GFIM's public WordPress media REST API,
// downloads it, and commits directly — no --commit flag, mirroring the
// BoG automated CLIs (ingest-bog-treasury.ts etc.), since this is a
// genuine read-and-persist collector, not a preview/commit file workflow.
//
//   npm run ingest:gfim-trading-report
//   npm run ingest:gfim-trading-report -- --backfill --from=2025-07-01
//
// --backfill imports every report GFIM's media API lists on/after --from,
// oldest first (M7.3.1), so observations carry their real trade dates.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { backfillGfimTradingReports, ingestLatestGfimTradingReport } from "../src/lib/ingestion/gfim-trading-report-provider.js";

async function backfill(fromArg: string | undefined) {
  if (!fromArg || !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) {
    console.error("--backfill requires --from=YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }
  const results = await backfillGfimTradingReports(new Date(`${fromArg}T00:00:00.000Z`), (r) => {
    console.log(`${r.reportDate}  ${r.status.padEnd(7)}  traded=${r.tradedCount} carried=${r.notTradedCount} stored=${r.inserted + r.updated} carriedSkipped=${r.carriedSkipped} termsConflicts=${r.termsConflicts.length} postMaturity=${r.postMaturity.length}`);
  });
  const failed = results.filter((r) => r.status !== "SUCCESS");
  console.log(`\nBackfilled ${results.length} report(s); ${failed.length} failed.`);
  if (failed.length > 0) process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--backfill")) return backfill(args.find((a) => a.startsWith("--from="))?.slice("--from=".length));

  const result = await ingestLatestGfimTradingReport();

  if ("status" in result && result.status === "NO_REPORT_FOUND") {
    console.log("No GFIM daily trading report found via the public media API.");
    return;
  }

  console.log("");
  console.log("Source:              Ghana Fixed Income Market — Daily Trading Reports");
  console.log(`Report:               ${result.reportFilename} (${result.reportDate})`);
  console.log(`Rows read:            ${result.recordsRead}`);
  console.log(`Accepted rows:        ${result.recordsAccepted} (${result.tradedCount} traded today, ${result.notTradedCount} carried closing prices)`);
  console.log(`No trade that day:    ${result.noTradeCount}`);
  console.log(`Rejected:             ${result.recordsRejected}`);
  console.log(`Persisted:            ${result.inserted + result.updated} (${result.inserted} new, ${result.updated} updated)`);
  console.log(`Run status:           ${result.status}`);
  console.log(`Run ID:               ${result.runId ?? "—"}`);

  if (result.unmatched.length > 0) {
    console.log("");
    console.log(`⚠ ${result.unmatched.length} ISIN(s) in the report have no matching Fixed Income Security (not imported):`);
    for (const u of result.unmatched.slice(0, 20)) {
      console.log(`  ${u.isin} (${u.sheet}) — ${u.securityDescription ?? "no description"}`);
    }
  }
  if (result.termsConflicts.length > 0) {
    console.log("");
    console.log(`⚠ ${result.termsConflicts.length} row(s) whose source maturity disagrees with the Securities Master (withheld from analytics):`);
    for (const t of result.termsConflicts) console.log(`  ${t.isin}: master ${t.masterMaturityDate} vs source ${t.sourceMaturityDate} (${t.sourceSecurityDescription ?? "—"})`);
  }
  if (result.postMaturity.length > 0) {
    console.log("");
    console.log(`⚠ ${result.postMaturity.length} row(s) dated on/after the security's maturity (withheld from analytics):`);
    for (const p of result.postMaturity) console.log(`  ${p.isin}: matured ${p.maturityDate} (${p.tradeStatus})`);
  }
  if (result.auctionConflicts.length > 0) {
    console.log("");
    console.log(`⚠ ${result.auctionConflicts.length} ISIN(s) already had a primary-auction observation for this date — secondary trade NOT applied:`);
    for (const c of result.auctionConflicts) console.log(`  ${c.isin} on ${c.observationDate}`);
  }
  console.log("");

  if (result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
