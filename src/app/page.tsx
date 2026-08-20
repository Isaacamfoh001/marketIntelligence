import { getPrisma } from "@/lib/prisma";
import { dailyFreshness } from "@/lib/freshness";
import { FxChart, type FxChartPoint } from "@/components/FxChart";

// Database-backed page: must reflect the latest ingestion state on every
// request, not the state at build time.
export const dynamic = "force-dynamic";

const FX_PAIR_CODE = "USDGHS";

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

async function getUsdGhsSnapshot() {
  const prisma = getPrisma();
  const pair = await prisma.currencyPair.findUnique({ where: { code: FX_PAIR_CODE } });
  if (!pair) return { latestTwo: [], history: [] as FxChartPoint[] };

  const [latestTwo, history] = await Promise.all([
    prisma.exchangeRate.findMany({
      where: { currencyPairId: pair.id },
      orderBy: { observationDate: "desc" },
      take: 2,
      include: { source: true },
    }),
    prisma.exchangeRate.findMany({
      where: { currencyPairId: pair.id },
      orderBy: { observationDate: "asc" },
      select: { observationDate: true, midRate: true },
    }),
  ]);

  const chartHistory: FxChartPoint[] = history.map((row) => ({
    date: row.observationDate.toISOString().slice(0, 10),
    mid: Number(row.midRate),
  }));

  return { latestTwo, history: chartHistory };
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

function formatObservationDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function MetricCard({ label, unit }: { label: string; unit?: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        &mdash;
      </div>
      <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        Awaiting source{unit ? ` · ${unit}` : ""}
      </div>
    </div>
  );
}

function FreshnessBadge({ freshness }: { freshness: "CURRENT" | "STALE" | "MISSING" }) {
  const styles: Record<string, string> = {
    CURRENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    STALE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    MISSING: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${styles[freshness]}`}>
      {freshness}
    </span>
  );
}

function FxMetricCard({
  latest,
  previous,
}: {
  latest: { observationDate: Date; midRate: unknown } | undefined;
  previous: { observationDate: Date; midRate: unknown } | undefined;
}) {
  if (!latest) return <MetricCard label="USD/GHS" unit="GHS" />;

  const mid = Number(latest.midRate);
  const freshness = dailyFreshness(latest.observationDate);

  let changeLabel: string | null = null;
  let changeColor = "text-zinc-500 dark:text-zinc-400";
  if (previous) {
    const prevMid = Number(previous.midRate);
    const pct = ((mid - prevMid) / prevMid) * 100;
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
    changeColor = pct > 0 ? "text-red-600 dark:text-red-400" : pct < 0 ? "text-emerald-600 dark:text-emerald-400" : changeColor;
    changeLabel = `${arrow} ${Math.abs(pct).toFixed(2)}% vs ${formatObservationDate(previous.observationDate)}`;
  }

  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          USD/GHS
        </div>
        <FreshnessBadge freshness={freshness} />
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        {mid.toFixed(4)}
      </div>
      <div className={`mt-1 text-xs ${changeColor}`}>{changeLabel ?? "·"}</div>
      <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        Mid rate &middot; {formatObservationDate(latest.observationDate)} &middot; Bank of Ghana
      </div>
    </div>
  );
}

export default async function OverviewPage() {
  const [latestRun, sourceCount, runCount, fx] = await Promise.all([
    getLatestIngestionRun(),
    getDataSourceCount(),
    getIngestionRunCount(),
    getUsdGhsSnapshot(),
  ]);

  const [fxLatest, fxPrevious] = fx.latestTwo;

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
          <FxMetricCard latest={fxLatest} previous={fxPrevious} />
          <MetricCard label="CPI Inflation (YoY)" unit="%" />
          <MetricCard label="BoG Policy Rate" unit="%" />
          <MetricCard label="91-Day T-Bill" unit="%" />
          <MetricCard label="182-Day T-Bill" unit="%" />
          <MetricCard label="364-Day T-Bill" unit="%" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          What Changed?
        </h2>
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {fxLatest && fxPrevious ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="font-medium">USD/GHS</span>{" "}
              {(() => {
                const pct = ((Number(fxLatest.midRate) - Number(fxPrevious.midRate)) / Number(fxPrevious.midRate)) * 100;
                const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
                return `${arrow} ${Math.abs(pct).toFixed(2)}%`;
              })()}{" "}
              <span className="text-zinc-400 dark:text-zinc-500">
                vs previous available observation ({formatObservationDate(fxPrevious.observationDate)} &rarr;{" "}
                {formatObservationDate(fxLatest.observationDate)})
              </span>
            </p>
          ) : (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Not enough observations yet to compare
            </p>
          )}
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
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              USD/GHS
            </p>
            <FxChart data={fx.history} unit="GHS" />
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
