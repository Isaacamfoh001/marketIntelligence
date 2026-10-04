// ---------------------------------------------------------------------------
// Integration tests for the BoG Government Bond/Note auction ingestion
// (M7.1 §7). Real database, mocked HTTP — mirrors
// bog-treasury-ingestion.integration.test.ts's pattern exactly. Synthetic
// rows use a 2099-dated "now" so the recency cutoff always accepts them
// without depending on the real current date, and cleanup targets exactly
// what these tests create.
//
// The provider fetches the main page once (for the wpDataTables nonce/
// table id) then POSTs the historical AJAX query for the actual rows —
// both calls are mocked here, mirroring ingestBogTreasuryBackfill's test.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/http", () => ({
  fetchBogText: vi.fn(),
  postBogForm: vi.fn(),
}));

import { fetchBogText, postBogForm } from "../ingestion/http";
import { ingestBogGovernmentBonds } from "../ingestion/bog-government-bonds-provider";

const db = getPrisma();
const mockFetch = vi.mocked(fetchBogText);
const mockPost = vi.mocked(postBogForm);
const createdRunIds: string[] = [];
const NOW = new Date("2099-01-15T00:00:00.000Z");

async function trackedIngest(now: Date = NOW) {
  const result = await ingestBogGovernmentBonds(now);
  createdRunIds.push(result.runId);
  return result;
}

function pageHtmlWithNonce(): string {
  return `<input id="wdtNonceFrontendServerSide_2" name="wdtNonceFrontendServerSide_2" value="deadbeef00" /><input id="table_1_desc" value='{"tableWpId":2}' />`;
}

function ajaxJson(rows: string[][]): string {
  return JSON.stringify({ draw: 1, recordsTotal: rows.length, recordsFiltered: rows.length, data: rows });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPost.mockReset();
  mockFetch.mockResolvedValue(pageHtmlWithNonce());
});

afterAll(async () => {
  const securities = await db.fixedIncomeSecurity.findMany({ where: { instrumentCode: { startsWith: "GOG-" }, issueDate: { gte: new Date("2099-01-01T00:00:00.000Z") } } });
  const securityIds = securities.map((s) => s.id);
  await db.fixedIncomeObservation.deleteMany({ where: { securityId: { in: securityIds } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { id: { in: securityIds } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestBogGovernmentBonds", () => {
  it("persists a recent fixed-rate bond auction as a GOVERNMENT_BOND with an AUCTION_PRIMARY observation", async () => {
    mockPost.mockResolvedValueOnce(
      ajaxJson([
        ["07 Jan 2099", "9101", "4 YR FXR BOND", "12.0000", "12.0000"],
        ["07 Jan 2099", "9101", "91 DAY BILL", "4.6244", "4.6785"], // ignored — not a bond/note
      ]),
    );

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(1); // only the bond row, bill already excluded at the filter stage
    expect(result.recordsAccepted).toBe(1);
    expect(result.inserted).toBe(1);

    const security = await db.fixedIncomeSecurity.findUniqueOrThrow({
      where: { instrumentCode: "GOG-4Y-AUCTION-9101" },
      include: { source: true, ingestionRun: true, observations: true },
    });
    expect(security.instrumentType).toBe("GOVERNMENT_BOND");
    expect(security.classification).toBe("SOVEREIGN");
    expect(security.couponType).toBe("FIXED");
    expect(Number(security.couponRatePct)).toBe(12);
    expect(security.couponFrequency).toBe("SEMI_ANNUAL");
    expect(security.issueDate.toISOString().slice(0, 10)).toBe("2099-01-07");
    expect(security.maturityDate.toISOString().slice(0, 10)).toBe("2103-01-07");
    expect(security.source.provider).toBe("Bank of Ghana");

    expect(security.observations).toHaveLength(1);
    expect(security.observations[0].observationKind).toBe("AUCTION_PRIMARY");
    expect(Number(security.observations[0].sourceYieldPct)).toBe(12);
    expect(security.observations[0].cleanPrice).toBeNull();
  });

  it("excludes a stale pre-restructuring auction beyond the recency cutoff", async () => {
    mockPost.mockResolvedValueOnce(ajaxJson([["09 May 2022", "1797", "2 YR FXR NOTE", "21.5000", "21.5000"]]));

    const result = await trackedIngest(NOW);

    expect(result.recordsRead).toBe(1);
    expect(result.recordsAccepted).toBe(0);
    expect(result.inserted).toBe(0);
  });

  it("is idempotent across a re-run with the same auction data (upsert, no duplicate)", async () => {
    mockPost.mockResolvedValue(ajaxJson([["08 Jan 2099", "9102", "4 YR FXR BOND", "12.5000", "12.5000"]]));

    const first = await trackedIngest();
    expect(first.inserted).toBe(1);

    const second = await trackedIngest();
    expect(second.updated).toBe(1);
    expect(second.inserted).toBe(0);

    const count = await db.fixedIncomeSecurity.count({ where: { instrumentCode: "GOG-4Y-AUCTION-9102" } });
    expect(count).toBe(1);
  });

  it("rejects a discount/interest mismatch rather than guessing which number is the coupon", async () => {
    mockPost.mockResolvedValueOnce(ajaxJson([["09 Jan 2099", "9103", "5 YR FXR BOND", "10.0000", "11.0000"]]));

    const result = await trackedIngest();
    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsRejected).toBe(1);
  });
});
