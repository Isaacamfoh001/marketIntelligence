import { getPrisma } from "@/lib/prisma";
import { dailyFreshness, observationFreshness, type Freshness } from "@/lib/freshness";
import { describeDirection, DIRECTION_ARROW, type Direction } from "@/lib/direction";
import { DirectionText } from "@/components/DirectionText";
import { RatesChart, type RatesSeries } from "@/components/RatesChart";
import {
  getUsdGhsSnapshot,
  getTreasurySnapshot,
  getMprSnapshot,
  getInflationSnapshot,
  formatObservationDate,
  bpsChange,
  ppChange,
  TREASURY_INSTRUMENTS,
  type FxObservation,
  type TreasuryObservation,
  type PolicyDecisionRow,
  type MacroSeriesObservation,
} from "@/lib/queries/market-data";

function decisionLabel(type: PolicyDecisionRow["decisionType"]): string {
  return type === "HOLD" ? "HELD" : type;
}

/** Policy decisions are already classified (HIKE/CUT/HOLD) — no arithmetic needed to know their direction. */
function directionForDecision(type: PolicyDecisionRow["decisionType"]): Direction {
  if (type === "HIKE") return "up";
  if (type === "CUT") return "down";
  return "flat";
}

// Database-backed page: must reflect the latest ingestion state on every
// request, not the state at build time.
export const dynamic = "force-dynamic";

const TREASURY_CHART_COLORS: Record<string, string> = {
  "91_DAY_BILL": "#3b82f6",
  "182_DAY_BILL": "#8b5cf6",
  "364_DAY_BILL": "#ec4899",
};

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

function FreshnessBadge({ freshness }: { freshness: Freshness }) {
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

const NO_CHANGE_LINE = <span className="text-zinc-400 dark:text-zinc-500">·</span>;

function CardShell({
  label,
  freshness,
  value,
  changeLine,
  footer,
}: {
  label: string;
  freshness?: Freshness;
  value: string;
  changeLine: React.ReactNode;
  footer: string;
}) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </div>
        {freshness && <FreshnessBadge freshness={freshness} />}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      <div className="mt-1 text-xs">{changeLine}</div>
      <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{footer}</div>
    </div>
  );
}

// USD/GHS is quoted GHS-per-USD, so a rising rate means the cedi
// weakened — the opposite of an equity index rising. Spelled out
// explicitly (not just color) so an upward arrow paired with red never
// reads as a UI bug.
function FxMetricCard({ latest, previous }: { latest: FxObservation | undefined; previous: FxObservation | undefined }) {
  if (!latest) return <MetricCard label="USD/GHS" unit="GHS" />;

  const mid = Number(latest.midRate);
  const freshness = dailyFreshness(latest.observationDate);

  let changeLine: React.ReactNode = NO_CHANGE_LINE;
  if (previous) {
    const prevMid = Number(previous.midRate);
    const pct = ((mid - prevMid) / prevMid) * 100;
    const { arrow, sentiment, direction } = describeDirection(mid, prevMid, "higherIsNegative");
    const cediLabel = direction === "up" ? "Cedi weakened" : direction === "down" ? "Cedi strengthened" : undefined;
    changeLine = (
      <DirectionText
        arrow={arrow}
        text={`${Math.abs(pct).toFixed(2)}%`}
        label={cediLabel}
        suffix={`vs ${formatObservationDate(previous.observationDate)}`}
        sentiment={sentiment}
      />
    );
  }

  return (
    <CardShell
      label="USD/GHS"
      freshness={freshness}
      value={mid.toFixed(4)}
      changeLine={changeLine}
      footer={`Mid rate · ${formatObservationDate(latest.observationDate)} · Bank of Ghana`}
    />
  );
}

// Treasury yield direction has no single universal meaning (a higher
// yield can be attractive to an income investor while also implying
// tighter financial conditions) — always neutral, never red/green.
function TreasuryMetricCard({ label, latest, previous }: { label: string; latest: TreasuryObservation | undefined; previous: TreasuryObservation | undefined }) {
  if (!latest) return <MetricCard label={`${label} T-Bill`} unit="%" />;

  const interest = Number(latest.interestRate);
  const discount = Number(latest.discountRate);
  const freshness = observationFreshness("WEEKLY", latest.observationDate);

  let changeLine: React.ReactNode = NO_CHANGE_LINE;
  if (previous) {
    const bps = bpsChange(interest, Number(previous.interestRate));
    const { arrow, sentiment } = describeDirection(interest, Number(previous.interestRate), "neutral");
    changeLine = <DirectionText arrow={arrow} text={`${Math.abs(bps)} bps`} suffix="vs previous auction" sentiment={sentiment} />;
  }

  return (
    <CardShell
      label={`${label} T-Bill`}
      freshness={freshness}
      value={`${interest.toFixed(2)}%`}
      changeLine={changeLine}
      footer={`Interest rate · Discount ${discount.toFixed(2)}% · ${formatObservationDate(latest.observationDate)}`}
    />
  );
}

