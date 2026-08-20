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
  const stored = await db.macroObservation.count({ where: { series: { code: "BOG_MPR" } } });

  console.log("");
  console.log("Source:              Bank of Ghana — Monetary Policy Rate");
  console.log(`Latest rate:         ${result.latestRate ? `${Number(result.latestRate).toFixed(2)}%` : "—"}`);
  console.log(`Effective/decision date: ${result.latestEffectiveDate ?? "—"}`);
  console.log(`Observations stored: ${stored}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Run status:          ${result.status}`);
  console.log(`Run ID:              ${result.runId}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Rejection details:");
    for (const err of result.errors) {
      console.log(`  ${JSON.stringify(err.row)}:`);
      for (const e of err.errors) {
        console.log(`    - ${e}`);
      }
    }
  }
  console.log("");

  if (result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
