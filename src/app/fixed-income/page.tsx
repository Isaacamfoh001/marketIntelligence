import Link from "next/link";
import { getFixedIncomeUniverse, getSovereignYieldCurve } from "@/lib/queries/fixed-income";
import { getTreasurySnapshot, TREASURY_INSTRUMENTS, formatObservationDate } from "@/lib/queries/market-data";
import { COUPON_FREQUENCY_LABEL } from "@/lib/fixed-income/classification";
import { YieldCurveChart } from "@/components/YieldCurveChart";

export const dynamic = "force-dynamic";

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">{children}</div>;
}

function StatBlock({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

function formatTenor(tenorDays: number): string {
  if (tenorDays <= 0) return "Matured";
  if (tenorDays < 365) return `${tenorDays}d`;
  const years = tenorDays / 365;
  return `${years.toFixed(years >= 10 ? 0 : 1)}y`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CouponCell({ couponType, couponRatePct, couponFrequency }: { couponType: string; couponRatePct: number | null; couponFrequency: string | null }) {
  if (couponType === "ZERO_COUPON") return <span>Zero coupon</span>;
  if (couponType === "FLOATING") return <span>Floating{couponRatePct !== null ? ` (ref. ${couponRatePct.toFixed(2)}%)` : ""}</span>;
  return (
    <span>
      {couponRatePct?.toFixed(2)}% <span className="text-zinc-400 dark:text-zinc-500">{couponFrequency ? COUPON_FREQUENCY_LABEL[couponFrequency as keyof typeof COUPON_FREQUENCY_LABEL] : ""}</span>
    </span>
  );
}

function BondTable({ rows, showSpread }: { rows: Awaited<ReturnType<typeof getFixedIncomeUniverse>>; showSpread: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-zinc-200 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No instruments imported yet — see Data Centre to import the Securities Master dataset.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[840px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Instrument</th>
            <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Issuer</th>
            <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Maturity</th>
            <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tenor</th>
            <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Coupon</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Price</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">YTM</th>
            {showSpread && <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Duration</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className="whitespace-nowrap px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                <Link href={`/fixed-income/${encodeURIComponent(r.instrumentCode)}`} className="hover:underline">
                  {r.instrumentCode}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{r.issuerName}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDate(r.maturityDate)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatTenor(r.analytics.tenorDays)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                <CouponCell couponType={r.couponType} couponRatePct={r.couponRatePct} couponFrequency={r.couponFrequency} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                {r.analytics.cleanPrice !== null ? r.analytics.cleanPrice.toFixed(2) : "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {r.analytics.ytmPct !== null ? `${r.analytics.ytmPct.toFixed(2)}%` : "—"}
              </td>
              {showSpread && (
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {r.analytics.modifiedDurationYears !== null ? `${r.analytics.modifiedDurationYears.toFixed(2)}y` : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function FixedIncomePage() {
  const [universe, curve, treasury] = await Promise.all([getFixedIncomeUniverse(), getSovereignYieldCurve(), getTreasurySnapshot()]);

  const governmentBonds = universe.filter((r) => r.instrumentType === "GOVERNMENT_BOND");
  const corporateBonds = universe.filter((r) => r.instrumentType === "CORPORATE_BOND");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Fixed Income</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Ghana sovereign and corporate fixed-income securities — contractual terms, yield analytics, and relative value, sourced and dated at the observation level.
          </p>
        </div>
        <Link
          href="/fixed-income/compare"
          className="shrink-0 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Compare Securities
        </Link>
      </div>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Treasury Bills</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TREASURY_INSTRUMENTS.map(({ code, label }) => {
            const snapshot = treasury.find((t) => t.code === code);
            const [latest] = snapshot?.latestTwo ?? [];
            return (
              <SectionCard key={code}>
                {latest ? (
                  <StatBlock label={`${label} Interest Rate`} value={`${Number(latest.interestRate).toFixed(2)}%`} sub={formatObservationDate(latest.observationDate)} />
                ) : (
                  <StatBlock label={`${label}`} value="—" sub="No auction data yet" />
                )}
              </SectionCard>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Treasury bills use the existing Bank of Ghana auction data —{" "}
          <Link href="/macro-rates" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
            see full Treasury Bills history on Macro &amp; Rates
          </Link>
          .
        </p>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Ghana Sovereign Yield Curve</h2>
        <SectionCard>
          <YieldCurveChart points={curve} />
        </SectionCard>
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Government Bonds</h2>
        <BondTable rows={governmentBonds} showSpread={false} />
      </section>

      {/* ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Corporate Bonds</h2>
        <BondTable rows={corporateBonds} showSpread={true} />
      </section>
    </div>
  );
}
