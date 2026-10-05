import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getInstrumentContext, getLatestAuctionCurve, getPortfolio } from "@/lib/queries/portfolio";
import { formatIsoDate } from "@/lib/fixed-income";
import { addPositionsBatchAction } from "../../actions";
import { BasketBuilder } from "@/components/portfolio/BasketBuilder";

export const dynamic = "force-dynamic";

// Build the portfolio: browse by asset class, tick several instruments, enter each
// position in its own terms, add them together (all-or-nothing).
export default async function AddPositionPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { portfolioId } = await params;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();
  if (portfolio.archivedAt) redirect(`/portfolios/${portfolioId}`);

  const held: Record<string, string> = {};
  for (const p of portfolio.positions) {
    if (p.holding.assetClass === "BOND") held[`BOND:${p.holding.fixedIncomeSecurityId}`] = p.positionId;
    else if (p.holding.assetClass === "EQUITY") held[`EQUITY:${p.holding.securityId}`] = p.positionId;
    else if (p.instrument.kind === "TREASURY_BILL") held[`BILL:${p.instrument.tenorDays}:${p.instrument.maturityDate}`] = p.positionId;
  }
  const curve = await getLatestAuctionCurve(ctx.valuationDate);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
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
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Add instruments</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Browse Treasury bills, Government of Ghana bonds, corporate bonds and Ghana-listed equities. Tick as many as you like, enter how much of each you hold, and add them together. Values shown are Reference Values as of {formatIsoDate(portfolio.valuationDate)}.
        </p>
      </header>
      <BasketBuilder bonds={ctx.bonds} equities={ctx.equities} held={held} curve={curve} portfolioId={portfolio.id} valuationDateIso={portfolio.valuationDate} action={addPositionsBatchAction.bind(null, portfolio.id)} />
    </div>
  );
}
