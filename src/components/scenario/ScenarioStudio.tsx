// ---------------------------------------------------------------------------
// Scenario Studio presentation (M8.4). Layout and labelling ONLY: every number
// and sentence arrives from the pure view-model (src/lib/scenario-studio),
// which itself reads the M8.3 result. Nothing here calculates a financial
// figure. Simple first, evidence underneath (native <details>, no JS needed).
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { ReactNode } from "react";
import { ESTIMATE_NOTICE, EXCLUSION_PRINCIPLE, HYPOTHETICAL_NOTICE, METHODOLOGY, STARTING_VALUE_HELP, signedGhsWhole, type AssumptionView, type ClassDriver, type ConfidenceView, type HeadlineView, type InvestigationItem, type PositionDriver, type PositionView, type StudioView } from "@/lib/scenario-studio";
import { formatIsoDate } from "@/lib/fixed-income";

const HEAD = "mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
const CARD = "rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";

/** Impact wording colour is deliberately muted; the sign and words always carry the meaning. */
export const impactTone = (n: number | null) => (n === null || n === 0 ? "text-zinc-700 dark:text-zinc-300" : n < 0 ? "text-rose-800 dark:text-rose-300" : "text-teal-800 dark:text-teal-300");
const barTone = (n: number) => (n < 0 ? "bg-rose-400/80 dark:bg-rose-400/70" : "bg-teal-500/80 dark:bg-teal-400/70");

export function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={HEAD}>
        {title}
      </h2>
      {hint && <p className="-mt-1 mb-2 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {children}
    </section>
  );
}

export function HypotheticalBanner() {
  return (
    <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
      <strong className="font-semibold">{HYPOTHETICAL_NOTICE}</strong> {ESTIMATE_NOTICE}
    </p>
  );
}

// --------------------------------------------------------------------------
// 1. What are we testing?
// --------------------------------------------------------------------------

