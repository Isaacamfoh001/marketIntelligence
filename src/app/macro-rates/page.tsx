import { RatesChart, LONG_HISTORY_WINDOWS } from "@/components/RatesChart";
import { GdpChart } from "@/components/GdpChart";
import {
  getUsdGhsSnapshot,
  getTreasurySnapshot,
  getMprSnapshot,
  getInflationSnapshot,
  getGdpSnapshot,
  getRecentTreasuryRates,
  getRecentMprDecisions,
  getRecentGdpObservations,
  formatObservationDate,
  bpsChange,
  ppChange,
  quarterLabel,
  TREASURY_INSTRUMENTS,
  type PolicyDecisionRow,
} from "@/lib/queries/market-data";

function DecisionBadge({ type }: { type: PolicyDecisionRow["decisionType"] }) {
  const styles: Record<string, string> = {
    HOLD: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    CUT: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    HIKE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${styles[type]}`}>
      {type === "HOLD" ? "HELD" : type}
    </span>
  );
}

export const dynamic = "force-dynamic";

const TREASURY_CHART_COLORS: Record<string, string> = {
  "91_DAY_BILL": "#3b82f6",
  "182_DAY_BILL": "#8b5cf6",
  "364_DAY_BILL": "#ec4899",
};

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm text-zinc-400">{message}</p>
    </div>
  );
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>
    </div>
  );
}

export default async function MacroRatesPage() {
  const [fx, treasury, mpr, inflation, gdp, recentTreasury, recentMpr, recentGdp] = await Promise.all([
    getUsdGhsSnapshot(),
    getTreasurySnapshot(),
    getMprSnapshot(),
    getInflationSnapshot(),
    getGdpSnapshot(),
    getRecentTreasuryRates(20),
    getRecentMprDecisions(10),
    getRecentGdpObservations(8),
  ]);

  const [inflationLatest, inflationPrevious] = inflation.latestTwo;
  const [gdpLatest, gdpPrevious] = gdp.latestTwo;

  const [fxLatest] = fx.latestTwo;
  const { latestDecision: mprLatestDecision, lastChange: mprLastChange } = mpr;

  const treasuryChartSeries = treasury
    .filter((t) => t.history.length > 0)
    .map((t) => ({ key: t.code, label: t.label, color: TREASURY_CHART_COLORS[t.code] ?? "#71717a", data: t.history }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Macro & Rates</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Ghana monetary policy, Treasury bill rates, and foreign exchange — sourced and dated at the observation level.
        </p>
      </div>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Monetary Policy
        </h2>
        {mprLatestDecision ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="grid grid-cols-3 gap-4">
                <StatBlock
                  label="Current MPR"
                  value={`${Number(mprLatestDecision.resultingRate).toFixed(2)}%`}
                  sub="as of latest decision"
                />
                <StatBlock
                  label="Latest MPC Decision"
                  value={mprLatestDecision.decisionType === "HOLD" ? "HELD" : mprLatestDecision.decisionType}
                  sub={formatObservationDate(mprLatestDecision.decisionDate)}
                />
                <StatBlock
                  label="Last Rate Change"
                  value={mprLastChange ? `${mprLastChange.decisionType} ${mprLastChange.changeBps != null ? `${mprLastChange.changeBps > 0 ? "+" : ""}${mprLastChange.changeBps}bps` : ""}` : "—"}
                  sub={mprLastChange ? formatObservationDate(mprLastChange.decisionDate) : "no change on record"}
                />
              </div>
              <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
                Rate history: Bank of Ghana — Policy Rate Trends (Historical Policy Rate Decisions). Meeting
                confirmation beyond that table: Bank of Ghana — MPC Press Release archive. Event-driven: one
                decision per MPC meeting, not a manufactured monthly series.
              </p>
            </SectionCard>
            <div className="lg:col-span-2">
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Policy Rate History
                </p>
                <RatesChart series={[{ key: "rate", label: "Policy Rate", color: "#f59e0b", data: mpr.history }]} unit="%" />
              </SectionCard>
            </div>
          </div>
        ) : (
          <EmptyState message="No Monetary Policy Rate data available yet" />
        )}

        {recentMpr.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Decision Date</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Policy Rate</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Decision</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Change</th>
                </tr>
              </thead>
              <tbody>
                {recentMpr.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatObservationDate(row.decisionDate)}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{Number(row.resultingRate).toFixed(2)}%</td>
                    <td className="whitespace-nowrap px-4 py-2"><DecisionBadge type={row.decisionType} /></td>
                    <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {row.changeBps == null ? "—" : `${row.changeBps > 0 ? "+" : ""}${row.changeBps} bps`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Treasury Bills
        </h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {TREASURY_INSTRUMENTS.map(({ code, label }) => {
            const snapshot = treasury.find((t) => t.code === code);
            const [latest, previous] = snapshot?.latestTwo ?? [];
            return (
              <SectionCard key={code}>
                {latest ? (
                  <div className="grid grid-cols-2 gap-4">
                    <StatBlock
                      label={`${label} Interest Rate`}
                      value={`${Number(latest.interestRate).toFixed(2)}%`}
                      sub={formatObservationDate(latest.observationDate)}
                    />
                    <StatBlock
                      label="Discount Rate"
                      value={`${Number(latest.discountRate).toFixed(2)}%`}
                      sub={previous ? `${bpsChange(Number(latest.interestRate), Number(previous.interestRate))} bps vs prior auction` : "no prior auction stored"}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">No {label} data yet</p>
                )}
              </SectionCard>
            );
          })}
        </div>

        <div className="mt-3">
          <SectionCard>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Treasury Yields History
            </p>
            <RatesChart series={treasuryChartSeries} unit="%" height={220} />
          </SectionCard>
        </div>

        {recentTreasury.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Issue Date</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tenor</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tender</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Discount Rate</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Interest Rate</th>
                </tr>
              </thead>
              <tbody>
                {recentTreasury.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatObservationDate(row.observationDate)}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.instrumentLabel}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.tenderNumber ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{Number(row.discountRate).toFixed(4)}%</td>
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{Number(row.interestRate).toFixed(4)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Foreign Exchange
        </h2>
        {fxLatest ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock
                  label="USD/GHS Mid Rate"
                  value={Number(fxLatest.midRate).toFixed(4)}
                  sub={formatObservationDate(fxLatest.observationDate)}
                />
                <StatBlock
                  label="Buying / Selling"
                  value={`${Number(fxLatest.buyingRate).toFixed(4)} / ${Number(fxLatest.sellingRate).toFixed(4)}`}
                  sub="interbank reference rates"
                />
              </div>
              <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
                Source: Bank of Ghana — Daily Interbank FX Rates.
              </p>
            </SectionCard>
            <div className="lg:col-span-2">
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  USD/GHS History
                </p>
                <RatesChart series={[{ key: "mid", label: "USD/GHS", color: "#3b82f6", data: fx.history }]} unit="GHS" />
              </SectionCard>
            </div>
          </div>
        ) : (
          <EmptyState message="No USD/GHS data available yet" />
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Inflation
        </h2>
        {inflationLatest ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock
                  label="Headline YoY Inflation"
                  value={`${Number(inflationLatest.value).toFixed(1)}%`}
                  sub={`Reference ${formatObservationDate(inflationLatest.observationDate)}`}
                />
                <StatBlock
                  label="Change"
                  value={
                    inflationPrevious
                      ? (() => {
                          const pp = ppChange(Number(inflationLatest.value), Number(inflationPrevious.value));
                          return `${pp > 0 ? "+" : ""}${pp.toFixed(2)} pp`;
                        })()
                      : "—"
                  }
                  sub={inflationPrevious ? `vs ${formatObservationDate(inflationPrevious.observationDate)}` : "no prior month stored"}
                />
              </div>
              <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
                Source: Ghana Statistical Service — StatsBank/PxWeb (Consumer Price Index and Inflation). Reference
                month dated to month-end; may lag the latest GSS press release — see Data Centre for freshness.
              </p>
            </SectionCard>
            <div className="lg:col-span-2">
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Inflation History (Headline YoY)
                </p>
                <RatesChart
                  series={[{ key: "yoy", label: "Headline YoY", color: "#f59e0b", data: inflation.history }]}
                  unit="%"
                  windows={LONG_HISTORY_WINDOWS}
                  defaultWindow="5Y"
                />
              </SectionCard>
            </div>
          </div>
        ) : (
          <EmptyState message="No inflation data available yet" />
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          GDP / Economic Activity
        </h2>
        {gdpLatest ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock
                  label="Real GDP Growth (YoY)"
                  value={`${Number(gdpLatest.value).toFixed(1)}%`}
                  sub={quarterLabel(gdpLatest.observationDate)}
                />
                <StatBlock
                  label="Previous Quarter"
                  value={gdpPrevious ? `${Number(gdpPrevious.value).toFixed(1)}%` : "—"}
                  sub={gdpPrevious ? quarterLabel(gdpPrevious.observationDate) : "no prior quarter stored"}
                />
              </div>
              <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
                Source: Ghana Statistical Service — StatsBank/PxWeb (Quarterly GDP, Production Approach, Overall
                GDP). Headline year-on-year growth measure, as GSS itself leads with in its quarterly release.
              </p>
            </SectionCard>
            <div className="lg:col-span-2">
              <SectionCard>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Quarterly Real GDP Growth (YoY)
                </p>
                <GdpChart data={gdp.history} height={200} />
              </SectionCard>
            </div>
          </div>
        ) : (
          <EmptyState message="No GDP data available yet" />
        )}

        {recentGdp.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[360px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Quarter</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Real GDP Growth (YoY)</th>
                </tr>
              </thead>
              <tbody>
                {recentGdp.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">{quarterLabel(row.observationDate)}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{Number(row.value).toFixed(1)}%</td>
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
