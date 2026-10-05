import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { formatIsoDate } from "@/lib/fixed-income";
import { addPositionAction, addTreasuryBillAction } from "../../actions";
import { TreasuryBillForm } from "@/components/portfolio/TreasuryBillForm";
import { getLatestAuctionCurve } from "@/lib/queries/portfolio";
import { InstrumentPicker } from "@/components/portfolio/InstrumentPicker";

export const dynamic = "force-dynamic";

export default async function AddPositionPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { portfolioId } = await params;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();
  if (portfolio.archivedAt) redirect(`/portfolios/${portfolioId}`);

  const held: Record<string, string> = {};
  for (const p of portfolio.positions) if (p.holding.assetClass !== "TREASURY_BILL") held[p.holding.assetClass === "BOND" ? p.holding.fixedIncomeSecurityId : p.holding.securityId] = p.positionId;
  const curve = await getLatestAuctionCurve(ctx.valuationDate);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/portfolios" className="hover:underline">
            Portfolios
          </Link>{" "}
          /{" "}
          <Link href={`/portfolios/${portfolio.id}`} className="hover:underline">
            {portfolio.name}
          </Link>
        </nav>
        <h1 className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Add position</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Add a Treasury bill, or choose a Government of Ghana bond, corporate bond or Ghana-listed equity. The context shown is the observation each valuation would rest on, as of {formatIsoDate(portfolio.valuationDate)}.
        </p>
      </header>
      <section aria-labelledby="add-bill">
        <h2 id="add-bill" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Add a Treasury bill
        </h2>
        <TreasuryBillForm curve={curve} valuationDateIso={portfolio.valuationDate} cancelHref={`/portfolios/${portfolio.id}`} action={addTreasuryBillAction.bind(null, portfolio.id)} />
      </section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Or choose a bond or equity</h2>
      <InstrumentPicker bonds={ctx.bonds} equities={ctx.equities} held={held} portfolioId={portfolio.id} valuationDateIso={portfolio.valuationDate} action={addPositionAction.bind(null, portfolio.id)} />
    </div>
  );
}