export function AssumptionList({ assumptions, removeAction }: { assumptions: AssumptionView[]; removeAction?: (ruleId: string) => ReactNode }) {
  if (assumptions.length === 0) {
    return <p className="rounded border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No assumptions yet — every valued holding keeps its starting value. Choose what to test below.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {assumptions.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="text-sm text-zinc-900 dark:text-zinc-100">
              <span className="mr-2 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{a.technical}</span>
              {a.plain}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {a.levelLabel} assumption{a.levelLabel !== "Asset class" ? ` · ${a.targetLabel}` : ""}
              {a.appliesTo > 0 ? ` · applies to ${a.appliesTo} ${a.appliesTo === 1 ? "holding" : "holdings"}` : ""}
            </p>
            {a.replacesNote && <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{a.replacesNote}</p>}
            {a.noEffectNote && <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{a.noEffectNote}</p>}
          </div>
          {removeAction && a.levelLabel !== "Asset class" ? removeAction(a.id) : null}
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------
// 2. What happens? + trust strip
// --------------------------------------------------------------------------

export function HeadlineResult({ h, c }: { h: HeadlineView; c: ConfidenceView }) {
  if (h.status !== "RESULT") {
    return (
      <section aria-label="Scenario result" className={`${CARD} text-sm text-zinc-700 dark:text-zinc-300`}>
        {h.sentence}
      </section>
    );
  }
  return (
    <section aria-label="Scenario result" className={CARD}>
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{h.sentence}</p>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Starting portfolio value</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{h.startingCompact}</dd>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{STARTING_VALUE_HELP}</p>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Value under this scenario</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{h.scenarioCompact}</dd>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">Of the {c.included} valued {c.included === 1 ? "position" : "positions"}.</p>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Change</dt>
          <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${impactTone(h.impactGhs)}`}>
            {h.impactWhole} <span className="text-base">({h.impactPctText})</span>
          </dd>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">A hypothetical change, not a realised result.</p>
        </div>
      </dl>
      <ConfidenceStrip c={c} />
    </section>
  );
}

export function ConfidenceStrip({ c }: { c: ConfidenceView }) {
  const caution = c.primary !== "RECENT_INPUTS";
  return (
    <div className={`mt-4 rounded border px-3 py-2 text-xs ${caution ? "border-amber-200 bg-amber-50/60 text-zinc-800 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-zinc-200" : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300"}`}>
      <p className="font-semibold">
        How much to trust the inputs: {c.coverageLine}
        {c.valuedLine ? ` · ${c.valuedLine}` : ""}
      </p>
      <ul className="mt-1 space-y-0.5">
        {c.flags.map((f) => (
          <li key={f.code}>
            <span className="font-medium">{f.label}:</span> {f.message}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-zinc-500 dark:text-zinc-400">
        {EXCLUSION_PRINCIPLE} <a href="#data-quality" className={`underline ${FOCUS}`}>Review data quality</a>
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
// 3. What caused it?
// --------------------------------------------------------------------------

/** A zero-centred bar: negative extends left, positive right. Purely illustrative — the signed value is always printed beside it. */
export function DivergingBar({ value, max }: { value: number; max: number }) {
  const w = max === 0 ? 0 : Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <div className="relative h-2.5 w-full rounded-sm bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-400 dark:bg-zinc-500" />
      {value !== 0 && <div className={`absolute inset-y-0 ${barTone(value)}`} style={{ width: `${w}%`, left: value < 0 ? `${50 - w}%` : "50%" }} />}
    </div>
  );
}

function DriverRow({ label, sub, value, share, max }: { label: string; sub?: string; value: number; share: number | null; max: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
          {label}
          {sub && <span className="ml-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</span>}
        </p>
      </div>
      <p className={`whitespace-nowrap text-right text-sm font-medium tabular-nums ${impactTone(value)}`}>
        {signedGhsWhole(value)}
        {share !== null && <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{share.toFixed(0)}%</span>}
      </p>
      <div className="col-span-2">
        <DivergingBar value={value} max={max} />
      </div>
    </li>
  );
}

export function Drivers({ byClass, positions, direction }: { byClass: ClassDriver[]; positions: PositionDriver[]; direction: HeadlineView["direction"] }) {
  const word = direction === "RISE" ? "increase" : "decline";
  const maxClass = Math.max(0, ...byClass.map((c) => Math.abs(c.impactGhs)));
  const maxPos = Math.max(0, ...positions.map((p) => Math.abs(p.impactGhs)));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className={CARD}>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Where the effect comes from</h3>
        <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">Impact by asset class{direction !== "UNCHANGED" ? `; percentages are shares of the ${word}` : ""}.</p>
        <ul className="space-y-3">
          {byClass.map((c) => (
            <DriverRow key={c.assetClass} label={c.label} sub={`${c.positions} ${c.positions === 1 ? "holding" : "holdings"}`} value={c.impactGhs} share={c.sharePct} max={maxClass} />
          ))}
        </ul>
      </div>
      <div className={CARD}>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Largest individual impacts</h3>
        <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">The holdings that move the result most.</p>
        {positions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No holding moves under these assumptions.</p>
        ) : (
          <ul className="space-y-3">
            {positions.map((p) => (
              <DriverRow key={p.positionId} label={p.label} sub={p.assetClassLabel} value={p.impactGhs} share={p.sharePct} max={maxPos} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// What this means / what to investigate
// --------------------------------------------------------------------------

export function Meaning({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className={CARD}>
      <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-700 dark:text-zinc-300">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">These statements describe the arithmetic of the assumptions you chose. They are not advice or a view on what will happen.</p>
    </div>
  );
}

export function Investigations({ items }: { items: InvestigationItem[] }) {
  if (items.length === 0) return <p className="rounded border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">Nothing in this result stands out for follow-up.</p>;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((i) => (
        <li key={`${i.kind}-${i.positionId}`} className={`${CARD} flex flex-col`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{i.title}</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.positionLabel}</p>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">{i.headline}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{i.why}</p>
          {i.link && i.link.href !== "#" && (
            <Link href={i.link.href} className={`mt-2 self-start text-sm text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
              {i.link.label} <span aria-hidden="true">→</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------
// Positions: simple first, technical underneath
// --------------------------------------------------------------------------

function RecencyPill({ r }: { r: "RECENT" | "STALE" }) {
  return <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r === "RECENT" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>{r === "RECENT" ? "Recent input" : "Stale input"}</span>;
}

function TechnicalDetails({ p }: { p: PositionView }) {
  return (
    <details className="mt-3 rounded border border-zinc-200 dark:border-zinc-700">
      <summary className={`cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 ${FOCUS}`}>Show technical calculation</summary>
      <div className="space-y-4 border-t border-zinc-200 p-3 dark:border-zinc-700">
        {p.technical.map((g) => (
          <div key={g.title}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{g.title}</h4>
            <dl className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
              {g.rows.map((r, i) => (
                <div key={`${r.label}-${i}`} className="grid gap-x-4 py-1 text-xs sm:grid-cols-[14rem_minmax(0,1fr)]">
                  <dt className="text-zinc-500 dark:text-zinc-400">{r.label}</dt>
                  <dd className="min-w-0 break-words tabular-nums text-zinc-900 dark:text-zinc-100">
                    {r.value}
                    {r.note && <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">{r.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}

export function Positions({ positions }: { positions: PositionView[] }) {
  if (positions.length === 0) return <p className="rounded border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No positions yet.</p>;
  const ordered = [...positions].sort((a, b) => Math.abs(b.impactGhs ?? 0) - Math.abs(a.impactGhs ?? 0) || a.label.localeCompare(b.label));
  return (
    <ul className="space-y-2">
      {ordered.map((p) => (
        <li key={p.positionId}>
          <details id={`pos-${p.positionId}`} className="group rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <summary className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5 ${FOCUS}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {p.label}
                  <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{p.assetClassLabel}</span>
                  {p.recency && <RecencyPill r={p.recency} />}
                  {p.status === "UNAVAILABLE" && <span className="inline-flex rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Excluded</span>}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{p.assumptionPlain}</p>
              </div>
              <div className="text-right">
                {p.impactText ? (
                  <>
                    <p className={`text-sm font-medium tabular-nums ${impactTone(p.impactGhs)}`}>
                      {p.impactText} <span className="text-[11px] font-normal">({p.impactPctText})</span>
                    </p>
                    <p className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      {p.startingText} <span aria-label="to">→</span> {p.scenarioText}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">No scenario value</p>
                )}
              </div>
            </summary>
            <div className="border-t border-zinc-100 px-3 pb-3 pt-2 dark:border-zinc-800">
              {p.simple.map((t) => (
                <p key={t} className="text-sm text-zinc-700 dark:text-zinc-300">
                  {t}
                </p>
              ))}
              {p.freshnessNote && <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">{p.freshnessNote}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {p.links.analysis && p.links.analysis.href !== "#" && (
                  <Link href={p.links.analysis.href} className={`text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
                    {p.links.analysis.label}
                  </Link>
                )}
                {p.links.inspect.href !== "#" && (
                  <Link href={p.links.inspect.href} className={`text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
                    {p.links.inspect.label}
                  </Link>
                )}
              </div>
              <TechnicalDetails p={p} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------
// Data quality
// --------------------------------------------------------------------------

export function DataQualityReview({ positions }: { positions: PositionView[] }) {
  return (
    <details id="data-quality" className={CARD}>
      <summary className={`cursor-pointer select-none text-sm font-medium text-zinc-900 dark:text-zinc-100 ${FOCUS}`}>Review data quality</summary>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">What each holding&rsquo;s starting value rests on. {EXCLUSION_PRINCIPLE}</p>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
        {positions.map((p) => {
          const rows = p.technical.flatMap((g) => g.rows);
          const source = rows.find((r) => r.label === "Source")?.value;
          const retrieved = rows.find((r) => r.label === "Retrieved")?.value;
          const obs = rows.find((r) => r.label === "Observation date")?.value;
          const ageText = rows.find((r) => r.label === "Age at valuation date")?.value;
          return (
            <li key={p.positionId} className="py-2 text-xs">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {p.label}
                {p.recency ? <RecencyPill r={p.recency} /> : <span className="inline-flex rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Excluded</span>}
              </p>
              {p.status === "UNAVAILABLE" ? (
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{p.simple[0]}</p>
              ) : (
                <>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    Latest observation {obs} ({ageText}).{p.freshnessNote ? ` ${p.freshnessNote}` : ""}
                  </p>
                  {source && (
                    <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                      Source: {source}
                      {retrieved ? ` · retrieved ${retrieved}` : ""}
                    </p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// --------------------------------------------------------------------------
// Methodology
// --------------------------------------------------------------------------

export function Methodology() {
  return (
    <details className={CARD}>
      <summary className={`cursor-pointer select-none text-sm font-medium text-zinc-900 dark:text-zinc-100 ${FOCUS}`}>How Korbly calculated this</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {METHODOLOGY.map((m) => (
          <li key={m.text}>{m.text}</li>
        ))}
      </ul>
    </details>
  );
}

export function NoticeFooter({ view, valuationDate }: { view: StudioView; valuationDate: string }) {
  return (
    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
      {view.notices.join(" ")} Calculated using current reference inputs as at {formatIsoDate(valuationDate)}; the result is recomputed each time you open it and is not saved.
    </p>
  );
}
