import { getPrisma } from "@/lib/prisma";
import { type IngestionStatus } from "@/generated/prisma/enums";

async function getDataSourcesWithRuns() {
  const prisma = getPrisma();
  const sources = await prisma.dataSource.findMany({
    orderBy: [{ provider: "asc" }, { name: "asc" }],
    include: {
      ingestionRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });
  return sources;
}

async function getRecentRuns() {
  const prisma = getPrisma();
  const runs = await prisma.ingestionRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    include: { dataSource: true },
  });
  return runs;
}

function deriveStatus(
  latestRun: { status: IngestionStatus; completedAt: Date | null } | undefined,
  active: boolean,
): string {
  if (!active) return "INACTIVE";
  if (!latestRun) return "NOT_CONFIGURED";
  if (latestRun.status === "FAILED") return "FAILED";
  if (latestRun.status === "RUNNING") return "RUNNING";
  if (latestRun.status === "SUCCESS" && latestRun.completedAt) {
    const age = Date.now() - latestRun.completedAt.getTime();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (age > THIRTY_DAYS) return "STALE";
    return "HEALTHY";
  }
  return "UNKNOWN";
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    HEALTHY: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    STALE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    FAILED: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    NOT_CONFIGURED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    INACTIVE: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
    RUNNING: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    UNKNOWN: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors.UNKNOWN}`}>
      {status}
    </span>
  );
}

function formatDuration(startedAt: Date, completedAt: Date | null): string {
  if (!completedAt) return "\u2014";
  const ms = completedAt.getTime() - startedAt.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatDate(date: Date | null): string {
  if (!date) return "\u2014";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(date: Date | null): string {
  if (!date) return "\u2014";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DataCentrePage() {
  const [sources, recentRuns] = await Promise.all([
    getDataSourcesWithRuns(),
    getRecentRuns(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Data Centre
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Data source health, ingestion history, and manual import tools.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Dataset Health
        </h2>
        {sources.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-400">No data sources configured yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Dataset</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Provider</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Method</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Frequency</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Last Refresh</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => {
                  const latestRun = src.ingestionRuns[0];
                  const status = deriveStatus(
                    latestRun ? { status: latestRun.status, completedAt: latestRun.completedAt } : undefined,
                    src.active,
                  );
                  return (
                    <tr key={src.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                      <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">{src.name}</td>
                      <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{src.provider}</td>
                      <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{src.ingestionMethod}</td>
                      <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{src.expectedFrequency}</td>
                      <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                        {formatDate(latestRun?.completedAt ?? null)}
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge status={status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Recent Ingestion Runs
        </h2>
        {recentRuns.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-400">No ingestion runs recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Started</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Duration</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Read</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Accepted</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Rejected</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Triggered By</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Outcome</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Error</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">{run.dataSource.name}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDateTime(run.startedAt)}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDuration(run.startedAt, run.completedAt)}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{run.recordsRead ?? "\u2014"}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{run.recordsAccepted ?? "\u2014"}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{run.recordsRejected ?? "\u2014"}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{run.triggeredBy ?? "\u2014"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={run.status} /></td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                      {run.errorMessage ?? "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
