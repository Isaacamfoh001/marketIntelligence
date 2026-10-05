// ---------------------------------------------------------------------------
// M8.2 exposure panels. Server components that only present what
// computeExposures() produced. Value-based panels say "valued positions only";
// contractual panels say they rest on bond terms, not market data.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { EXPOSURE_ASSET_CLASS_LABEL, EXPOSURE_COPY, type PortfolioExposures } from "@/lib/portfolio";
import { formatGhs, formatIsoDate, formatTimeRemaining } from "@/lib/fixed-income";
import { CLASS_BAR, ExposurePanel, Metric, ghsCompact, plural } from "./exposure-ui";
import { MaturityLadderChart } from "./MaturityLadderChart";
import { RecencyBadge } from "./ui";

const pct1 = (n: number) => `${n.toFixed(1)}%`;
const posHref = (portfolioId: string, positionId: string) => `/portfolios/${portfolioId}?position=${positionId}#inspect`;
const ghs0 = (n: number) => `GHS ${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

export function Callouts({ callouts }: { callouts: string[] }) {
  if (callouts.length === 0) return null;
  return (
    <ul aria-label="Portfolio observations" className="grid gap-x-6 gap-y-1 rounded border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 md:grid-cols-2">
      {callouts.map((c) => (
        <li key={c} className="flex gap-2">
          <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-zinc-400" />
          {c}
        </li>
      ))}
    </ul>
  );
}

export function AssetAllocationPanel({ e }: { e: PortfolioExposures }) {
  const a = e.allocation;
  return (
    <ExposurePanel id="allocation" title="Asset allocation" basis={a.rows.length > 0 ? "Valued positions only" : undefined} method={<p>{EXPOSURE_COPY.allocation}</p>}>
      {a.rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{e.positionCount === 0 ? "No positions yet." : "No position can be valued today, so there is no value-based allocation to show."}</p>
      ) : (
        <>
          <div className="flex h-4 w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={`Allocation of valued reference value: ${a.rows.map((r) => `${r.label} ${pct1(r.pct)}`).join(", ")}`}>
            {a.rows.map((r) => (
              <div key={r.assetClass} className={CLASS_BAR[r.assetClass]} style={{ width: `${r.pct}%` }} title={`${r.label}: ${formatGhs(r.referenceValueGhs)} (${pct1(r.pct)})`} />
            ))}
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Asset class</th>
                <th>Reference value</th>
                <th>Share of valued reference value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {a.rows.map((r) => (
                <tr key={r.assetClass}>
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-2">
                      <span className={`inline-block size-2.5 shrink-0 rounded-sm ${CLASS_BAR[r.assetClass]}`} aria-hidden />
                      <span className="text-zinc-800 dark:text-zinc-200">{r.label}</span>
                    </span>
                    <span className="ml-[18px] block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {plural(r.valuedCount, "position")}
                      {r.unvaluedCount > 0 ? ` · ${r.unvaluedCount} not valued` : ""}
                      {r.staleValueGhs > 0 ? ` · ${pct1((r.staleValueGhs / r.referenceValueGhs) * 100)} on stale inputs` : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatGhs(r.referenceValueGhs)}</td>
                  <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{pct1(r.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            % of valued reference value ({formatGhs(a.denominatorGhs as number)}).
            {a.unvalued.count > 0 && (
              <>
                {" "}
                <span className="text-amber-700 dark:text-amber-400">
                  Not in these shares: {plural(a.unvalued.count, "unvalued position")} ({a.unvalued.byClass.map((c) => `${c.label.toLowerCase()}: ${c.count}`).join(", ")}).
                </span>
              </>
            )}
          </p>
        </>
      )}
    </ExposurePanel>
  );
}

export function IssuerPanel({ e }: { e: PortfolioExposures }) {
  const i = e.issuers;
  const max = i.rows[0]?.pct ?? 0;
  return (
    <ExposurePanel id="issuers" title="Issuer concentration" basis={i.rows.length > 0 ? "Valued positions only" : undefined} method={<p>{EXPOSURE_COPY.issuer}</p>}>
      {i.rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{e.positionCount === 0 ? "No positions yet." : "No valued positions, so issuer concentration cannot be shown."}</p>
      ) : (
        <>
          <ol className="space-y-2.5">
            {i.rows.map((r) => (
              <li key={r.issuer.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-200" title={r.issuer.name}>
                    {r.issuer.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pct1(r.pct)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full rounded bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                  <div className="flex h-2 overflow-hidden rounded" style={{ width: `${max > 0 ? (r.pct / max) * 100 : 0}%` }}>
                    <div className={`h-full w-full ${CLASS_BAR[r.assetClasses[0]]}`} />
                  </div>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {formatGhs(r.referenceValueGhs)} · {r.assetClasses.map((c) => EXPOSURE_ASSET_CLASS_LABEL[c].toLowerCase()).join(" + ")} · {plural(r.valuedCount, "valued position")}
                  {r.unvaluedCount > 0 && <span className="text-amber-700 dark:text-amber-400"> · {r.unvaluedCount} additional {r.unvaluedCount === 1 ? "position is" : "positions are"} unvalued</span>}
                </p>
              </li>
            ))}
          </ol>
          {i.unvaluedOnly.length > 0 && (
            <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-amber-700 dark:border-zinc-800 dark:text-amber-400">
              No value-based share (all positions unvalued): {i.unvaluedOnly.map((u) => `${u.issuer.name} (${u.unvaluedCount})`).join(", ")}.
            </p>
          )}
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">% of valued reference value ({formatGhs(i.denominatorGhs as number)}). Bar colour shows the issuer&rsquo;s first asset class.</p>
        </>
      )}
    </ExposurePanel>
  );
}

export function MaturityLadderPanel({ e, portfolioId }: { e: PortfolioExposures; portfolioId: string }) {
  const m = e.maturity;
  return (
    <ExposurePanel
      id="maturity"
      title="Maturity ladder"
      basis="Contractual nominal / face"
      method={
        <>
          <p>{EXPOSURE_COPY.maturity}</p>
          <p>{EXPOSURE_COPY.maturityBuckets}</p>
        </>
      }
    >
      {m.eligibleCount === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{m.bondPositionCount + m.treasuryBillPositionCount === 0 ? "No bond or Treasury-bill positions." : "No bond or Treasury bill has reliable maturity terms to place on the ladder."}</p>
      ) : (
        <>
          <MaturityLadderChart data={m.buckets.map((b) => ({ label: b.label, nominalGhs: b.nominalGhs, nominalPct: b.nominalPct, positionCount: b.positionCount, valuedReferenceValueGhs: b.valuedReferenceValueGhs, valuedCount: b.valuedCount, unvaluedNominalGhs: b.unvaluedNominalGhs }))} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 text-left font-medium">Maturing</th>
                  <th className="py-1 pr-2 text-right font-medium">Nominal / face</th>
                  <th className="py-1 pr-2 text-right font-medium">% of total</th>
                  <th className="py-1 text-right font-medium">Valued ref. value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
                {m.buckets.map((b) => (
                  <tr key={b.key} className="text-zinc-700 dark:text-zinc-300">
                    <td className="py-1 pr-2 text-left">
                      {b.label} <span className="text-zinc-400 dark:text-zinc-500">· {b.positionCount}</span>
                    </td>
                    <td className="py-1 pr-2 text-right">{ghs0(b.nominalGhs)}</td>
                    <td className="py-1 pr-2 text-right font-semibold text-zinc-900 dark:text-zinc-100">{b.nominalPct === null ? "—" : pct1(b.nominalPct)}</td>
                    <td className="py-1 text-right">{b.valuedCount > 0 ? ghs0(b.valuedReferenceValueGhs) : "—"}{b.unvaluedNominalGhs > 0 && <span className="text-amber-700 dark:text-amber-400" title="Nominal in this bucket with no reference value"> ·{ghsCompact(b.unvaluedNominalGhs)} unvalued</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            % of eligible nominal / face ({formatGhs(m.eligibleNominalGhs)}, {plural(m.eligibleCount, "bond or bill", "bonds and bills")}). Includes positions without a market valuation; reference-value column is valued positions only.
            {m.buckets.some((b) => b.treasuryBillFaceGhs > 0) && ` Treasury bills (${formatGhs(m.buckets.reduce((s, b) => s + b.treasuryBillFaceGhs, 0))} face) each repay their face value once, at maturity.`}
          </p>
        </>
      )}
      {m.excluded.length > 0 && <Excluded title="Left off the ladder" items={m.excluded} portfolioId={portfolioId} />}
    </ExposurePanel>
  );
}

function Excluded({ title, items, portfolioId }: { title: string; items: { positionId: string; label: string; reason: string }[]; portfolioId: string }) {
  return (
    <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
      <p className="font-medium">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((x) => (
          <li key={x.positionId}>
            <Link href={posHref(portfolioId, x.positionId)} className="font-medium underline">
              {x.label}
            </Link>{" "}
            — {x.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BillRates({ b, portfolioId }: { b: PortfolioExposures["rates"]["treasuryBills"]; portfolioId: string }) {
  return (
    <div className="mb-4 border-b border-zinc-100 pb-4 dark:border-zinc-800">
      <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Treasury bills — sensitivity to the short-term rate</h4>
      {b.dv01Ghs === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No Treasury bill can be valued today, so its rate sensitivity cannot be calculated.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Metric label="T-bill DV01" value={formatGhs(b.dv01Ghs)} sub="per 1bp rise in bill rates" hint="Approximate change in valued Treasury-bill reference value for a 1bp parallel rise in the bill reference rate" />
            <Metric label="Modified duration" value={b.weightedModifiedDurationYears === null ? "—" : `${b.weightedModifiedDurationYears.toFixed(2)} yrs`} sub="reference-value weighted" />
          </dl>
          <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            {b.contributors.map((p) => (
              <li key={p.positionId}>
                <Link href={posHref(portfolioId, p.positionId)} className="font-medium text-zinc-800 hover:underline dark:text-zinc-200">
                  {p.label}
                </Link>{" "}
                — {ghs0(p.dv01Ghs)}/bp · {p.daysToMaturity} days left · reference rate {p.referenceRatePct.toFixed(2)}%{p.recency === "STALE" && " · stale auction rate"}
              </li>
            ))}
          </ul>
        </>
      )}
      {b.excluded.length > 0 && <Excluded title={`No sensitivity figure for ${plural(b.excluded.length, "Treasury bill")}`} items={b.excluded} portfolioId={portfolioId} />}
    </div>
  );
}

export function RateSensitivityPanel({ e, portfolioId }: { e: PortfolioExposures; portfolioId: string }) {
  const r = e.rates;
  const max = r.contributors[0]?.dv01Ghs ?? 0;
  const c = r.coverage;
  return (
    <ExposurePanel
      id="rates"
      title="Interest-rate sensitivity"
      basis="Valued fixed-income positions"
      method={
        <>
          <p>
            <strong>Treasury-bill DV01.</strong> {EXPOSURE_COPY.billDv01}
          </p>
          <p>
            <strong>Bond DV01.</strong> {EXPOSURE_COPY.dv01}
          </p>
          <p>
            <strong>Modified duration.</strong> {EXPOSURE_COPY.duration}
          </p>
        </>
      }
    >
      {r.treasuryBills.billPositionCount > 0 && <BillRates b={r.treasuryBills} portfolioId={portfolioId} />}
      {c.bondPositionCount === 0 && r.treasuryBills.billPositionCount > 0 ? null : r.bondDv01Ghs === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{c.bondPositionCount === 0 ? "No bond positions, so there is no interest-rate sensitivity." : "No bond can be valued today, so its rate sensitivity cannot be calculated."}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Metric label="Bond DV01" value={`${formatGhs(r.bondDv01Ghs)}`} sub="per 1bp parallel yield rise" hint="Approximate change in valued bond sleeve for a 1bp parallel yield movement" />
            <Metric label="Government DV01" value={formatGhs(r.governmentDv01Ghs)} sub="per bp" />
            <Metric label="Corporate DV01" value={formatGhs(r.corporateDv01Ghs)} sub="per bp" />
            <Metric label="Bond modified duration" value={r.weightedModifiedDurationYears === null ? "—" : `${r.weightedModifiedDurationYears.toFixed(2)} yrs`} sub="reference-value weighted" hint="Bond sleeve only — equities excluded" />
          </dl>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Coverage: {c.contributingCount} of {plural(c.bondPositionCount, "bond position")}, covering {formatGhs(c.coveredReferenceValueGhs)} of {formatGhs(c.valuedBondReferenceValueGhs)} valued bond reference value.
            {r.staleCount > 0 && <span className="text-amber-700 dark:text-amber-400"> {r.staleCount === 1 ? "1 contributing bond rests" : `${r.staleCount} contributing bonds rest`} on stale inputs ({formatGhs(r.staleDv01Ghs)}/bp of the total).</span>}
          </p>
          <h4 className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">DV01 by position</h4>
          <ol className="space-y-2">
            {r.contributors.map((p) => (
              <li key={p.positionId}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Link href={posHref(portfolioId, p.positionId)} className="truncate font-medium text-zinc-800 hover:underline dark:text-zinc-200">
                      {p.label}
                    </Link>
                    {p.recency === "STALE" && <RecencyBadge recency="STALE" />}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-900 dark:text-zinc-100">
                    <span className="font-semibold">{ghs0(p.dv01Ghs)}</span>/bp <span className="text-[11px] text-zinc-500 dark:text-zinc-400">· {pct1(p.sharePct)}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                  <div className={`h-1.5 rounded ${CLASS_BAR[p.assetClass]}`} style={{ width: `${max > 0 ? (p.dv01Ghs / max) * 100 : 0}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Nominal {ghs0(p.nominalGhs)} · mod. duration {p.modifiedDurationYears.toFixed(2)} yrs
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
      {c.excluded.length > 0 && <Excluded title={`No sensitivity figure for ${plural(c.excluded.length, "bond position")}`} items={c.excluded} portfolioId={portfolioId} />}
    </ExposurePanel>
  );
}

