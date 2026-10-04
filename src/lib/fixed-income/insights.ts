// ---------------------------------------------------------------------------
// Deterministic security insights (M7.3 §12/§20).
//
// Short factual statements derived ONLY from already-computed data —
// maturity, observation age/kind, price vs par, sovereign spread, and the
// purchase-price scenarios. No subjective language ("attractive", "buy",
// "undervalued"): every sentence is something an analyst could verify by
// reading a number elsewhere on the page.
// ---------------------------------------------------------------------------

import { formatBps, formatIsoDate, formatPct } from "./format";
import type { SecurityLifecycle } from "./lifecycle";
import type { PriceScenario } from "./price-scenarios";
import type { ObservationIssue } from "./observation-quality";

export type InsightTone = "neutral" | "caution";

export interface SecurityInsight {
  id: string;
  tone: InsightTone;
  text: string;
}

/** Above this many bps of annualized return per 1.00 of clean price, a security's return is called "highly sensitive" to purchase price. Roughly the sensitivity of a bond with ~6 months left; documented, not tuned to current data. */
export const HIGH_PRICE_SENSITIVITY_BPS_PER_POINT = 200;

export interface InsightInput {
  maturityDateIso: string;
  tenorDays: number;
  lifecycle: SecurityLifecycle;
  observation: {
    dateIso: string;
    ageDays: number;
    kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET";
    freshness: "CURRENT" | "STALE" | "MISSING";
    cleanPrice: number | null;
  } | null;
  /** Quality issues of the market observation (M7.3.1) — REVIEW/EXCLUDED ones withhold it from analytics. */
  observationIssues?: ObservationIssue[];
  /** A newer carried closing price with no trade behind it, and the earliest date the source has shown only carried prices. */
  carried?: { cleanPrice: number | null; asOf: string } | null;
  noTradeRecordedSince?: string | null;
  /** Source-vs-master terms conflicts (affect every calculation, including scenarios). */
  termsIssues?: ObservationIssue[];
  ytmPct: number | null;
  ytmSource: "SOLVED_FROM_PRICE" | "SOURCE_QUOTED" | null;
  sourceQuotedYieldPct: number | null;
  isCorporate: boolean;
  benchmark: { label: string; yieldPct: number; tenorGapDays: number; isWideGap: boolean } | null;
  spreadBps: number | null;
  /** Hypothetical-price scenarios (typically DEFAULT_SCENARIO_PRICES), ascending by price. */
  scenarios: PriceScenario[];
  breakEvenCleanPrice: number | null;
  sensitivityBpsPerPoint: number | null;
}

