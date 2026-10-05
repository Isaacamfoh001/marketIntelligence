import { DORMANT_AFTER_DAYS, getEquitySourceStatus } from "@/lib/queries/equity-source";
import { GSE_TRADING_DATA_URL } from "@/lib/ingestion/gse-security-provider";

function d(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function dt(x: Date | null | undefined): string {
  return x ? `${x.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

const BADGE = {
  CURRENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  STALE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MISSING: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
} as const;

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900 dark:text-zinc-100">{value}</dd>
      {sub && <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</dd>}
    </div>
  );
}

/** GSE equity pipeline health: is Korbly's market SOURCE current? (Per-security trade recency lives on the Equities page.) */
export async function EquityPipelinePanel() {
  const s = await getEquitySourceStatus();
  const { currency: c, coverage: cov, lastRun: run, lastSuccessfulRun: ok } = s;
  const rejected = run?.recordsRejected ?? 0;
  const dropped = s.absentFromLatestReport.filter((a) => !a.dormant);
  const dormant = s.absentFromLatestReport.filter((a) => a.dormant);

  return (
    <section aria-labelledby="equity-pipeline-heading">
      <h2 id="equity-pipeline-heading" className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        GSE Equity Data Pipeline
      </h2>
      <div className="space-y-3 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[c.state]}`}>{c.state === "CURRENT" ? "SOURCE CURRENT" : c.state === "STALE" ? "SOURCE STALE" : "NO DATA"}</span>
          {c.lastRefreshFailed && <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">LAST IMPORT FAILED</span>}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {c.state === "STALE"
              ? `Korbly's newest GSE report is ${c.weekdaysBehind} weekdays old. Import the latest Daily Shares & ETFs export.`
              : c.state === "MISSING"
                ? "No GSE equity report has been imported."
                : "A stock that has not traded recently is not a pipeline problem — see Last trade on the Equities page."}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact label="Latest GSE report date" value={d(c.latestReportDate)} sub="Date the report is stamped with" />
          <Fact label="Latest actual trade (any security)" value={d(s.latestActualTradeDate)} sub="Newest row with volume > 0" />
          <Fact label="Last successful import" value={dt(ok?.completedAt ?? ok?.startedAt)} sub={ok?.artifactName ?? undefined} />
          <Fact label="How acquired" value={ok?.acquisitionMethod === "MANUAL_FILE_IMPORT" ? "Analyst import of official GSE export" : (ok?.acquisitionMethod ?? "—")} sub={`No automated feed — ${GSE_TRADING_DATA_URL.replace("https://", "")}`} />
          <Fact label="Securities in latest report" value={cov ? cov.securitiesInReport : "—"} />
          <Fact label="Actual trade on report date" value={cov ? cov.withActualTrade : "—"} sub="volume > 0" />
          <Fact label="Carried / no trade" value={cov ? cov.carriedNoTrade : "—"} sub="volume = 0: previous close re-printed, not a price" />
          <Fact
            label="Last run result"
            value={run ? `${run.status} · ${run.recordsAccepted ?? 0} accepted, ${rejected} rejected` : "—"}
            sub={run?.errorMessage ? <span className="text-amber-700 dark:text-amber-400">{run.errorMessage}</span> : undefined}
          />
        </dl>

        {dropped.length > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
            Securities that were in earlier reports but are missing from the latest one (possibly suspended or dropped by GSE; not marked inactive automatically):{" "}
            {dropped.map((a) => `${a.ticker} (last report ${d(a.lastReportDate)})`).join(", ")}.
          </p>
        )}
        {dormant.length > 0 && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {dormant.length} active securit{dormant.length === 1 ? "y has" : "ies have"} had no GSE report row for over {DORMANT_AFTER_DAYS} days ({dormant.map((a) => `${a.ticker} since ${d(a.lastReportDate)}`).join(", ")}) — review whether they should be marked inactive.
          </p>
        )}
      </div>
    </section>
  );
}
