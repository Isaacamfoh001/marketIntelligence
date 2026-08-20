import { getPrisma } from "@/lib/prisma";

// Database-backed page: must reflect the latest ingestion state on every
// request, not the state at build time.
export const dynamic = "force-dynamic";

async function getLatestIngestionRun() {
  const prisma = getPrisma();
  const run = await prisma.ingestionRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { completedAt: "desc" },
    include: { dataSource: true },
  });
  return run;
}

async function getDataSourceCount() {
  const prisma = getPrisma();
  return prisma.dataSource.count();
}

async function getIngestionRunCount() {
  const prisma = getPrisma();
  return prisma.ingestionRun.count();
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "never";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function MetricCard({
  label,
  unit,
}: {
  label: string;
  unit?: string;
}) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        &mdash;
      </div>
      <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        Awaiting source{unit ? ` \u00b7 ${unit}` : ""}
      </div>
    </div>
  );
}

export default async function OverviewPage() {
  const [latestRun, sourceCount, runCount] = await Promise.all([
    getLatestIngestionRun(),
    getDataSourceCount(),
    getIngestionRunCount(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Ghana Market Overview
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {latestRun
            ? `Last data refresh: ${formatRelativeTime(latestRun.completedAt)} via ${latestRun.dataSource.name}`
            : "No data ingested yet"}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Key Indicators
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="GSE Composite Index" unit="index" />
          <MetricCard label="USD/GHS" unit="GHS" />
          <MetricCard label="CPI Inflation (YoY)" unit="%" />
          <MetricCard label="BoG Policy Rate" unit="%" />
          <MetricCard label="91-Day T-Bill" unit="%" />
          <MetricCard label="182-Day T-Bill" unit="%" />
          <MetricCard label="364-Day T-Bill" unit="%" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Charts
        </h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              GSE Performance
            </p>
            <p className="mt-3 text-sm text-zinc-400 dark:text-zinc-500">
              Awaiting index data
            </p>
          </div>
          <div className="rounded border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Treasury Yields
            </p>
            <p className="mt-3 text-sm text-zinc-400 dark:text-zinc-500">
              Awaiting Treasury data
            </p>
          </div>
          <div className="rounded border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              USD/GHS
            </p>
            <p className="mt-3 text-sm text-zinc-400 dark:text-zinc-500">
              Awaiting FX data
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Market Activity
        </h2>
        <div className="rounded border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            Awaiting GSE equity data
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Market Condition
        </h2>
        <div className="rounded border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            Awaiting sufficient data for market-condition assessment
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Data Status
        </h2>
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-zinc-400">Sources: </span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{sourceCount}</span>
            </div>
            <div>
              <span className="text-zinc-400">Ingestion runs: </span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{runCount}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
