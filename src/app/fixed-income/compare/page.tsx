import Link from "next/link";
import { getComparableUniverse } from "@/lib/queries/fixed-income";
import { CompareTool } from "@/components/fixed-income/CompareTool";

export const dynamic = "force-dynamic";

export default async function FixedIncomeComparePage() {
  const universe = await getComparableUniverse();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fixed-income" className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300">
          ← Fixed Income
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Compare Fixed Income Securities</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Select Treasury bills, government bonds, and corporate bonds to compare side by side — every figure here comes from the same analytics engine used on
          each security&rsquo;s own page.
        </p>
      </div>

      {universe.length === 0 ? (
        <div className="rounded border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No fixed-income securities available yet.</p>
        </div>
      ) : (
        <CompareTool universe={universe} />
      )}
    </div>
  );
}
