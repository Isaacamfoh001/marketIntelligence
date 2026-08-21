// ---------------------------------------------------------------------------
// Barrel export for the explainable market-intelligence layer (M8).
// UI code should import from here, not reach into individual dimension
// files directly — keeps the public surface of src/lib/intelligence/
// intentional and easy to audit.
// ---------------------------------------------------------------------------

export * from "./types";
export * from "./inflation";
export * from "./fx";
export * from "./rates";
export * from "./equities";
export * from "./materiality";
export * from "./market-condition";
