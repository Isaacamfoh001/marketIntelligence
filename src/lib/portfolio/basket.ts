// ---------------------------------------------------------------------------
// Pure selection logic for the portfolio builder (M9.0) — search, asset-class
// filtering and the selected-instruments basket — kept out of the React
// component so it is unit-tested. No I/O.
// ---------------------------------------------------------------------------

export type PickerTab = "TREASURY_BILL" | "GOVERNMENT_BOND" | "CORPORATE_BOND" | "EQUITY";

export interface PickableBond {
  id: string;
  label: string;
  issuerName: string;
  instrumentCode: string;
  instrumentType: "GOVERNMENT_BOND" | "CORPORATE_BOND";
  addable: { addable: boolean };
}
export interface PickableEquity {
  id: string;
  ticker: string;
  companyName: string;
  addable: { addable: boolean };
}

const matches = (haystack: string, query: string) => {
  const q = query.trim().toLowerCase();
  return q === "" || q.split(/\s+/).every((t) => haystack.toLowerCase().includes(t));
};

/** Bonds of the chosen class matching every word of the query; instruments that can never be held are hidden unless asked for. */
export function filterBonds<T extends PickableBond>(bonds: T[], tab: PickerTab, query: string, showBlocked: boolean): T[] {
  if (tab === "EQUITY" || tab === "TREASURY_BILL") return [];
  return bonds.filter((b) => b.instrumentType === tab && (showBlocked || b.addable.addable) && matches(`${b.label} ${b.issuerName} ${b.instrumentCode}`, query));
}

export function filterEquities<T extends PickableEquity>(equities: T[], tab: PickerTab, query: string, showBlocked: boolean): T[] {
  if (tab !== "EQUITY") return [];
  return equities.filter((e) => (showBlocked || e.addable.addable) && matches(`${e.ticker} ${e.companyName}`, query));
}

export interface BasketRowBase {
  key: string;
}

/** Selecting an already-selected instrument unselects it, so one instrument can never appear twice. */
export function toggleBasketRow<T extends BasketRowBase>(rows: T[], row: T): T[] {
  return rows.some((r) => r.key === row.key) ? rows.filter((r) => r.key !== row.key) : [...rows, row];
}

export function removeBasketRow<T extends BasketRowBase>(rows: T[], key: string): T[] {
  return rows.filter((r) => r.key !== key);
}

export const bondKey = (id: string) => `BOND:${id}`;
export const equityKey = (id: string) => `EQUITY:${id}`;
export const heldBillKey = (tenorDays: number, maturityDate: string) => `BILL:${tenorDays}:${maturityDate}`;
