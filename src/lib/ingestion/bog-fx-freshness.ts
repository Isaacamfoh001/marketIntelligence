// ---------------------------------------------------------------------------
// Fresh-on-demand USD/GHS refresh guard (M8.2 Part A).
//
// The shared read path (getUsdGhsSnapshot in queries/market-data.ts, used
// by Overview and Macro & Rates) calls ensureFreshUsdGhs() before reading
// the DB. It reuses the existing M3 ingestBogFxDaily provider verbatim —
// no second FX ingestion implementation — and only calls out to Bank of
// Ghana when the latest stored observation is not CURRENT per the
// existing cadence-aware freshness rule (dailyFreshness — business-day
// aware, so a Friday rate viewed on a Saturday/Sunday is not treated as
// stale; see freshness.ts).
//
// Guarded against over-fetching two ways:
//
//  - In-process mutex (`inFlightRefresh`): concurrent requests hitting the
//    same running server process await one shared in-flight refresh
//    instead of each starting their own. `startRefresh` is written so the
//    check-and-set is synchronous (no `await` between reading and writing
//    `inFlightRefresh`) — JS's single-threaded execution means that
//    critical section can never be interleaved by another concurrent
//    call, which is what actually makes the guard race-free, not just the
//    variable's existence.
//
//  - DB-backed cooldown: keyed off IngestionRun.startedAt for the BoG FX
//    DataSource, so a burst of requests across process restarts (or,
//    later, multiple server instances) doesn't repeatedly hit BoG. Counts
//    ANY recent attempt, success or failure — after a BoG outage, the
//    page keeps rendering the last stored observation marked STALE rather
//    than retrying on every subsequent load.
//
// A failed refresh is swallowed here — the run itself is already recorded
// FAILED with full provenance by ingestBogFxDaily/failRun — so a BoG
// outage never breaks Overview/Macro & Rates.
// ---------------------------------------------------------------------------

import { getPrisma } from "../prisma";
import { dailyFreshness } from "../freshness";
import { ingestBogFxDaily } from "./bog-fx-provider";

const FX_DATA_SOURCE_NAME = "Bank of Ghana — Daily Interbank FX Rates";

/** Exported so tests can compute times relative to the same window. */
export const FX_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

let inFlightRefresh: Promise<void> | null = null;

/**
 * Synchronous check-and-set: no `await` between reading and writing
 * `inFlightRefresh`, so this critical section can't be interleaved by a
 * concurrent caller — see file header.
 */
function startRefresh(pairCode: string): Promise<void> {
  if (!inFlightRefresh) {
    inFlightRefresh = ingestBogFxDaily(pairCode)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  return inFlightRefresh;
}

async function recentRefreshAttempted(now: Date): Promise<boolean> {
  const db = getPrisma();
  const dataSource = await db.dataSource.findUnique({ where: { name: FX_DATA_SOURCE_NAME } });
  if (!dataSource) return false;
  const recent = await db.ingestionRun.findFirst({
    where: {
      dataSourceId: dataSource.id,
      startedAt: { gte: new Date(now.getTime() - FX_REFRESH_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  return recent !== null;
}

/**
 * Ensure the given currency pair's latest stored observation is fresh,
 * triggering a bounded BoG refresh if (and only if) it is not CURRENT and
 * no refresh has been attempted within the cooldown window. Never throws —
 * a skipped, in-flight, or failed refresh just leaves the last stored
 * observation in place for the caller to re-read.
 *
 * `now` defaults to the real clock; tests pass an explicit value so
 * freshness/cooldown behavior is deterministic rather than depending on
 * wall-clock time relative to whenever the test happens to run.
 */
export async function ensureFreshUsdGhs(pairCode: string = "USDGHS", now: Date = new Date()): Promise<void> {
  const db = getPrisma();
  const pair = await db.currencyPair.findUnique({ where: { code: pairCode } });
  const latest = pair
    ? await db.exchangeRate.findFirst({
        where: { currencyPairId: pair.id },
        orderBy: { observationDate: "desc" },
        select: { observationDate: true },
      })
    : null;

  if (dailyFreshness(latest?.observationDate ?? null, now) === "CURRENT") return;

  if (inFlightRefresh) {
    await inFlightRefresh;
    return;
  }

  if (await recentRefreshAttempted(now)) return;

  await startRefresh(pairCode);
}
