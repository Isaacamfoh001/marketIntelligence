import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { formatIsoDate } from "@/lib/fixed-income";
import { addPositionAction } from "../../actions";
import { InstrumentPicker } from "@/components/portfolio/InstrumentPicker";

export const dynamic = "force-dynamic";

export default async function AddPositionPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { portfolioId } = await params;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();
  if (portfolio.archivedAt) redirect(`/portfolios/${portfolioId}`);

  const held: Record<string, string> = {};
  for (const p of portfolio.positions) held[p.holding.assetClass === "BOND" ? p.holding.fixedIncomeSecurityId : p.holding.securityId] = p.positionId;

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
          Choose a Government of Ghana bond, corporate bond or Ghana-listed equity. Treasury bills are not supported yet. The context shown is the observation each valuation would rest on, as of {formatIsoDate(portfolio.valuationDate)}.
        </p>
      </header>
      <InstrumentPicker bonds={ctx.bonds} equities={ctx.equities} held={held} portfolioId={portfolio.id} valuationDateIso={portfolio.valuationDate} action={addPositionAction.bind(null, portfolio.id)} />
    </div>
  );
}
