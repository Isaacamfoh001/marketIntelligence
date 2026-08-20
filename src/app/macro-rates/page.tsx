import { RatesChart } from "@/components/RatesChart";
import {
  getUsdGhsSnapshot,
  getTreasurySnapshot,
  getMprSnapshot,
  getRecentTreasuryRates,
  getRecentMprDecisions,
  formatObservationDate,
  bpsChange,
  TREASURY_INSTRUMENTS,
} from "@/lib/queries/market-data";

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
  const [fx, treasury, mpr, recentTreasury, recentMpr] = await Promise.all([
    getUsdGhsSnapshot(),
    getTreasurySnapshot(),
    getMprSnapshot(),
    getRecentTreasuryRates(20),
    getRecentMprDecisions(10),
  ]);

  const [fxLatest] = fx.latestTwo;
  const [mprLatest, mprPrevious] = mpr.latestTwo;

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
        {mprLatest ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SectionCard>
              <div className="grid grid-cols-2 gap-4">
                <StatBlock
                  label="BoG Policy Rate"
                  value={`${Number(mprLatest.value).toFixed(2)}%`}
                  sub={`Effective ${formatObservationDate(mprLatest.observationDate)}`}
                />
                <StatBlock
                  label="Change"
                  value={mprPrevious ? `${bpsChange(Number(mprLatest.value), Number(mprPrevious.value))} bps` : "—"}
                  sub={mprPrevious ? `since ${formatObservationDate(mprPrevious.observationDate)}` : "no prior decision stored"}
                />
              </div>
              <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
                Source: Bank of Ghana — Policy Rate Trends (Historical Policy Rate Decisions). Event-driven: one
                observation per MPC decision, not a manufactured monthly series.
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
            <table className="w-full min-w-[400px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Effective Date</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Policy Rate</th>
                </tr>
              </thead>
              <tbody>
                {recentMpr.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatObservationDate(row.observationDate)}</td>
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{Number(row.value).toFixed(2)}%</td>
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
        <EmptyState message="Ghana CPI inflation is not yet connected — planned for Day 5" />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          GDP / Economic Activity
        </h2>
        <EmptyState message="GDP series are not yet connected — planned for Day 5" />
      </section>
    </div>
  );
}
