import { describe, expect, it } from "vitest";
import { classifyEquitySource, classifySecurityTrade, describeEquityDataState, weekdaysBetween } from "../source-currency";
import { describeSourceNotice } from "../source-notice";
import type { EquitySourceStatus } from "../../queries/equity-source";

const at = (iso: string) => new Date(`${iso}T09:00:00Z`);
const run = (status: "SUCCESS" | "FAILED", iso: string) => ({ status, at: at(iso) });

describe("weekdaysBetween", () => {
  it("counts only Mon–Fri days strictly after `from`", () => {
    expect(weekdaysBetween("2026-10-02", "2026-10-02")).toBe(0);
    expect(weekdaysBetween("2026-10-02", "2026-10-05")).toBe(1); // Fri → Mon: weekend skipped
    expect(weekdaysBetween("2026-08-24", "2026-10-05")).toBe(30);
  });
  it("never goes negative", () => {
    expect(weekdaysBetween("2026-10-05", "2026-10-02")).toBe(0);
  });
});

describe("classifyEquitySource (pipeline currency)", () => {
  it("is MISSING with no report at all", () => {
    expect(classifyEquitySource({ latestReportDate: null, now: at("2026-10-05") }).state).toBe("MISSING");
  });
  it("Monday: Friday's report is CURRENT (weekend is not a lag)", () => {
    const s = classifyEquitySource({ latestReportDate: "2026-10-02", now: at("2026-10-05") });
    expect(s.state).toBe("CURRENT");
    expect(s.weekdaysBehind).toBe(1);
  });
  it("Saturday and Sunday: Friday's report is CURRENT", () => {
    expect(classifyEquitySource({ latestReportDate: "2026-10-02", now: at("2026-10-03") }).state).toBe("CURRENT");
    expect(classifyEquitySource({ latestReportDate: "2026-10-02", now: at("2026-10-04") }).state).toBe("CURRENT");
  });
  it("Tuesday: Friday's report is STALE (Monday's was not imported)", () => {
    expect(classifyEquitySource({ latestReportDate: "2026-10-02", now: at("2026-10-06") }).state).toBe("STALE");
  });
  it("the real 24 Aug ceiling is STALE on 5 Oct", () => {
    const s = classifyEquitySource({ latestReportDate: "2026-08-24", now: at("2026-10-05") });
    expect(s.state).toBe("STALE");
    expect(s.weekdaysBehind).toBe(30);
  });
  it("flags a failed refresh only when it is newer than the last success", () => {
    const base = { latestReportDate: "2026-10-02", now: at("2026-10-05") };
    expect(classifyEquitySource({ ...base, runs: [run("SUCCESS", "2026-10-03"), run("FAILED", "2026-10-04")] }).lastRefreshFailed).toBe(true);
    expect(classifyEquitySource({ ...base, runs: [run("FAILED", "2026-10-03"), run("SUCCESS", "2026-10-04")] }).lastRefreshFailed).toBe(false);
    expect(classifyEquitySource({ ...base, runs: [run("FAILED", "2026-10-04")] }).lastRefreshFailed).toBe(true);
    expect(classifyEquitySource({ ...base, runs: [] }).lastRefreshFailed).toBe(false);
  });
});

describe("classifySecurityTrade (security recency, same 7-day window as M8.1)", () => {
  const now = at("2026-10-05");
  it("recent / boundary / stale / none", () => {
    expect(classifySecurityTrade("2026-10-02", now)).toEqual({ recency: "RECENT", ageDays: 3 });
    expect(classifySecurityTrade("2026-09-28", now)).toEqual({ recency: "RECENT", ageDays: 7 });
    expect(classifySecurityTrade("2026-09-27", now)).toEqual({ recency: "STALE", ageDays: 8 });
    expect(classifySecurityTrade(null, now)).toEqual({ recency: "NONE", ageDays: null });
  });
});

describe("describeEquityDataState — source and security are separate questions", () => {
  const now = at("2026-10-05");
  const current = classifyEquitySource({ latestReportDate: "2026-10-02", now });
  const stale = classifyEquitySource({ latestReportDate: "2026-08-24", now });
  const missing = classifyEquitySource({ latestReportDate: null, now });

  it("current source + recent trade", () => {
    expect(describeEquityDataState(current, "2026-10-02", now).code).toBe("SOURCE_CURRENT_RECENT_TRADE");
  });
  it("current source + stale security (illiquid stock in a healthy pipeline)", () => {
    const s = describeEquityDataState(current, "2026-06-10", now);
    expect(s.code).toBe("SOURCE_CURRENT_STALE_TRADE");
    expect(s.headline).toContain("Latest GSE data is current");
    expect(s.headline).toContain("117 days");
  });
  it("stale source outranks a security whose last trade looks recent as of that stale report", () => {
    const s = describeEquityDataState(stale, "2026-08-24", now);
    expect(s.code).toBe("SOURCE_STALE");
    expect(s.headline).toContain("24 Aug 2026");
  });
  it("current source + never traded", () => {
    expect(describeEquityDataState(current, null, now).code).toBe("NO_RELIABLE_TRADE");
  });
  it("no source at all", () => {
    expect(describeEquityDataState(missing, null, now).code).toBe("SOURCE_MISSING");
  });
});

describe("describeSourceNotice", () => {
  const base = (over: Partial<EquitySourceStatus>): EquitySourceStatus => ({
    currency: { state: "CURRENT", latestReportDate: "2026-10-02", weekdaysBehind: 1, lastRefreshFailed: false },
    latestActualTradeDate: "2026-10-02",
    coverage: null,
    absentFromLatestReport: [],
    lastRun: null,
    lastSuccessfulRun: null,
    latestReportRunIds: [],
    now: at("2026-10-05"),
    ...over,
  });
  it("is quiet (ok) when current", () => expect(describeSourceNotice(base({})).tone).toBe("ok"));
  it("warns when stale and names the report date", () => {
    const n = describeSourceNotice(base({ currency: { state: "STALE", latestReportDate: "2026-08-24", weekdaysBehind: 30, lastRefreshFailed: false } }));
    expect(n.tone).toBe("warn");
    expect(n.headline).toContain("24 Aug 2026");
  });
  it("warns when missing", () => expect(describeSourceNotice(base({ currency: { state: "MISSING", latestReportDate: null, weekdaysBehind: null, lastRefreshFailed: false } })).tone).toBe("warn"));
  it("warns when current but the last refresh failed", () => {
    const n = describeSourceNotice(base({ currency: { state: "CURRENT", latestReportDate: "2026-10-02", weekdaysBehind: 1, lastRefreshFailed: true } }));
    expect(n.tone).toBe("warn");
    expect(n.details.join(" ")).toContain("FAILED");
  });
});
