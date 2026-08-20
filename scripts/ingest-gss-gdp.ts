#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ghana Statistical Service Quarterly GDP ingestion CLI.
//
// Usage: npm run ingest:gss-gdp
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ingestGssGdp } from "../src/lib/ingestion/gss-gdp-provider.js";

async function main() {
  const result = await ingestGssGdp();

  console.log("");
  console.log("Source:              Ghana Statistical Service — Quarterly GDP");
  console.log("Series:               Real GDP Growth (YoY, Overall, Production Approach)");
  console.log(`Earliest:            ${result.earliest ?? "—"}`);
  console.log(`Latest:              ${result.latest ?? "—"}`);
  console.log(`Observations:        ${result.persisted}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
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