export function buildSecurityInsights(input: InsightInput): SecurityInsight[] {
  const out: SecurityInsight[] = [];

  // --- Maturity ---------------------------------------------------------
  if (input.lifecycle === "MATURED") {
    out.push({ id: "matured", tone: "caution", text: `Matured on ${formatIsoDate(input.maturityDateIso)} — shown for historical research only; no remaining cash flows.` });
    return out;
  }
  out.push({
    id: "maturity",
    tone: input.lifecycle === "MATURING_SOON" ? "caution" : "neutral",
    text: `Matures in ${input.tenorDays} day${input.tenorDays === 1 ? "" : "s"} (${formatIsoDate(input.maturityDateIso)}).`,
  });

  // --- Terms integrity ----------------------------------------------------
  for (const issue of (input.termsIssues ?? []).filter((i) => i.severity !== "INFO")) {
    out.push({ id: `terms-${issue.code}`, tone: "caution", text: `${issue.label}: ${issue.detail}` });
  }

  // --- Observation ------------------------------------------------------
  const obs = input.observation;
  if (!obs) {
    if (input.noTradeRecordedSince) {
      out.push({
        id: "no-trade",
        tone: "caution",
        text: `No trade recorded in GFIM daily reports since at least ${formatIsoDate(input.noTradeRecordedSince)}${input.carried?.cleanPrice != null ? `; the published price ${input.carried.cleanPrice.toFixed(2)} is carried forward from an earlier, unknown date and is not a market price` : ""}. Every price and return below is a hypothetical scenario.`,
      });
    } else {
      out.push({ id: "no-observation", tone: "caution", text: "No market observation exists for this security — every price and return below is a hypothetical scenario, not a quote." });
    }
  } else {
    const kind = obs.kind === "SECONDARY_MARKET" ? "secondary-market trade" : "primary auction";
    const age = obs.ageDays === 0 ? "dated today" : `${obs.ageDays} day${obs.ageDays === 1 ? "" : "s"} old`;
    out.push({
      id: "observation-age",
      tone: obs.freshness === "STALE" ? "caution" : "neutral",
      text: `Latest market observation (${kind}, ${formatIsoDate(obs.dateIso)}) is ${age}${obs.freshness === "STALE" ? " and is stale" : ""}.`,
    });
    const blocking = (input.observationIssues ?? []).filter((i) => i.severity !== "INFO" && !(input.termsIssues ?? []).some((t) => t.code === i.code));
    if (blocking.length > 0) {
      out.push({ id: "withheld", tone: "caution", text: `This observation is withheld from derived analytics (curve, spreads, alternatives): ${blocking.map((i) => i.detail).join(" ")}` });
    }
    if (obs.cleanPrice !== null) {
      const diff = obs.cleanPrice - 100;
      if (Math.abs(diff) < 0.005) out.push({ id: "price-vs-par", tone: "neutral", text: "Observed market price is at par (100.00)." });
      else out.push({ id: "price-vs-par", tone: "neutral", text: `Observed market price ${obs.cleanPrice.toFixed(2)} is ${diff > 0 ? "above" : "below"} par by ${Math.abs(diff).toFixed(2)}.` });
    } else {
      out.push({ id: "price-not-reported", tone: "neutral", text: "The observation reports a yield but no price." });
    }
  }

  // --- Sovereign comparison ----------------------------------------------
  if (input.isCorporate) {
    if (input.spreadBps !== null && input.benchmark) {
      out.push({
        id: "spread",
        tone: "neutral",
        text: `Observed YTM is ${formatBps(input.spreadBps)} ${input.spreadBps >= 0 ? "over" : "versus"} the nearest-tenor sovereign benchmark (${input.benchmark.label}, ${formatPct(input.benchmark.yieldPct)}).`,
      });
      if (input.benchmark.isWideGap) {
        out.push({ id: "benchmark-gap", tone: "caution", text: `The benchmark's tenor differs by ${input.benchmark.tenorGapDays} days — the spread is approximate.` });
      }
    } else if (input.benchmark) {
      out.push({ id: "no-spread", tone: "neutral", text: `Spread unavailable without a market yield; the nearest-tenor sovereign benchmark is ${input.benchmark.label} at ${formatPct(input.benchmark.yieldPct)}.` });
    } else {
      out.push({ id: "no-benchmark", tone: "caution", text: "Spread unavailable — no suitable sovereign benchmark exists." });
    }
  }

  // --- Purchase-price scenarios -------------------------------------------
  const premium = input.scenarios.find((s) => s.cleanPrice === 105);
  if (premium && premium.returnPct !== null) {
    out.push({
      id: "scenario-105",
      tone: premium.returnPct < 0 ? "caution" : "neutral",
      text:
        premium.returnPct < 0
          ? `At a hypothetical price of 105, the annualized hold-to-maturity return becomes negative (${formatPct(premium.returnPct)}).`
          : `At a hypothetical price of 105, the annualized hold-to-maturity return falls to ${formatPct(premium.returnPct)}.`,
    });
  }
  const firstNegative = input.scenarios.find((s) => s.returnPct !== null && s.returnPct < 0);
  if (firstNegative && firstNegative.cleanPrice !== 105) {
    out.push({ id: "first-negative", tone: "caution", text: `At a hypothetical price of ${firstNegative.cleanPrice.toFixed(2)}, the annualized hold-to-maturity return is negative.` });
  }
  if (input.breakEvenCleanPrice !== null) {
    out.push({
      id: "break-even",
      tone: "neutral",
      text: `Paying more than ${input.breakEvenCleanPrice.toFixed(2)} (clean) returns less cash than it costs — a negative hold-to-maturity return.`,
    });
  }
  if (input.sensitivityBpsPerPoint !== null && input.sensitivityBpsPerPoint > HIGH_PRICE_SENSITIVITY_BPS_PER_POINT) {
    out.push({
      id: "high-sensitivity",
      tone: "caution",
      text: `Return is highly sensitive to purchase price${input.tenorDays <= 365 ? " because the security is close to maturity" : ""}: each 1.00 paid above par removes about ${input.sensitivityBpsPerPoint} bps of annualized return.`,
    });
  }

  return out;
}
