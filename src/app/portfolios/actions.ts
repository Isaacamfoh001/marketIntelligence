"use server";

// ---------------------------------------------------------------------------
// Server Actions for portfolios (M8.1). Deliberately thin: they only parse
// FormData and call src/lib/portfolio-service.ts, which owns validation and
// persistence. NO AUTHENTICATION (M8 internal-MVP decision): a single shared
// workspace — do not expose these mutations on a public deployment without
// adding authentication/authorisation first.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { addPositionsBatch, createPortfolio, removePosition, setPortfolioArchived, updatePosition } from "@/lib/portfolio-service";
import { parseEnteredNumber, type BatchEntryInput, type BatchRowError } from "@/lib/portfolio";

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

/** Bonds carry `nominalGhs`, Treasury bills their face amount (also `nominalGhs`), equities `shares` — never a generic quantity. */
function readSize(assetClass: "BOND" | "EQUITY" | "TREASURY_BILL", formData: FormData): { nominalGhs?: number | null; shares?: number | null; error?: string } {
  const amount = assetClass !== "EQUITY";
  const n = parseEnteredNumber(text(formData, amount ? "nominalGhs" : "shares"));
  if (n === null) return { error: assetClass === "TREASURY_BILL" ? "Enter the face amount in GHS as a number." : amount ? "Enter the nominal amount in GHS as a number." : "Enter the number of shares as a whole number." };
  return amount ? { nominalGhs: n } : { shares: n };
}

export async function updatePositionAction(portfolioId: string, positionId: string, assetClass: "BOND" | "EQUITY" | "TREASURY_BILL", _prev: FormState, formData: FormData): Promise<FormState> {
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

export interface BatchFormState {
  error?: string;
  rowErrors?: BatchRowError[];
}

/** Defensive parse of the basket the client posts as JSON — every field is re-validated by the service. */
function parseBatchEntries(raw: string): BatchEntryInput[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const out: BatchEntryInput[] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    const key = str(r.key);
    if (r.assetClass === "BOND") out.push({ key, assetClass: "BOND", instrumentId: str(r.instrumentId), nominalGhs: str(r.nominalGhs) });
    else if (r.assetClass === "EQUITY") out.push({ key, assetClass: "EQUITY", instrumentId: str(r.instrumentId), shares: str(r.shares) });
    else if (r.assetClass === "TREASURY_BILL") out.push({ key, assetClass: "TREASURY_BILL", tenorDays: Number(r.tenorDays), maturityDate: str(r.maturityDate), faceValueGhs: str(r.faceValueGhs), isin: str(r.isin) });
    else return null;
  }
  return out;
}

/** Adds the whole basket in one transaction, or nothing (see addPositionsBatch). */
export async function addPositionsBatchAction(portfolioId: string, _prev: BatchFormState, formData: FormData): Promise<BatchFormState> {
  const entries = parseBatchEntries(text(formData, "entries"));
  if (!entries) return { error: "The selection could not be read. Reload the page and try again." };
  const result = await addPositionsBatch({ portfolioId, entries });
  if (result.ok) redirect(`/portfolios/${portfolioId}?added=${result.positionCount}`);
  return { error: result.error, rowErrors: result.rowErrors };
}
