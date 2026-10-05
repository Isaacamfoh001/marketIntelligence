"use client";

// ---------------------------------------------------------------------------
// "Add a Treasury bill" (M8.5). A bill is described the way an analyst knows it —
// original tenor, maturity date and the face (maturity) amount — and Korbly shows
// the reference value those inputs would get, with its evidence, BEFORE saving.
// There is no purchase price/date field: none is needed for a reference value and
// Korbly records no cost basis. Validation and valuation are the pure domain
// functions; the server re-validates on submit.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { BILL_TENORS, checkBillIssued, parseIsoDate, validateBillTerms, type AuctionCurve } from "@/lib/treasury-bills";
import { checkBillAddable, parseEnteredNumber, resolveBillValuationInput, validatePositionDraft, valueBillPosition } from "@/lib/portfolio";
import type { FormState } from "@/app/portfolios/actions";
import { ValuationBreakdown } from "./ValuationBreakdown";

const INPUT = "w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const LABEL = "block text-xs font-medium text-zinc-600 dark:text-zinc-400";
const HELP = "mt-1 block text-[11px] font-normal text-zinc-400 dark:text-zinc-500";

export function TreasuryBillForm({ curve, valuationDateIso, cancelHref, action }: { curve: AuctionCurve | null; valuationDateIso: string; cancelHref: string; action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [tenor, setTenor] = useState<string>("91");
  const [maturity, setMaturity] = useState("");
  const [face, setFace] = useState("");
  const [isin, setIsin] = useState("");

  const preview = useMemo(() => {
    if (maturity.trim() === "" || face.trim() === "") return { hint: "Enter the maturity date and face amount to preview the reference value." } as const;
    const m = parseIsoDate(maturity);
    if (!m) return { error: "Enter the maturity date as a valid date." } as const;
    const valuationDate = new Date(`${valuationDateIso}T00:00:00.000Z`);
    const terms = validateBillTerms({ tenorDays: Number(tenor), maturityDate: m, currency: "GHS", isin: isin.trim().toUpperCase() || null });
    if (!terms.ok) return { error: terms.error } as const;
    const issued = checkBillIssued(terms.terms, valuationDate);
    if (!issued.ok) return { error: issued.error } as const;
    const addable = checkBillAddable({ currency: "GHS", maturityDate: m }, valuationDate);
    if (!addable.addable) return { error: addable.reason } as const;
    const n = parseEnteredNumber(face);
    if (n === null) return { error: "Enter the face amount as a number, e.g. 1,000,000." } as const;
    const size = validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: n, currency: "GHS" });
    if (!size.ok || size.assetClass !== "TREASURY_BILL") return { error: size.ok ? "Invalid face amount." : size.error } as const;
    const input = resolveBillValuationInput({ currency: "GHS", tenorDays: terms.terms.tenorDays, issueDate: terms.terms.issueDate, maturityDate: m, curve }, valuationDate);
    return { valuation: valueBillPosition(size.faceValueGhs, input, valuationDate), issueDate: terms.terms.issueDate.toISOString().slice(0, 10) } as const;
  }, [tenor, maturity, face, isin, curve, valuationDateIso]);

  return (
    <form action={formAction} className="space-y-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={LABEL}>
          Original tenor
          <select name="tenorDays" value={tenor} onChange={(e) => setTenor(e.target.value)} className={`${INPUT} mt-1`}>
            {BILL_TENORS.map((t) => (
              <option key={t} value={t}>
                {t}-day bill
              </option>
            ))}
          </select>
          <span className={HELP}>The tenor the bill was issued with — not the time left.</span>
        </label>
        <label className={LABEL}>
          Maturity date
          <input type="date" name="maturityDate" value={maturity} onChange={(e) => setMaturity(e.target.value)} required className={`${INPUT} mt-1`} />
          <span className={HELP}>The day the government pays face value.</span>
        </label>
        <label className={LABEL}>
          Face (maturity) amount (GHS)
          <input name="faceValueGhs" value={face} onChange={(e) => setFace(e.target.value)} inputMode="decimal" autoComplete="off" required placeholder="1,000,000" className={`${INPUT} mt-1`} />
          <span className={HELP}>What the bill pays at maturity — not what was paid, and not today&rsquo;s value.</span>
        </label>
      </div>
      <label className={`${LABEL} block max-w-xs`}>
        ISIN <span className="font-normal text-zinc-400">(optional)</span>
        <input name="isin" value={isin} onChange={(e) => setIsin(e.target.value)} autoComplete="off" placeholder="GH0000000000" className={`${INPUT} mt-1 uppercase`} />
        <span className={HELP}>Only if you have it — Korbly never invents one.</span>
      </label>

      <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40" aria-live="polite">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Valuation preview</p>
        {"hint" in preview && <p className="text-xs text-zinc-500 dark:text-zinc-400">{preview.hint}</p>}
        {"error" in preview && <p className="text-xs text-red-600 dark:text-red-400">{preview.error}</p>}
        {"valuation" in preview && preview.valuation && <ValuationBreakdown valuation={preview.valuation} />}
      </div>

      {state.error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          {pending ? "Adding…" : "Add Treasury bill"}
        </button>
        <Link href={cancelHref} className="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          Cancel
        </Link>
      </div>
    </form>
  );
}