// Policy-rate direction also defaults to neutral — a cut or hike's market
// interpretation belongs in a later Market Condition layer, not here.
function MprMetricCard({
  latestDecision,
  lastChange,
}: {
  latestDecision: PolicyDecisionRow | undefined;
  lastChange: PolicyDecisionRow | undefined;
}) {
  if (!latestDecision) return <MetricCard label="BoG Policy Rate" unit="%" />;

  const rate = Number(latestDecision.resultingRate);
  const latestWasAChange = latestDecision.decisionType !== "HOLD";

  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        BoG Policy Rate
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{rate.toFixed(2)}%</div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Latest decision: {formatObservationDate(latestDecision.decisionDate)} — {decisionLabel(latestDecision.decisionType)}
      </div>
      {!latestWasAChange && lastChange && (
        <div className="mt-0.5 text-xs">
          <DirectionText
            arrow={DIRECTION_ARROW[directionForDecision(lastChange.decisionType)]}
            text={lastChange.changeBps != null ? `${Math.abs(lastChange.changeBps)} bps` : "—"}
            label={decisionLabel(lastChange.decisionType)}
            suffix={`since ${formatObservationDate(lastChange.decisionDate)}`}
            sentiment="neutral"
          />
        </div>
      )}
      <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">MPC decision · Bank of Ghana</div>
    </div>
  );
}

// Rising inflation erodes purchasing power — higher is negative, the
// opposite of an equity index.
function InflationMetricCard({ latest, previous }: { latest: MacroSeriesObservation | undefined; previous: MacroSeriesObservation | undefined }) {
  if (!latest) return <MetricCard label="CPI Inflation (YoY)" unit="%" />;

  const rate = Number(latest.value);
  const freshness = observationFreshness("MONTHLY", latest.observationDate);

  let changeLine: React.ReactNode = NO_CHANGE_LINE;
  if (previous) {
    const pp = ppChange(rate, Number(previous.value));
    const { arrow, sentiment } = describeDirection(rate, Number(previous.value), "higherIsNegative");
    changeLine = <DirectionText arrow={arrow} text={`${Math.abs(pp).toFixed(2)} pp`} suffix="vs previous month" sentiment={sentiment} />;
  }

  return (
    <CardShell
      label="CPI Inflation (YoY)"
      freshness={freshness}
      value={`${rate.toFixed(1)}%`}
      changeLine={changeLine}
      footer={`Reference ${formatObservationDate(latest.observationDate)} · GSS`}
    />
  );
}

