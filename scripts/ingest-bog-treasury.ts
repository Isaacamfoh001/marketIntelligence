#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bank of Ghana Treasury Bill Rates ingestion CLI.
//
// Usage:
//   npm run ingest:bog-treasury            — routine refresh (most recent auctions)
//   npm run ingest:bog-treasury:backfill   — historical backfill from 2025-01-01
// ---------------------------------------------------------------------------

import "dotenv/config";
import { getPrisma } from "../src/lib/prisma.js";
import {
  ingestBogTreasury,
  ingestBogTreasuryBackfill,
  type TreasuryIngestResult,
} from "../src/lib/ingestion/bog-treasury-provider.js";
import { SUPPORTED_SECURITY_TYPES } from "../src/lib/ingestion/bog-treasury-parser.js";

const isBackfill = process.argv.includes("--backfill");

async function printLatestRates() {
  const db = getPrisma();
  for (const type of SUPPORTED_SECURITY_TYPES) {
    const code = type.replace(/ /g, "_");
    const latest = await db.treasuryRate.findFirst({
      where: { instrument: { code } },
      orderBy: { observationDate: "desc" },
    });
    const label = type.replace(" DAY BILL", "D");
    if (latest) {
      console.log(`${label} latest:            ${Number(latest.interestRate).toFixed(4)}% (${latest.observationDate.toISOString().slice(0, 10)})`);
    } else {
      console.log(`${label} latest:            —`);
    }
  }
}

async function main() {
  const result: TreasuryIngestResult = isBackfill
    ? await ingestBogTreasuryBackfill("2025-01-01")
    : await ingestBogTreasury();

  console.log("");
  console.log(`Source:              Bank of Ghana — Treasury Bill Rates${isBackfill ? " (backfill)" : ""}`);
  await printLatestRates();
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Inserted/Updated:    ${result.persisted}`);
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
