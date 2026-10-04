"use client";

// ---------------------------------------------------------------------------
// Securities Universe (M7.3 §4/§17/§22) — every government and corporate
// bond, Active by default. Matured securities stay one tab away for
// research instead of crowding the investable view. Issuer filtering
// answers "show me the active Bayport and Kasapreko bonds" without picking
// ISINs, and hands the filtered set straight to Return Scenarios.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatIsoDate, formatPct, formatTimeRemaining, issuerShortName, MATURING_SOON_DAYS, type SecurityLifecycle } from "@/lib/fixed-income";
import type { WorkspaceSecurity } from "@/lib/queries/fixed-income";
import { Segmented } from "./OpportunitiesTable";
import { BenchmarkCell, LifecycleBadge, MarketStatusCell, Missing, NUM, SecurityIdentity, TD, TH, TermsWarning, securityToMarketStatus } from "./ui";

type LifecycleTab = "ACTIVE" | "MATURING_SOON" | "MATURED";
type TypeFilter = "ALL" | "CORPORATE" | "SOVEREIGN";

function inTab(lifecycle: SecurityLifecycle, tab: LifecycleTab): boolean {
  if (tab === "ACTIVE") return lifecycle !== "MATURED"; // Active includes maturing-soon (still investable), badged in the row
  return lifecycle === tab;
}

const MAX_COMPARE = 12;

