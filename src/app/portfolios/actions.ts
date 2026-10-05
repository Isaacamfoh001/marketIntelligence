"use server";

// ---------------------------------------------------------------------------
// Server Actions for portfolios (M8.1). Deliberately thin: they only parse
// FormData and call src/lib/portfolio-service.ts, which owns validation and
// persistence. NO AUTHENTICATION (M8 internal-MVP decision): a single shared
// workspace — do not expose these mutations on a public deployment without
// adding authentication/authorisation first.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { addPosition, createPortfolio, removePosition, setPortfolioArchived, updatePosition } from "@/lib/portfolio-service";
import { parseEnteredNumber } from "@/lib/portfolio";

export interface FormState {
  error?: string;
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

export async function createPortfolioAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await createPortfolio({ name: text(formData, "name"), description: text(formData, "description") });
  if (!result.ok) return { error: result.error };
  redirect(`/portfolios/${result.id}`);
}

export async function archivePortfolioAction(portfolioId: string): Promise<void> {
  const result = await setPortfolioArchived(portfolioId, true);
  if (!result.ok) throw new Error(result.error);
  redirect("/portfolios");
}

export async function restorePortfolioAction(portfolioId: string): Promise<void> {
  const result = await setPortfolioArchived(portfolioId, false);
  if (!result.ok) throw new Error(result.error);
  redirect(`/portfolios/${portfolioId}`);
}

/** Bonds carry `nominalGhs`, equities `shares` — never a generic quantity. */
function readSize(assetClass: "BOND" | "EQUITY", formData: FormData): { nominalGhs?: number | null; shares?: number | null; error?: string } {
  const raw = text(formData, assetClass === "BOND" ? "nominalGhs" : "shares");
  const n = parseEnteredNumber(raw);
  if (n === null) return { error: assetClass === "BOND" ? "Enter the nominal amount in GHS as a number." : "Enter the number of shares as a whole number." };
  return assetClass === "BOND" ? { nominalGhs: n } : { shares: n };
}

export async function addPositionAction(portfolioId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const assetClass = text(formData, "assetClass");
  if (assetClass !== "BOND" && assetClass !== "EQUITY") return { error: "Choose an instrument first." };
  const instrumentId = text(formData, "instrumentId");
  if (!instrumentId) return { error: "Choose an instrument first." };
  const size = readSize(assetClass, formData);
  if (size.error) return { error: size.error };

  const result = await addPosition({ portfolioId, assetClass, instrumentId, nominalGhs: size.nominalGhs, shares: size.shares });
  if (result.ok) redirect(`/portfolios/${portfolioId}?position=${result.positionId}#inspect`);
  // Already held: take the analyst to the existing position rather than creating a second lot.
  if (result.existingPositionId) redirect(`/portfolios/${portfolioId}?position=${result.existingPositionId}&duplicate=1#inspect`);
  return { error: result.error };
}

export async function updatePositionAction(portfolioId: string, positionId: string, assetClass: "BOND" | "EQUITY", _prev: FormState, formData: FormData): Promise<FormState> {
  const size = readSize(assetClass, formData);
  if (size.error) return { error: size.error };
  const result = await updatePosition({ positionId, nominalGhs: size.nominalGhs, shares: size.shares });
  if (!result.ok) return { error: result.error };
  redirect(`/portfolios/${portfolioId}?position=${positionId}&saved=1#inspect`);
}

export async function removePositionAction(portfolioId: string, positionId: string): Promise<void> {
  const result = await removePosition(positionId);
  if (!result.ok) throw new Error(result.error);
  redirect(`/portfolios/${portfolioId}?removed=1`);
}
