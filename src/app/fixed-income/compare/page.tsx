import Link from "next/link";
import { getFixedIncomeWorkspace } from "@/lib/queries/fixed-income";
import { formatIsoDate, toValuationDate } from "@/lib/fixed-income";
import { CompareTool } from "@/components/fixed-income/CompareTool";

export const dynamic = "force-dynamic";

function asList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

export default async function FixedIncomeComparePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const workspace = await getFixedIncomeWorkspace(toValuationDate(new Date()));

  const outstanding = workspace.securities.filter((s) => s.lifecycle !== "MATURED");
  const bills = workspace.comparables.filter((c) => c.instrumentType === "TREASURY_BILL");

  // Only accept codes/issuers that exist in the outstanding universe — URL input is never trusted as-is.
  const knownCodes = new Set([...outstanding.map((s) => s.instrumentCode), ...bills.map((b) => b.instrumentCode)]);
  const knownIssuers = new Set(outstanding.map((s) => s.issuerName));
  const initialCodes = asList(params.codes).map((c) => c.toUpperCase()).filter((c) => knownCodes.has(c));
  // Arriving with explicit codes (e.g. from the universe's issuer filter) pre-applies those codes' issuers, so the picker shows the same focused set.
  const issuersOfCodes = outstanding.filter((s) => initialCodes.includes(s.instrumentCode)).map((s) => s.issuerName);
  const initialIssuers = [...new Set([...asList(params.issuer), ...issuersOfCodes])].filter((i) => knownIssuers.has(i));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fixed-income" className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300">
          ← Fixed Income
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Compare &amp; Return Scenarios</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          What return would each bond deliver at different purchase prices, how does that compare with what the market last traded, and where else can similar yields be found?
          All figures use the same engine as each security&rsquo;s page, as of {formatIsoDate(workspace.valuationDateIso)}.
        </p>
      </div>

      {outstanding.length === 0 ? (
        <div className="rounded border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No outstanding fixed-income securities available yet.</p>
        </div>
      ) : (
        <CompareTool
          securities={outstanding}
          bills={bills}
          comparables={workspace.comparables}
          valuationDateIso={workspace.valuationDateIso}
          initialCodes={initialCodes}
          initialIssuers={initialIssuers}
        />
      )}
    </div>
  );
}
