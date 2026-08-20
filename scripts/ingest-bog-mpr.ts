#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bank of Ghana Monetary Policy Rate ingestion CLI.
//
// Usage: npm run ingest:bog-mpr
// ---------------------------------------------------------------------------

import "dotenv/config";
import { getPrisma } from "../src/lib/prisma.js";
import { ingestBogMpr } from "../src/lib/ingestion/bog-mpr-provider.js";

async function main() {
  const result = await ingestBogMpr();
  const db = getPrisma();
  const stored = await db.policyDecision.count();

  console.log("");
  console.log("Source:                  Bank of Ghana — Monetary Policy Rate");
  console.log(`Current MPR:             ${result.currentRate ? `${Number(result.currentRate).toFixed(2)}%` : "—"}`);
  console.log(`Latest MPC decision:     ${result.latestDecisionDate ?? "—"} — ${result.latestDecisionType ?? "—"}`);
  console.log(
    `Last rate change:        ${result.lastChangeDate ?? "—"} — ${result.lastChangeType ?? "—"}${
      result.lastChangeBps != null ? ` (${result.lastChangeBps > 0 ? "+" : ""}${result.lastChangeBps} bps)` : ""
    }`,
  );
  console.log(`Decisions stored:        ${stored}`);
  console.log("");
  console.log(`Rate table:   read ${result.rateTableRun.recordsRead}, accepted ${result.rateTableRun.recordsAccepted}, rejected ${result.rateTableRun.recordsRejected}, status ${result.rateTableRun.status}`);
  console.log(`Archive:      read ${result.archiveRun.recordsRead}, accepted ${result.archiveRun.recordsAccepted}, rejected ${result.archiveRun.recordsRejected}, status ${result.archiveRun.status}`);

  if (result.errors.rateTable.length > 0 || result.errors.archive.length > 0) {
    console.log("");
    console.log("Rejection details:");
    for (const err of result.errors.rateTable) {
      console.log(`  [rate table] ${JSON.stringify(err.row)}: ${err.errors.join("; ")}`);
    }
    for (const err of result.errors.archive) {
      console.log(`  [archive] ${JSON.stringify(err.row)}: ${err.errors.join("; ")}`);
    }
  }
  console.log("");

  if (result.rateTableRun.status !== "SUCCESS" || result.archiveRun.status !== "SUCCESS") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
