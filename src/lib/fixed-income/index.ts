// ---------------------------------------------------------------------------
// Barrel export for the fixed-income analytics engine (M7). UI code and
// queries should import from here rather than reaching into individual
// files, mirroring src/lib/intelligence/index.ts's convention.
// ---------------------------------------------------------------------------

export * from "./types";
export * from "./classification";
export * from "./cashflow";
export * from "./accrued";
export * from "./pricing";
export * from "./yield";
export * from "./duration";
export * from "./benchmark";
export * from "./comparables";
export * from "./investment-calculator";
export * from "./treasury-bill-adapter";
export * from "./security-analytics";
export * from "./lifecycle";
export * from "./transaction-costs";
export * from "./price-scenarios";
export * from "./insights";
export * from "./format";
export * from "./observation-quality";
