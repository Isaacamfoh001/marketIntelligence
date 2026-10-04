#!/usr/bin/env node
// ---------------------------------------------------------------------------
// GFIM Daily Trading Report ingestion CLI (M7.2). Mode A automated:
// discovers the latest report via GFIM's public WordPress media REST API,
// downloads it, and commits directly — no --commit flag, mirroring the
// BoG automated CLIs (ingest-bog-treasury.ts etc.), since this is a
// genuine read-and-persist collector, not a preview/commit file workflow.
//
//   npm run ingest:gfim-trading-report
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ingestLatestGfimTradingReport } from "../src/lib/ingestion/gfim-trading-report-provider.js";

async function main() {
  const result = await ingestLatestGfimTradingReport();

  if ("status" in result && result.status === "NO_REPORT_FOUND") {
    console.log("No GFIM daily trading report found via the public media API.");
    return;
  }

  console.log("");
  console.log("Source:              Ghana Fixed Income Market — Daily Trading Reports");
  console.log(`Report:               ${result.reportFilename} (${result.reportDate})`);
  console.log(`Rows read:            ${result.recordsRead}`);
  console.log(`Traded (accepted):    ${result.recordsAccepted}`);
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
