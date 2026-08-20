#!/usr/bin/env node
// ---------------------------------------------------------------------------
// GSE Daily Market Summary — index (GSE-CI/GSE-FSI) & whole-market import CLI.
//
// Same manual-import rationale as import-gse-security-prices.ts. Two-stage
// workflow — preview by default, --commit persists:
//
//   npm run import:gse-market-summary -- --file=./market-summary.csv
//   npm run import:gse-market-summary -- --file=./market-summary.csv --commit
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { importGseMarketSummary } from "../src/lib/ingestion/gse-index-provider.js";

function parseArgs(argv: string[]): { file: string; commit: boolean } {
  let file: string | undefined;
  let commit = false;

  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--commit") commit = true;
  }

  if (!file) {
    console.error("Usage: npm run import:gse-market-summary -- --file=<path.csv|.xlsx> [--commit]");
    console.error("Without --commit, the file is parsed and validated only — nothing is persisted.");
    process.exit(1);
  }

  return { file, commit };
}

async function main() {
  const { file, commit } = parseArgs(process.argv.slice(2));

  const absolutePath = path.resolve(file);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(absolutePath);
  const filename = path.basename(absolutePath);

  const result = await importGseMarketSummary(filename, buffer, { commit });

  console.log("");
  console.log(`Mode:                ${commit ? "COMMIT" : "PREVIEW (no data persisted — pass --commit to import)"}`);
  console.log("Source:              Ghana Stock Exchange — Daily Market Summary");
  console.log(`File:                ${filename}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Trading date range:  ${result.earliestTradingDate ?? "—"} → ${result.latestTradingDate ?? "—"}`);
  if (commit) {
    console.log(`Index observations:  ${result.indexObservationsPersisted} (${result.inserted} new, ${result.updated} updated)`);
    console.log(`Market summaries:    ${result.summariesPersisted}`);
    console.log(`Run status:          ${result.status}`);
    console.log(`Run ID:              ${result.runId ?? "—"}`);
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log(`Rejected rows (${result.errors.length}, showing up to 10):`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  ${JSON.stringify(err.row)}: ${err.errors.join("; ")}`);
    }
  }
  console.log("");

  if (commit && result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
