"use client";

import { useActionState } from "react";
import { createPortfolioAction, type FormState } from "@/app/portfolios/actions";

const INPUT = "w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function CreatePortfolioForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPortfolioAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-end">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Portfolio name <span className="text-zinc-400">(required)</span>
        <input name="name" required maxLength={120} placeholder="e.g. Core fixed income" className={`${INPUT} mt-1`} />
      </label>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Description <span className="text-zinc-400">(optional)</span>
        <input name="description" maxLength={1000} placeholder="What this portfolio represents" className={`${INPUT} mt-1`} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Creating…" : "Create portfolio"}
      </button>
      {state.error && (
        <p role="alert" className="text-xs text-red-600 sm:col-span-3 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
