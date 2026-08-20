#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bank of Ghana FX ingestion CLI.
//
// Usage:
//   npm run ingest:bog-fx                 — latest published day (USDGHS)
//   npm run ingest:bog-fx:backfill        — historical backfill from 2025-01-01
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ingestBogFxDaily, ingestBogFxBackfill, type BogFxIngestResult } from "../src/lib/ingestion/bog-fx-provider.js";

const PAIR = "USDGHS";
const isBackfill = process.argv.includes("--backfill");

function report(sourceLabel: string, result: BogFxIngestResult) {
  console.log("");
  console.log(`Source:              ${sourceLabel}`);
  console.log(`Pair:                ${result.pair}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Inserted/Updated:    ${result.persisted}`);
  console.log(`Latest observation:  ${result.latestObservationDate ?? "—"}`);
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
}

async function main() {
  if (isBackfill) {
    const result = await ingestBogFxBackfill(PAIR, "2025-01-01");
    report("Bank of Ghana — Historical Interbank FX Rates (backfill)", result);
    if (result.status !== "SUCCESS") process.exitCode = 1;
    return;
  }

  const result = await ingestBogFxDaily(PAIR);
  report("Bank of Ghana — Daily Interbank FX Rates", result);
  if (result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
