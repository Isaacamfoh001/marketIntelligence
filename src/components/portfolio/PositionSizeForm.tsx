"use client";

// ---------------------------------------------------------------------------
// Size entry for one instrument, with a live valuation preview (M8.1 §18).
// Bonds take a nominal GHS amount, equities a whole number of shares — never a
// generic quantity. Validation and valuation are the pure domain functions
// (validatePositionDraft / valueBondPosition / valueEquityPosition); this
// component only wires them to inputs. The server re-validates on submit.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { parseEnteredNumber, validatePositionDraft, valueBondPosition, valueEquityPosition } from "@/lib/portfolio";
import type { HoldableInstrument } from "@/lib/queries/portfolio";
import type { FormState } from "@/app/portfolios/actions";
import { ValuationBreakdown } from "./ValuationBreakdown";

const INPUT = "w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function PositionSizeForm({
  instrument,
  action,
  initialValue = "",
  submitLabel,
  valuationDateIso,
  cancelHref,
}: {
  instrument: HoldableInstrument;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValue?: string;
  submitLabel: string;
  valuationDateIso: string;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [raw, setRaw] = useState(initialValue);
  const isBond = instrument.kind === "BOND";

  const preview = useMemo(() => {
    if (raw.trim() === "") return { hint: isBond ? "Enter a nominal amount to preview the reference value." : "Enter a number of shares to preview the reference value." } as const;
    const n = parseEnteredNumber(raw);
    if (n === null) return { error: isBond ? "Enter the nominal as a number, e.g. 2,000,000." : "Enter shares as a whole number, e.g. 100,000." } as const;
    const size = validatePositionDraft(isBond ? { assetClass: "BOND", nominalGhs: n, currency: "GHS" } : { assetClass: "EQUITY", shares: n, currency: "GHS" });
    if (!size.ok) return { error: size.error } as const;
    const valuationDate = new Date(`${valuationDateIso}T00:00:00.000Z`);
    const valuation =
      size.assetClass === "BOND" && instrument.kind === "BOND"
        ? valueBondPosition(size.nominalGhs, instrument.terms, instrument.input, valuationDate)
        : size.assetClass === "EQUITY" && instrument.kind === "EQUITY"
          ? valueEquityPosition(size.shares, instrument.input)
          : null;
    return { valuation } as const;
  }, [raw, instrument, isBond, valuationDateIso]);

  const name = isBond ? "nominalGhs" : "shares";
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="assetClass" value={instrument.kind} />
      <input type="hidden" name="instrumentId" value={instrument.id} />
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {isBond ? "Nominal (GHS)" : "Shares"}
        <input
          name={name}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          inputMode={isBond ? "decimal" : "numeric"}
          autoComplete="off"
          required
          placeholder={isBond ? "2,000,000" : "100,000"}
          aria-describedby="size-preview"
          className={`${INPUT} mt-1 max-w-xs`}
        />
        <span className="mt-1 block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">{isBond ? "Face amount held, in Ghana cedis." : "Whole shares only."}</span>
      </label>

      {(initialValue === "" || raw !== initialValue) && (
      <div id="size-preview" className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60" aria-live="polite">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Valuation preview</p>
        {"hint" in preview && <p className="text-xs text-zinc-500 dark:text-zinc-400">{preview.hint}</p>}
        {"error" in preview && <p className="text-xs text-red-600 dark:text-red-400">{preview.error}</p>}
        {"valuation" in preview && preview.valuation && <ValuationBreakdown valuation={preview.valuation} />}
      </div>
      )}

      {state.error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {cancelHref && (
          <Link href={cancelHref} className="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