export function SecurityUniverse({ securities }: { securities: WorkspaceSecurity[] }) {
  const [tab, setTab] = useState<LifecycleTab>("ACTIVE");
  const [type, setType] = useState<TypeFilter>("CORPORATE");
  const [issuers, setIssuers] = useState<Set<string>>(new Set());
  const [quotedOnly, setQuotedOnly] = useState(false);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const ofType = securities.filter((s) => type === "ALL" || s.classification === type);
    return {
      ACTIVE: ofType.filter((s) => inTab(s.lifecycle, "ACTIVE")).length,
      MATURING_SOON: ofType.filter((s) => s.lifecycle === "MATURING_SOON").length,
      MATURED: ofType.filter((s) => s.lifecycle === "MATURED").length,
    };
  }, [securities, type]);

  const issuerOptions = useMemo(() => {
    const names = new Set(securities.filter((s) => (type === "ALL" || s.classification === type) && inTab(s.lifecycle, tab)).map((s) => s.issuerName));
    return [...names].sort((a, b) => issuerShortName(a).localeCompare(issuerShortName(b)));
  }, [securities, type, tab]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return securities
      .filter((s) => (type === "ALL" || s.classification === type) && inTab(s.lifecycle, tab))
      .filter((s) => issuers.size === 0 || issuers.has(s.issuerName))
      .filter((s) => !quotedOnly || s.latestObservationDate !== null)
      .filter((s) => !q || `${s.issuerName} ${s.instrumentCode} ${s.instrumentName}`.toLowerCase().includes(q))
      .sort((a, b) => (tab === "MATURED" ? b.maturityDate.localeCompare(a.maturityDate) : a.maturityDate.localeCompare(b.maturityDate)));
  }, [securities, type, tab, issuers, quotedOnly, query]);

  function toggleIssuer(name: string) {
    setIssuers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const compareCodes = tab !== "MATURED" ? rows.map((r) => r.instrumentCode) : [];
  const canCompare = compareCodes.length > 0 && compareCodes.length <= MAX_COMPARE;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v);
            setIssuers(new Set());
          }}
          options={[
            { value: "ACTIVE", label: "Active", count: counts.ACTIVE },
            { value: "MATURING_SOON", label: "Maturing Soon", count: counts.MATURING_SOON },
            { value: "MATURED", label: "Matured / Historical", count: counts.MATURED },
          ]}
        />
        <Segmented
          value={type}
          onChange={(v) => {
            setType(v);
            setIssuers(new Set());
          }}
          options={[
            { value: "CORPORATE", label: "Corporate" },
            { value: "SOVEREIGN", label: "Government" },
            { value: "ALL", label: "All" },
          ]}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search issuer or ISIN"
          className="w-48 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        {tab !== "MATURED" && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={quotedOnly} onChange={(e) => setQuotedOnly(e.target.checked)} />
            Has a market observation
          </label>
        )}
      </div>

      {issuerOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Issuer</span>
          {issuerOptions.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => toggleIssuer(name)}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                issuers.has(name)
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {issuerShortName(name)}
            </button>
          ))}
          {issuers.size > 0 && (
            <button type="button" onClick={() => setIssuers(new Set())} className="text-xs text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-300">
              clear
            </button>
          )}
        </div>
      )}

      {tab === "MATURING_SOON" && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Redeeming within {MATURING_SOON_DAYS} days — inside the shortest sovereign tenor (91-day T-bill), where return is most sensitive to the price paid.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
          No securities match these filters.
        </p>
      ) : tab === "MATURED" ? (
        <MaturedTable rows={rows} />
      ) : (
        <ActiveTable rows={rows} />
      )}

      {tab !== "MATURED" && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {rows.length} {rows.length === 1 ? "security" : "securities"}: {rows.filter((r) => r.analyticsEligible).length} with a reliable market yield ·{" "}
            {rows.filter((r) => r.latestObservationDate && !r.analyticsEligible).length} needing review ·{" "}
            {rows.filter((r) => !r.latestObservationDate && r.noTradeRecordedSince).length} carried price only ·{" "}
            {rows.filter((r) => !r.latestObservationDate && !r.noTradeRecordedSince).length} never quoted
          </span>
          {canCompare ? (
            <Link
              href={`/fixed-income/compare?codes=${compareCodes.map(encodeURIComponent).join(",")}`}
              className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Compare return scenarios for these {compareCodes.length} →
            </Link>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500">Filter to {MAX_COMPARE} or fewer to compare return scenarios</span>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveTable({ rows }: { rows: WorkspaceSecurity[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className={TH}>Security</th>
            <th className={`${TH} text-right`}>Maturity</th>
            <th className={`${TH} text-right`}>Price</th>
            <th className={`${TH} text-right`}>Observed YTM</th>
            <th className={`${TH} text-right`}>Benchmark</th>
            <th className={`${TH} text-right`}>Last market observation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const quoted = s.latestObservationDate !== null;
            return (
              <tr key={s.instrumentCode} className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30 ${quoted ? "" : "text-zinc-500"}`}>
                <td className={TD}>
                  <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
                  <TermsWarning issues={s.termsIssues} />
                </td>
                <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                  {formatIsoDate(s.maturityDate)}
                  <div className="flex items-center justify-end gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    <LifecycleBadge lifecycle={s.lifecycle} />
                    {formatTimeRemaining(s.analytics.tenorDays)}
                  </div>
                </td>
                <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                  {quoted && s.analytics.cleanPrice !== null ? (
                    s.analytics.cleanPrice.toFixed(2)
                  ) : (
                    <Missing short={quoted ? "Not reported" : "—"} reason={quoted ? "The observation reports a yield but no price." : "No traded price — any price GFIM publishes is carried from an earlier, unknown date."} />
                  )}
                </td>
                <td className={`${NUM} font-semibold`}>
                  {s.analytics.ytmPct === null ? (
                    <Missing reason="No market yield: no trade or quote has been observed. Hypothetical scenario returns are on the security page." />
                  ) : s.analyticsEligible ? (
                    <span className="text-zinc-900 dark:text-zinc-100">{formatPct(s.analytics.ytmPct)}</span>
                  ) : (
                    <span className="cursor-help text-zinc-400 line-through decoration-zinc-400/60 dark:text-zinc-500" title="Withheld from analytics pending data-quality review — see the observation's flag.">
                      {formatPct(s.analytics.ytmPct)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <BenchmarkCell ctx={s.benchmarkContext} />
                </td>
                <td className={`${TD} text-right`}>
                  <MarketStatusCell s={securityToMarketStatus(s)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MaturedTable({ rows }: { rows: WorkspaceSecurity[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className={TH}>Security</th>
            <th className={`${TH} text-right`}>Coupon</th>
            <th className={`${TH} text-right`}>Matured</th>
            <th className={`${TH} text-right`}>Final known observation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.instrumentCode} className="border-b border-zinc-100 text-zinc-600 last:border-0 dark:border-zinc-800/50 dark:text-zinc-400">
              <td className={TD}>
                <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
              </td>
              <td className={NUM}>{s.couponRatePct !== null ? formatPct(s.couponRatePct) : "—"}</td>
              <td className={NUM}>{formatIsoDate(s.maturityDate)}</td>
              <td className={NUM}>
                {s.latestObservationDate ? (
                  <div className="flex flex-col items-end">
                    <span className="text-xs">
                      {formatIsoDate(s.latestObservationDate)}
                      {s.latestObservationCleanPrice !== null ? ` · price ${s.latestObservationCleanPrice.toFixed(2)}` : ""}
                      {s.latestObservationYieldPct !== null ? ` · yield ${formatPct(s.latestObservationYieldPct)}` : ""}
                    </span>
                    {s.observationAfterMaturity && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400" title="An observation dated after contractual maturity should not exist for a real trade — check the source mapping in the Data Centre.">
                        Dated after maturity — verify source
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">None recorded</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
