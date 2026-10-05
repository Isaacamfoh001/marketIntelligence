// ---------------------------------------------------------------------------
// Treasury-bill instrument terms (M8.5). Pure validation shared by the service
// and the tests. A bill's identity is (tenor, maturity date); the issue date is
// implied (maturity − tenor) and recorded for provenance. Face value belongs to
// the POSITION (what the analyst holds), not the instrument.
//
// No purchase amount / purchase rate / cost basis is recorded: none is needed
// for a reference value, and Korbly has no transaction system (M8 scope).
// ---------------------------------------------------------------------------

import { BILL_TENORS, type BillTenorDays } from "./convention";

const DAY_MS = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface BillTerms {
  tenorDays: BillTenorDays;
  issueDate: Date;
  maturityDate: Date;
}

export const isBillTenor = (n: number): n is BillTenorDays => (BILL_TENORS as readonly number[]).includes(n);

export function parseIsoDate(text: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || isoDay(d) !== text ? null : d;
}

export type BillTermsCheck = { ok: true; terms: BillTerms } | { ok: false; error: string };

/**
 * A bill is described by its ORIGINAL tenor (91/182/364) and its maturity date.
 * The issue date is derived; if supplied it must equal maturity − tenor.
 */
export function validateBillTerms(input: { tenorDays: number; maturityDate: Date | null; issueDate?: Date | null; currency?: string; isin?: string | null }): BillTermsCheck {
  if (input.currency !== undefined && input.currency !== "GHS") return { ok: false, error: `Only GHS Treasury bills are supported (this one is ${input.currency}).` };
  if (!Number.isInteger(input.tenorDays) || !isBillTenor(input.tenorDays)) return { ok: false, error: `Choose the bill's original tenor: ${BILL_TENORS.join(", ")} days.` };
  const m = input.maturityDate;
  if (!m || Number.isNaN(m.getTime())) return { ok: false, error: "Enter the bill's maturity date." };
  const issueDate = new Date(m.getTime() - input.tenorDays * DAY_MS);
  if (input.issueDate && isoDay(input.issueDate) !== isoDay(issueDate)) {
    return { ok: false, error: `A ${input.tenorDays}-day bill maturing ${isoDay(m)} would have been issued ${isoDay(issueDate)}, not ${isoDay(input.issueDate)}.` };
  }
  if (input.isin !== undefined && input.isin !== null && input.isin !== "" && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(input.isin)) return { ok: false, error: "That ISIN is not in a valid format (2 letters, 9 letters/digits, 1 check digit)." };
  return { ok: true, terms: { tenorDays: input.tenorDays, issueDate, maturityDate: m } };
}

/**
 * A bill that exists today was issued on or before today: a "91-day bill maturing in 120 days"
 * would not have been issued yet. Rejects such impossible instruments instead of valuing them.
 */
export function checkBillIssued(terms: BillTerms, valuationDate: Date): { ok: true } | { ok: false; error: string } {
  if (terms.issueDate.getTime() > valuationDate.getTime()) {
    return { ok: false, error: `A ${terms.tenorDays}-day bill maturing ${isoDay(terms.maturityDate)} would only be issued on ${isoDay(terms.issueDate)}, which is in the future — check the tenor and maturity date.` };
  }
  return { ok: true };
}

/** Whole calendar days from `valuationDate` to maturity (≤ 0 once matured). */
export function billDaysToMaturity(maturityDate: Date, valuationDate: Date): number {
  return Math.round((maturityDate.getTime() - valuationDate.getTime()) / DAY_MS);
}

export const billLabel = (tenorDays: number, maturityDate: Date | string): string => `${tenorDays}-day T-bill · ${typeof maturityDate === "string" ? maturityDate : isoDay(maturityDate)}`;

export const GOVERNMENT_OF_GHANA = "Government of Ghana";
