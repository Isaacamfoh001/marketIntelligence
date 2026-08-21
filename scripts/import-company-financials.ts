#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Company Financials import CLI (M7).
//
// Manual import only — see financials-provider.ts for why. Two-stage
// workflow — preview by default, --commit persists:
//
//   npm run import:company-financials -- --file=./mtn-fy2025.csv
//   npm run import:company-financials -- --file=./mtn-fy2025.csv --commit
//
// --acquisition=OFFICIAL_WEB_FETCH marks this run's rows as transcribed
// from an official statement fetched directly from a first-party URL
// (see statement-extraction.ts / M7.1 §39) rather than a user-supplied
// file — defaults to MANUAL_FILE_IMPORT.
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { importCompanyFinancials } from "../src/lib/ingestion/financials-provider.js";

function parseArgs(argv: string[]): { file: string; commit: boolean; acquisitionMethod: string } {
  let file: string | undefined;
  let commit = false;
  let acquisitionMethod = "MANUAL_FILE_IMPORT";

  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--commit") commit = true;
    else if (arg.startsWith("--acquisition=")) acquisitionMethod = arg.slice("--acquisition=".length);
  }

  if (!file) {
    console.error("Usage: npm run import:company-financials -- --file=<path.csv|.xlsx> [--commit] [--acquisition=OFFICIAL_WEB_FETCH|MANUAL_FILE_IMPORT]");
    console.error("Without --commit, the file is parsed and validated only — nothing is persisted.");
    process.exit(1);
  }

  return { file, commit, acquisitionMethod };
}

async function main() {
  const { file, commit, acquisitionMethod } = parseArgs(process.argv.slice(2));

  const absolutePath = path.resolve(file);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(absolutePath);
  const filename = path.basename(absolutePath);

  const result = await importCompanyFinancials(filename, buffer, { commit, acquisitionMethod });

  console.log("");
  console.log(`Mode:                ${commit ? "COMMIT" : "PREVIEW (no data persisted — pass --commit to import)"}`);
  console.log("Source:              Ghana Stock Exchange — Listed Company Financial Statements");
  console.log(`File:                ${filename}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Companies detected:  ${result.tickers.length}${result.tickers.length > 0 ? ` (${result.tickers.join(", ")})` : ""}`);
  if (commit) {
    console.log(`Persisted:           ${result.inserted + result.updated} (${result.inserted} new, ${result.updated} updated)`);
    console.log(`Run status:          ${result.status}`);
    console.log(`Run ID:              ${result.runId ?? "—"}`);
    console.log(`Acquisition method:  ${acquisitionMethod}`);
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log(`Rejected rows (${result.errors.length}, showing up to 10):`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  Row ${err.rowNumber}: ${err.errors.join("; ")}`);
    }
  }

  if (result.restatements.length > 0) {
    console.log("");
    console.log(`⚠ ${result.restatements.length} value(s) restated from a previous import:`);
    for (const r of result.restatements) {
      console.log(`  ${r.ticker} ${r.periodLabel} ${r.metricCode}: ${r.previousValue} → ${r.newValue}`);
    }
  }
  console.log("");

  if (commit && result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
