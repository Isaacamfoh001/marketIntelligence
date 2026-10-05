// ---------------------------------------------------------------------------
// Scenario starting points (M8.4). A TEMPLATE is an editable, clearly
// hypothetical set of starting assumptions — not a forecast, not a Korbly
// view. A saved scenario created from one is an ordinary analyst-owned
// definition; nothing links it back to the template.
// ---------------------------------------------------------------------------

import type { ExposureAssetClass } from "../portfolio";

export const TEMPLATE_DISCLAIMER = "Hypothetical starting point — edit these assumptions.";

export interface ScenarioTemplate {
  id: string;
  name: string;
  blurb: string;
  assumptions: { assetClass: ExposureAssetClass; /** bps for bonds, % for equities */ value: number }[];
}

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: "rate-pressure",
    name: "Rate pressure",
    blurb: "Explore what happens if Treasury-bill rates and bond yields rise while equities are unchanged.",
    assumptions: [
      { assetClass: "TREASURY_BILL", value: 200 },
      { assetClass: "GOVERNMENT_BOND", value: 200 },
      { assetClass: "CORPORATE_BOND", value: 300 },
      { assetClass: "EQUITY", value: 0 },
    ],
  },
  {
    id: "broad-selloff",
    name: "Broad selloff",
    blurb: "Explore simultaneous pressure across Treasury bills, bonds and equities.",
    assumptions: [
      { assetClass: "TREASURY_BILL", value: 200 },
      { assetClass: "GOVERNMENT_BOND", value: 200 },
      { assetClass: "CORPORATE_BOND", value: 300 },
      { assetClass: "EQUITY", value: -10 },
    ],
  },
  {
    id: "equity-pullback",
    name: "Equity pullback",
    blurb: "Explore a fall in equity prices while Treasury-bill rates and bond yields are unchanged.",
    assumptions: [{ assetClass: "EQUITY", value: -10 }],
  },
];

export const getTemplate = (id: string): ScenarioTemplate | undefined => SCENARIO_TEMPLATES.find((t) => t.id === id);
