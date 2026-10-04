#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Fixed Income Securities (Master) import CLI (M7). Mirrors
// import-company-financials.ts exactly. Preview by default, --commit persists:
//
//   npm run import:fixed-income-securities -- --file=./bonds.csv
//   npm run import:fixed-income-securities -- --file=./bonds.csv --commit
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { importFixedIncomeSecurities } from "../src/lib/ingestion/fixed-income-securities-provider.js";

function parseArgs(argv: string[]): { file: string; commit: boolean } {
  let file: string | undefined;
  let commit = false;
  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--commit") commit = true;
  }
  if (!file) {
    console.error("Usage: npm run import:fixed-income-securities -- --file=<path.csv|.xlsx> [--commit]");
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

  const result = await importFixedIncomeSecurities(filename, buffer, { commit });

  console.log("");
  console.log(`Mode:                ${commit ? "COMMIT" : "PREVIEW (no data persisted — pass --commit to import)"}`);
  console.log("Source:              Ghana Fixed Income Market — Securities Master");
  console.log(`File:                ${filename}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Instruments:         ${result.instrumentCodes.length}${result.instrumentCodes.length > 0 ? ` (${result.instrumentCodes.join(", ")})` : ""}`);
  if (commit) {
    console.log(`Persisted:           ${result.inserted + result.updated} (${result.inserted} new, ${result.updated} updated)`);
    console.log(`Run status:          ${result.status}`);
    console.log(`Run ID:              ${result.runId ?? "—"}`);
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
      console.log(`  ${r.instrumentCode} ${r.field}: ${r.previousValue} → ${r.newValue}`);
    }
  }
  console.log("");

  if (commit && result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