export function CouponPanel({ e, portfolioId }: { e: PortfolioExposures; portfolioId: string }) {
  const c = e.coupon;
  return (
    <ExposurePanel id="coupon" title="Annual contractual coupon" basis="From bond terms" method={<p>{EXPOSURE_COPY.coupon}</p>}>
      {c.annualCouponGhs === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{c.bondPositionCount === 0 ? "No bond positions." : "No fixed-coupon bond with reliable terms."}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Metric label="Total" value={formatGhs(c.annualCouponGhs)} sub={`${c.includedCount} of ${plural(c.bondPositionCount, "bond position")}`} />
            <Metric label="Government" value={formatGhs(c.governmentGhs)} />
            <Metric label="Corporate" value={formatGhs(c.corporateGhs)} />
          </dl>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 text-left font-medium">Bond</th>
                  <th className="py-1 pr-2 text-right font-medium">Nominal</th>
                  <th className="py-1 pr-2 text-right font-medium">Coupon</th>
                  <th className="py-1 text-right font-medium">Annual coupon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
                {c.rows.map((r) => (
                  <tr key={r.positionId} className="text-zinc-700 dark:text-zinc-300">
                    <td className="py-1 pr-2 text-left">
                      <Link href={posHref(portfolioId, r.positionId)} className="font-medium hover:underline">
                        {r.label}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 text-right">{ghs0(r.nominalGhs)}</td>
                    <td className="py-1 pr-2 text-right">
                      {r.couponRatePct.toFixed(2)}% <span className="text-zinc-400 dark:text-zinc-500">×{r.paymentsPerYear}</span>
                    </td>
                    <td className="py-1 text-right font-semibold text-zinc-900 dark:text-zinc-100">{formatGhs(r.annualCouponGhs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Contractual, not a return or forecast. &ldquo;×2&rdquo; = payments per year; each payment is the annual amount ÷ that number.
            {c.zeroCouponCount > 0 && ` ${plural(c.zeroCouponCount, "zero-coupon bond")} pay no coupon.`}
          </p>
        </>
      )}
      {c.excluded.length > 0 && <Excluded title="Left out of coupon total" items={c.excluded} portfolioId={portfolioId} />}
    </ExposurePanel>
  );
}

export function UpcomingMaturitiesPanel({ e, portfolioId }: { e: PortfolioExposures; portfolioId: string }) {
  return (
    <ExposurePanel id="upcoming" title="Upcoming maturities" basis="Nearest contractual principal" method={<p>{EXPOSURE_COPY.upcoming}</p>}>
      {e.upcoming.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No bond or Treasury bill with reliable maturity terms.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <th className="py-1 pr-2 text-left font-medium">Holding</th>
                <th className="py-1 pr-2 text-left font-medium">Matures</th>
                <th className="py-1 pr-2 text-right font-medium">Nominal / face held</th>
                <th className="py-1 text-right font-medium">Reference value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {e.upcoming.map((u) => (
                <tr key={u.positionId} className="align-top text-zinc-700 dark:text-zinc-300">
                  <td className="py-1.5 pr-2">
                    <Link href={posHref(portfolioId, u.positionId)} className="font-medium hover:underline">
                      {u.label}
                    </Link>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{u.issuerName}</div>
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2">
                    {formatIsoDate(u.maturityDate)}
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {formatTimeRemaining(u.daysRemaining)}
                      {u.withinNext12Months ? " · within 12 months" : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{formatGhs(u.nominalGhs)}</td>
                  <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{u.referenceValueGhs === null ? <span className="text-amber-700 dark:text-amber-400">Not valued</span> : formatGhs(u.referenceValueGhs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ExposurePanel>
  );
}

