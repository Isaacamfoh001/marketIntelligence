#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ghana Statistical Service CPI/Inflation ingestion CLI.
//
// Usage: npm run ingest:gss-inflation
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ingestGssInflation } from "../src/lib/ingestion/gss-cpi-provider.js";

async function main() {
  const result = await ingestGssInflation();

  console.log("");
  console.log("Source:              Ghana Statistical Service — CPI");
  console.log("Series:               Headline Inflation YoY (+ MoM)");
  console.log(`Earliest:            ${result.earliestYoy ?? "—"}`);
  console.log(`Latest:              ${result.latestYoy ?? "—"}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Inserted/Updated:    ${result.persisted}`);
  console.log(`Run status:          ${result.status}`);
  console.log(`Run ID:              ${result.runId}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log(`Rejection details (${result.errors.length} total, showing up to 10):`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  ${JSON.stringify(err.row)}: ${err.errors.join("; ")}`);
    }
  }
  console.log("");

  if (result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
