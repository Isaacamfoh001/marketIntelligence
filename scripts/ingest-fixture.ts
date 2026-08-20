#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Fixture ingestion script — development/test only.
//
// Usage:  npm run ingest:fixture
//
// Reads fixtures/macro_fixture.csv, runs it through the full ingestion
// pipeline, and prints a concise summary.
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestMacroCsv } from "../src/lib/ingestion/macro-provider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const fixturePath = path.resolve(__dirname, "../fixtures/macro_fixture.csv");
  const csvContent = fs.readFileSync(fixturePath, "utf-8");

  const result = await ingestMacroCsv(csvContent, {
    sourceName: "Fixture Macro Series",
    provider: "Fixture Provider",
    seriesCode: "FIXTURE_INFLATION_YOY",
    seriesName: "Fixture Inflation YoY",
    unit: "%",
    category: "Inflation",
  });

  console.log("");
  console.log("Source:             Fixture Macro Series");
  console.log(`Rows read:          ${result.recordsRead}`);
  console.log(`Accepted:           ${result.recordsAccepted}`);
  console.log(`Rejected:           ${result.recordsRejected}`);
  console.log(`Persisted:          ${result.persisted}`);
  console.log(`Run status:         ${result.status}`);
  console.log(`Run ID:             ${result.runId}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Rejection details:");
    for (const err of result.errors) {
      console.log(`  Row ${JSON.stringify(err.row)}:`);
      for (const e of err.errors) {
        console.log(`    - ${e}`);
      }
    }
  }

  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
