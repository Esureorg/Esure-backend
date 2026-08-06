import type { Scenario, ScenarioSummary } from "./domain.js";

const scenarios = [
  {
    schemaVersion: 1,
    id: "xlm-payment",
    version: 1,
    name: "XLM payment",
    description: "Fund two Testnet accounts, send XLM, and verify the recipient balance.",
    network: "testnet",
    kind: "xlm-payment",
  },
  {
    schemaVersion: 1,
    id: "issued-asset-payment",
    version: 1,
    name: "Issued asset payment",
    description: "Issue TESTUSD and send it to a recipient through a trustline.",
    network: "testnet",
    kind: "issued-asset-payment",
  },
  {
    schemaVersion: 1,
    id: "missing-trustline",
    version: 1,
    name: "Missing trustline",
    description: "Verify that an asset payment fails when the recipient has no trustline.",
    network: "testnet",
    kind: "missing-trustline",
  },
] as const satisfies readonly Scenario[];

export function listScenarios(): ScenarioSummary[] {
  return scenarios.map(({ id, version, name, description }) => ({ id, version, name, description }));
}

export function findScenario(id: string): Scenario | undefined {
  return scenarios.find((scenario) => scenario.id === id);
}

