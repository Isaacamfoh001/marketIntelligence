// Pure wording for the equity-source notice (kept out of the component so it is unit-tested).
import type { EquitySourceStatus } from "../queries/equity-source";

export interface SourceNotice {
  tone: "ok" | "warn";
  headline: string;
  details: string[];
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function describeSourceNotice(status: EquitySourceStatus): SourceNotice {
  const { currency, latestActualTradeDate, lastSuccessfulRun } = status;
  const details: string[] = [];
  if (currency.latestReportDate) details.push(`Latest GSE report held: ${fmt(currency.latestReportDate)}. Latest actual trade in the market: ${fmt(latestActualTradeDate)}.`);
  if (lastSuccessfulRun) {
    details.push(`Last successful import: ${lastSuccessfulRun.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC${lastSuccessfulRun.artifactName ? ` (${lastSuccessfulRun.artifactName})` : ""}.`);
  }
  if (currency.lastRefreshFailed) details.push("The most recent import attempt FAILED; the data above did not refresh.");

  if (currency.state === "MISSING") {
    return { tone: "warn", headline: "No GSE equity data has been imported.", details };
  }
  if (currency.state === "STALE") {
    return {
      tone: "warn",
      headline: `Korbly's latest GSE market data is from ${fmt(currency.latestReportDate)} (${currency.weekdaysBehind} weekday${currency.weekdaysBehind === 1 ? "" : "s"} ago). Prices below may not reflect later trading.`,
      details,
    };
  }
  return {
    tone: currency.lastRefreshFailed ? "warn" : "ok",
    headline: `GSE market data is current: latest report ${fmt(currency.latestReportDate)}. A security's own last trade can still be older — see "Last trade".`,
    details,
  };
}
