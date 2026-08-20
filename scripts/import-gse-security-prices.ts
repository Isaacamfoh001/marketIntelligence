#!/usr/bin/env node
// ---------------------------------------------------------------------------
// GSE Daily Shares & ETFs — security price import CLI.
//
// Manual/semi-automated import (CLAUDE.md §20/§29): gse.com.gh blocks AI
// agents site-wide via robots.txt (see gse-security-provider.ts), so this
// reads a CSV/Excel file a human obtained through their own browser.
//
// Two-stage workflow — preview is the default, nothing is persisted until
// --commit is passed explicitly:
//
//   npm run import:gse-securities -- --file=./daily-shares.csv
//   npm run import:gse-securities -- --file=./daily-shares.csv --commit
//   npm run import:gse-securities -- --file=./monthly-report.xlsx --kind=backfill --commit
//
// --kind=daily (default) uses the higher-priority "Daily Shares & ETFs"
// source; --kind=backfill uses the lower-priority "Market Report
// Backfill" source (see gse-security-provider.ts for the priority rule).
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { importGseSecurityPrices, type SecurityImportKind } from "../src/lib/ingestion/gse-security-provider.js";

function parseArgs(argv: string[]): { file: string; kind: SecurityImportKind; commit: boolean } {
  let file: string | undefined;
  let kind: SecurityImportKind = "daily";
  let commit = false;

  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg.startsWith("--kind=")) {
      const value = arg.slice("--kind=".length);
      if (value !== "daily" && value !== "backfill") {
        console.error(`Invalid --kind: "${value}" — expected "daily" or "backfill"`);
        process.exit(1);
      }
      kind = value;
    } else if (arg === "--commit") commit = true;
  }

  if (!file) {
    console.error("Usage: npm run import:gse-securities -- --file=<path.csv|.xlsx> [--kind=daily|backfill] [--commit]");
    console.error("Without --commit, the file is parsed and validated only — nothing is persisted.");
    process.exit(1);
  }

  return { file, kind, commit };
}

async function main() {
  const { file, kind, commit } = parseArgs(process.argv.slice(2));

  const absolutePath = path.resolve(file);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(absolutePath);
  const filename = path.basename(absolutePath);

  const result = await importGseSecurityPrices(filename, buffer, kind, { commit });

  console.log("");
  console.log(`Mode:                ${commit ? "COMMIT" : "PREVIEW (no data persisted — pass --commit to import)"}`);
  console.log(`Source:              Ghana Stock Exchange — ${kind === "daily" ? "Daily Shares & ETFs" : "Market Report Backfill"}`);
  console.log(`File:                ${filename}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Securities detected: ${result.tickers.length}${result.tickers.length > 0 ? ` (${result.tickers.join(", ")})` : ""}`);
  console.log(`Trading date range:  ${result.earliestTradingDate ?? "—"} → ${result.latestTradingDate ?? "—"}`);
  if (commit) {
    console.log(`Persisted:           ${result.persisted} (${result.inserted} new, ${result.updated} updated)`);
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

  if (result.conflicts.length > 0) {
    console.log("");
    console.log(`⚠ ${result.conflicts.length} row(s) conflict with the higher-priority source (NOT applied):`);
    for (const c of result.conflicts) {
      console.log(`  ${c.ticker} ${c.tradingDate}: incoming close=${c.incomingCloseVwap}  kept (higher priority)=${c.existingCloseVwap}`);
    }
  }
  console.log("");

  if (commit && result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