export default async function OverviewPage() {
  const [latestRun, sourceCount, runCount, fx, treasury, mpr, inflation] = await Promise.all([
    getLatestIngestionRun(),
    getDataSourceCount(),
    getIngestionRunCount(),
    getUsdGhsSnapshot(),
    getTreasurySnapshot(),
    getMprSnapshot(),
    getInflationSnapshot(),
  ]);

  const [fxLatest, fxPrevious] = fx.latestTwo;
  const { latestDecision: mprLatestDecision, lastChange: mprLastChange } = mpr;
  const [inflationLatest, inflationPrevious] = inflation.latestTwo;
  const treasuryByCode = new Map(treasury.map((t) => [t.code, t]));

  const treasuryChartSeries: RatesSeries[] = treasury
    .filter((t) => t.history.length > 0)
    .map((t) => ({ key: t.code, label: t.label, color: TREASURY_CHART_COLORS[t.code] ?? "#71717a", data: t.history }));

  const changedItems: { key: string; node: React.ReactNode }[] = [];

  if (inflationLatest && inflationPrevious) {
    const rate = Number(inflationLatest.value);
    const prevRate = Number(inflationPrevious.value);
    const pp = ppChange(rate, prevRate);
    const { arrow, sentiment } = describeDirection(rate, prevRate, "higherIsNegative");
    changedItems.push({
      key: "inflation",
      node: (
        <>
          <span className="font-medium">Inflation</span>{" "}
          <DirectionText
            arrow={arrow}
            text={`${Math.abs(pp).toFixed(2)} pp`}
            suffix={`vs previous month (${formatObservationDate(inflationPrevious.observationDate)} → ${formatObservationDate(inflationLatest.observationDate)})`}
            sentiment={sentiment}
          />
        </>
      ),
    });
  }

  if (fxLatest && fxPrevious) {
    const mid = Number(fxLatest.midRate);
    const prevMid = Number(fxPrevious.midRate);
    const pct = ((mid - prevMid) / prevMid) * 100;
    const { arrow, sentiment, direction } = describeDirection(mid, prevMid, "higherIsNegative");
    const cediLabel = direction === "up" ? "Cedi weakened" : direction === "down" ? "Cedi strengthened" : undefined;
    changedItems.push({
      key: "fx",
      node: (
        <>
          <span className="font-medium">USD/GHS</span>{" "}
          <DirectionText
            arrow={arrow}
            text={`${Math.abs(pct).toFixed(2)}%`}
            label={cediLabel}
            suffix={`vs previous available observation (${formatObservationDate(fxPrevious.observationDate)} → ${formatObservationDate(fxLatest.observationDate)})`}
            sentiment={sentiment}
          />
        </>
      ),
    });
  }

  for (const { code, label } of TREASURY_INSTRUMENTS) {
    const snapshot = treasuryByCode.get(code);
    const [latest, previous] = snapshot?.latestTwo ?? [];
    if (latest && previous) {
      const interest = Number(latest.interestRate);
      const prevInterest = Number(previous.interestRate);
      const bps = bpsChange(interest, prevInterest);
      const { arrow, sentiment } = describeDirection(interest, prevInterest, "neutral");
      changedItems.push({
        key: code,
        node: (
          <>
            <span className="font-medium">{label} T-Bill</span>{" "}
            <DirectionText arrow={arrow} text={`${Math.abs(bps)} bps`} suffix="vs previous auction" sentiment={sentiment} />
          </>
        ),
      });
    }
  }

  if (mprLatestDecision) {
    const rate = Number(mprLatestDecision.resultingRate);
    changedItems.push({
      key: "mpr",
      node:
        mprLatestDecision.decisionType === "HOLD" ? (
          <>
            <span className="font-medium">Policy Rate</span>{" "}
            <DirectionText
              arrow={DIRECTION_ARROW.flat}
              text={`held at ${rate.toFixed(2)}%`}
              suffix={`latest MPC decision ${formatObservationDate(mprLatestDecision.decisionDate)}`}
              sentiment="neutral"
            />
          </>
        ) : (
          <>
            <span className="font-medium">Policy Rate</span>{" "}
            <DirectionText
              arrow={DIRECTION_ARROW[directionForDecision(mprLatestDecision.decisionType)]}
              text={`${mprLatestDecision.changeBps != null ? Math.abs(mprLatestDecision.changeBps) : "—"} bps`}
              label={decisionLabel(mprLatestDecision.decisionType)}
              suffix={`to ${rate.toFixed(2)}% at latest MPC decision (${formatObservationDate(mprLatestDecision.decisionDate)})`}
              sentiment="neutral"
            />
          </>
        ),
    });
  }

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
          <InflationMetricCard latest={inflationLatest} previous={inflationPrevious} />
          <MprMetricCard latestDecision={mprLatestDecision ?? undefined} lastChange={mprLastChange ?? undefined} />
          {TREASURY_INSTRUMENTS.map(({ code, label }) => {
            const snapshot = treasuryByCode.get(code);
            const [latest, previous] = snapshot?.latestTwo ?? [];
            return <TreasuryMetricCard key={code} label={label} latest={latest} previous={previous} />;
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          What Changed?
        </h2>
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {changedItems.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              {changedItems.map((item) => (
                <li key={item.key}>{item.node}</li>
              ))}
            </ul>
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
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Treasury Yields
            </p>
            <RatesChart series={treasuryChartSeries} unit="%" />
          </div>
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              USD/GHS
            </p>
            <RatesChart series={[{ key: "mid", label: "USD/GHS", color: "#3b82f6", data: fx.history }]} unit="GHS" />
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
          <div className="flex flex-wrap items-center gap-4 text-sm">
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
