"use server";

// ---------------------------------------------------------------------------
// Server Actions for scenario definitions (M8.3). Thin: parse FormData, call
// src/lib/scenario-service.ts (which owns validation/persistence). M8.4: assumption
// input is human-first (rise/fall + size); both entry modes convert through
// toShockValue so they always resolve to the same stored rule. NO
// AUTHENTICATION (M8 internal-MVP decision) — see portfolios/actions.ts.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { createScenario, createScenarioFromTemplate, removeShock, setAssetClassAssumptions, setScenarioArchived, updateScenario, upsertShock } from "@/lib/scenario-service";
import { toShockValue, type AmountUnit, type Direction } from "@/lib/scenario-studio";
import { shockTypeForAssetClass, type ShockType } from "@/lib/scenarios";
import type { ExposureAssetClass } from "@/lib/portfolio";
import { parseTargetOption } from "@/lib/queries/scenarios";

export interface ScenarioFormState {
  error?: string;
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

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

/** Reads one "direction + amount" pair from the form; blank amount means "no assumption". */
function readHumanValue(formData: FormData, prefix: string, shockType: ShockType, unit: AmountUnit): { ok: true; value: number | null } | { ok: false; error: string } {
  const raw = text(formData, `${prefix}_amount`).trim().replace(/,/g, "");
  if (raw === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: "Enter the size of the move as a plain number, e.g. 2.0 or 10." };
  const direction: Direction = text(formData, `${prefix}_dir`) === "DOWN" ? "DOWN" : "UP";
  const r = toShockValue({ shockType, direction, amount: Number(raw), unit });
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.message };
}

const CORE: { prefix: string; assetClass: ExposureAssetClass }[] = [
  { prefix: "gov", assetClass: "GOVERNMENT_BOND" },
  { prefix: "corp", assetClass: "CORPORATE_BOND" },
  { prefix: "eq", assetClass: "EQUITY" },
];

/** The "What do you want to test?" form: sets or clears the three asset-class assumptions together. Human (percentage points) and advanced (bps) entry resolve to the same stored value. */
export async function saveCoreAssumptionsAction(portfolioId: string, scenarioId: string, _prev: ScenarioFormState, formData: FormData): Promise<ScenarioFormState> {
  const bondUnit: AmountUnit = text(formData, "mode") === "bps" ? "BPS" : "PP";
  const entries: { assetClass: ExposureAssetClass; value: number | null }[] = [];
  for (const { prefix, assetClass } of CORE) {
    const shockType = shockTypeForAssetClass(assetClass);
    const r = readHumanValue(formData, prefix, shockType, shockType === "YIELD_BPS" ? bondUnit : "PCT");
    if (!r.ok) return { error: r.error };
    entries.push({ assetClass, value: r.value });
  }
  const result = await setAssetClassAssumptions({ scenarioId, entries });
  if (!result.ok) return { error: result.error };
  redirect(`${base(portfolioId)}/${scenarioId}?saved=1`);
}

/** Adds (or replaces) an issuer- or security-specific assumption chosen from the portfolio's own holdings. */
export async function addSpecificAssumptionAction(portfolioId: string, scenarioId: string, _prev: ScenarioFormState, formData: FormData): Promise<ScenarioFormState> {
  const target = parseTargetOption(text(formData, "target"));
  if (!target || target.kind === "ASSET_CLASS") return { error: "Choose what this assumption applies to." };
  const shockType: ShockType = target.kind === "ISSUER" ? target.shockType : target.instrument === "BOND" ? "YIELD_BPS" : "PRICE_PCT";
  const r = readHumanValue(formData, "v", shockType, shockType === "YIELD_BPS" ? (text(formData, "mode") === "bps" ? "BPS" : "PP") : "PCT");
  if (!r.ok) return { error: r.error };
  if (r.value === null) return { error: "Enter the size of the move." };
  const result = await upsertShock({ scenarioId, target, value: r.value });
  if (!result.ok) return { error: result.error };
  redirect(`${base(portfolioId)}/${scenarioId}?saved=1`);
}

export async function createFromTemplateAction(portfolioId: string, templateId: string): Promise<void> {
  const result = await createScenarioFromTemplate({ portfolioId, templateId });
  if (!result.ok) throw new Error(result.error);
  redirect(`${base(portfolioId)}/${result.id}`);
}

export async function removeShockAction(portfolioId: string, scenarioId: string, shockId: string): Promise<void> {
  const result = await removeShock(shockId);
  if (!result.ok) throw new Error(result.error);
  redirect(`${base(portfolioId)}/${scenarioId}`);
}
