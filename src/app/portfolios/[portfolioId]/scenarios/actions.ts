"use server";

// ---------------------------------------------------------------------------
// Server Actions for scenario definitions (M8.3). Thin: parse FormData, call
// src/lib/scenario-service.ts (which owns validation/persistence). NO
// AUTHENTICATION (M8 internal-MVP decision) — see portfolios/actions.ts.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { addShock, createScenario, removeShock, setScenarioArchived, updateScenario, updateShock } from "@/lib/scenario-service";
import { parseTargetOption } from "@/lib/queries/scenarios";

export interface ScenarioFormState {
  error?: string;
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

/** Accepts a signed decimal ("-10", "+2.5"); unlike share counts it may be negative or fractional. */
function parseShockValue(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const base = (portfolioId: string) => `/portfolios/${portfolioId}/scenarios`;

export async function createScenarioAction(portfolioId: string, _prev: ScenarioFormState, formData: FormData): Promise<ScenarioFormState> {
  const result = await createScenario({ portfolioId, name: text(formData, "name"), description: text(formData, "description") });
  if (!result.ok) return { error: result.error };
  redirect(`${base(portfolioId)}/${result.id}`);
}

export async function updateScenarioAction(portfolioId: string, scenarioId: string, _prev: ScenarioFormState, formData: FormData): Promise<ScenarioFormState> {
  const result = await updateScenario({ scenarioId, name: text(formData, "name"), description: text(formData, "description") });
  if (!result.ok) return { error: result.error };
  redirect(`${base(portfolioId)}/${scenarioId}?saved=1`);
}

export async function archiveScenarioAction(portfolioId: string, scenarioId: string): Promise<void> {
  const result = await setScenarioArchived(scenarioId, true);
  if (!result.ok) throw new Error(result.error);
  redirect(base(portfolioId));
}

export async function restoreScenarioAction(portfolioId: string, scenarioId: string): Promise<void> {
  const result = await setScenarioArchived(scenarioId, false);
  if (!result.ok) throw new Error(result.error);
  redirect(`${base(portfolioId)}/${scenarioId}`);
}

export async function addShockAction(portfolioId: string, scenarioId: string, _prev: ScenarioFormState, formData: FormData): Promise<ScenarioFormState> {
  const target = parseTargetOption(text(formData, "target"));
  if (!target) return { error: "Choose what the assumption applies to." };
  const value = parseShockValue(text(formData, "value"));
  if (value === null) return { error: "Enter the shock as a number, e.g. 200 or -10." };
  const result = await addShock({ scenarioId, target, value });
  if (!result.ok) return { error: result.error };
  redirect(`${base(portfolioId)}/${scenarioId}`);
}

export async function updateShockAction(portfolioId: string, scenarioId: string, shockId: string, _prev: ScenarioFormState, formData: FormData): Promise<ScenarioFormState> {
  const value = parseShockValue(text(formData, "value"));
  if (value === null) return { error: "Enter the shock as a number." };
  const result = await updateShock({ shockId, value });
  if (!result.ok) return { error: result.error };
  redirect(`${base(portfolioId)}/${scenarioId}`);
}

export async function removeShockAction(portfolioId: string, scenarioId: string, shockId: string): Promise<void> {
  const result = await removeShock(shockId);
  if (!result.ok) throw new Error(result.error);
  redirect(`${base(portfolioId)}/${scenarioId}`);
}
