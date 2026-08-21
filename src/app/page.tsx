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
import {
  getMarketIndexSnapshot,
  getSecuritiesWithReturns,
  getMarketActivity,
  type MarketIndexSnapshot,
} from "@/lib/queries/equities";
import {
  evaluateInflationCondition,
  evaluateFxCondition,
  evaluateMonetaryPolicyCondition,
  evaluateShortTermRatesCondition,
  evaluateEquityMomentumCondition,
  buildMarketConditionSummary,
  rankByMateriality,
  INFLATION_NOISE_BAND_PP,
  FX_NOISE_BAND_PCT,
  RATES_NOISE_BAND_BPS,
  EQUITY_NOISE_BAND_PCT,
  type MaterialityCandidate,
} from "@/lib/intelligence";
import { MarketConditionSection } from "@/components/MarketConditionSection";

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

// GSE-CI follows ordinary-equity polarity: rising is positive (green) —
// the same shared direction rule the Equities page and SecuritiesTable
// use for individual securities, applied here to the headline index.
//
// MONTHLY, not DAILY (M8.1): the only GSE-CI history this system has is
// month-end snapshots transcribed from GSE's official monthly Market
// Summary PDF reports, never a live daily feed. Using dailyFreshness here
// would mark last month's real, current figure STALE within a day of
// publication — an honest cadence label matters more than reusing the
// per-security daily-price freshness rule.
function GseCiMetricCard({ index }: { index: MarketIndexSnapshot | null }) {
  const [latest, previous] = index?.latestTwo ?? [];
  if (!latest) return <MetricCard label="GSE Composite Index" unit="index" />;

  const level = Number(latest.level);
  const freshness = observationFreshness("MONTHLY", latest.observationDate);

  let changeLine: React.ReactNode = NO_CHANGE_LINE;
  if (previous) {
    const prevLevel = Number(previous.level);
    const pct = ((level - prevLevel) / prevLevel) * 100;
    const { arrow, sentiment } = describeDirection(level, prevLevel, "higherIsPositive");
    changeLine = <DirectionText arrow={arrow} text={`${Math.abs(pct).toFixed(2)}%`} suffix="vs previous month-end" sentiment={sentiment} />;
  }

  return (
    <CardShell
      label="GSE Composite Index"
      freshness={freshness}
      value={level.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      changeLine={changeLine}
      footer={`Month-end · ${formatObservationDate(latest.observationDate)} · Ghana Stock Exchange`}
    />
  );
}

export default async function OverviewPage() {
  const [latestRun, sourceCount, runCount, fx, treasury, mpr, inflation, gseCi, securities] = await Promise.all([
    getLatestIngestionRun(),
    getDataSourceCount(),
    getIngestionRunCount(),
    getUsdGhsSnapshot(),
    getTreasurySnapshot(),
    getMprSnapshot(),
    getInflationSnapshot(),
    getMarketIndexSnapshot("GSE-CI"),
    getSecuritiesWithReturns(),
  ]);

  const [fxLatest, fxPrevious] = fx.latestTwo;
  const { latestDecision: mprLatestDecision, lastChange: mprLastChange } = mpr;
  const [inflationLatest, inflationPrevious] = inflation.latestTwo;
  const treasuryByCode = new Map(treasury.map((t) => [t.code, t]));
  const [gseCiLatest, gseCiPrevious] = gseCi?.latestTwo ?? [];
  // See equities/page.tsx for why this filters on actual price data
  // rather than Security row existence.
  const securitiesWithPrices = securities.filter((s) => s.latestPrice !== null);
  const marketActivity = getMarketActivity(securitiesWithPrices, 5);
  const hasAnySecurities = securitiesWithPrices.length > 0;

  // Explainable market-intelligence layer (M8 Part B) — pure recomputation
  // over the same real observations already fetched above; see
  // src/lib/intelligence/ for the deterministic rules each dimension uses.
  const inflationResult = evaluateInflationCondition({
    latest: inflationLatest ? { observationDate: inflationLatest.observationDate, value: Number(inflationLatest.value) } : null,
    previous: inflationPrevious ? { observationDate: inflationPrevious.observationDate, value: Number(inflationPrevious.value) } : null,
    history: inflation.history,
  });
  const fxResult = evaluateFxCondition({
    latest: fxLatest ? { observationDate: fxLatest.observationDate, midRate: Number(fxLatest.midRate) } : null,
    previous: fxPrevious ? { observationDate: fxPrevious.observationDate, midRate: Number(fxPrevious.midRate) } : null,
    history: fx.history,
  });
  const monetaryPolicyResult = evaluateMonetaryPolicyCondition({
    latestDecision: mprLatestDecision
      ? {
          decisionDate: mprLatestDecision.decisionDate,
          resultingRate: Number(mprLatestDecision.resultingRate),
          decisionType: mprLatestDecision.decisionType,
          changeBps: mprLatestDecision.changeBps,
        }
      : null,
  });
  const ratesResult = evaluateShortTermRatesCondition(
    TREASURY_INSTRUMENTS.map(({ code, label }) => {
      const snapshot = treasuryByCode.get(code);
      const [latest, previous] = snapshot?.latestTwo ?? [];
      return {
        label,
        latest: latest ? { observationDate: latest.observationDate, interestRate: Number(latest.interestRate) } : null,
        previous: previous ? { observationDate: previous.observationDate, interestRate: Number(previous.interestRate) } : null,
      };
    }),
  );
  const equityResult = evaluateEquityMomentumCondition({
    latest: gseCiLatest ? { observationDate: gseCiLatest.observationDate, level: Number(gseCiLatest.level) } : null,
    history: gseCi?.history ?? [],
  });

  const marketCondition = buildMarketConditionSummary({
    inflation: inflationResult,
    currency: fxResult,
    monetaryPolicy: monetaryPolicyResult,
    shortTermRates: ratesResult,
    equityMomentum: equityResult,
  });

  const treasuryChartSeries: RatesSeries[] = treasury
    .filter((t) => t.history.length > 0)
    .map((t) => ({ key: t.code, label: t.label, color: TREASURY_CHART_COLORS[t.code] ?? "#71717a", data: t.history }));

  const changedItems: { key: string; node: React.ReactNode; magnitude: number }[] = [];

  if (gseCiLatest && gseCiPrevious) {
    const level = Number(gseCiLatest.level);
    const prevLevel = Number(gseCiPrevious.level);
    const pct = ((level - prevLevel) / prevLevel) * 100;
    const { arrow, sentiment } = describeDirection(level, prevLevel, "higherIsPositive");
    changedItems.push({
      key: "gse-ci",
      magnitude: Math.abs(pct) / EQUITY_NOISE_BAND_PCT,
      node: (
        <>
          <span className="font-medium">GSE-CI</span>{" "}
          <DirectionText
            arrow={arrow}
            text={`${Math.abs(pct).toFixed(2)}%`}
            suffix={`vs previous month-end (${formatObservationDate(gseCiPrevious.observationDate)} → ${formatObservationDate(gseCiLatest.observationDate)})`}
            sentiment={sentiment}
          />
        </>
      ),
    });
  }

  if (inflationLatest && inflationPrevious) {
    const rate = Number(inflationLatest.value);
    const prevRate = Number(inflationPrevious.value);
    const pp = ppChange(rate, prevRate);
    const { arrow, sentiment } = describeDirection(rate, prevRate, "higherIsNegative");
    changedItems.push({
      key: "inflation",
      magnitude: Math.abs(pp) / INFLATION_NOISE_BAND_PP,
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
      magnitude: Math.abs(pct) / FX_NOISE_BAND_PCT,
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
        magnitude: Math.abs(bps) / RATES_NOISE_BAND_BPS,
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
    // A HOLD is the least "changed" thing on this list — still shown, but
    // never competes for a top-5 slot against an actual rate move.
    const mprMagnitude = mprLatestDecision.decisionType === "HOLD" ? 0 : Math.abs(mprLatestDecision.changeBps ?? RATES_NOISE_BAND_BPS) / RATES_NOISE_BAND_BPS;
    changedItems.push({
      key: "mpr",
      magnitude: mprMagnitude,
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

  // Rank by materiality (M8 §30-31): each candidate's own noise band, not a
  // shared unit, so a 0.5pp inflation move is never compared to a 0.5% GSE
  // move as though the scales were the same thing. Top 5, most-material first.
  const changedItemsByKey = new Map(changedItems.map((item) => [item.key, item]));
  const rankedChangedItems = rankByMateriality(changedItems.map((item): MaterialityCandidate => ({ key: item.key, absChange: item.magnitude, noiseBand: 1 })))
    .map((key) => changedItemsByKey.get(key)!)
    .slice(0, 5);

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
          <GseCiMetricCard index={gseCi} />
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
          {rankedChangedItems.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              {rankedChangedItems.map((item) => (
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
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              GSE Performance
            </p>
            <RatesChart series={[{ key: "gseci", label: "GSE-CI", color: "#10b981", data: gseCi?.history ?? [] }]} unit="pts" />
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
        {hasAnySecurities ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Top Gainers</p>
              {marketActivity.gainers.length === 0 ? (
                <p className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-500">No gainers today</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {marketActivity.gainers.slice(0, 3).map((g) => (
                    <li key={g.ticker} className="flex items-center justify-between">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{g.ticker}</span>
                      <DirectionText arrow={DIRECTION_ARROW.up} text={`${g.oneDayChangePct.toFixed(2)}%`} sentiment="positive" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Top Losers</p>
              {marketActivity.losers.length === 0 ? (
                <p className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-500">No losers today</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {marketActivity.losers.slice(0, 3).map((l) => (
                    <li key={l.ticker} className="flex items-center justify-between">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{l.ticker}</span>
                      <DirectionText arrow={DIRECTION_ARROW.down} text={`${Math.abs(l.oneDayChangePct).toFixed(2)}%`} sentiment="negative" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Most Traded — By Value</p>
              {marketActivity.mostTradedByValue.length === 0 ? (
                <p className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-500">No trading activity recorded</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {marketActivity.mostTradedByValue.slice(0, 3).map((m) => (
                    <li key={m.ticker} className="flex items-center justify-between">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{m.ticker}</span>
                      <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                        GHS {(m.latestValueTradedGhs ?? 0).toLocaleString("en-GH", { maximumFractionDigits: 0 })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Awaiting first official GSE import — see Equities for details
            </p>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Market Condition
        </h2>
        <MarketConditionSection summary={marketCondition} />
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
