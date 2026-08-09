import type { ScenarioDefinition } from "../src/domain.js";

export function completeScenario(): ScenarioDefinition {
  return {
    schemaVersion: 1, id: "complete-scenario", version: 1, name: "Complete scenario",
    description: "Exercises all declarative operations and assertions.", network: "testnet",
    accounts: [
      { id: "issuer", generate: true, fund: true },
      { id: "recipient", generate: true, fund: true },
      { id: "without-trust", generate: true, fund: true },
    ],
    assets: [
      { id: "xlm", type: "native" },
      { id: "demo", type: "issued", code: "DEMO", issuer: "issuer" },
    ],
    steps: [
      { id: "trust", type: "changeTrust", account: "recipient", asset: "demo", limit: "1000" },
      { id: "pay-xlm", type: "payment", from: "issuer", to: "recipient", asset: "xlm", amount: "1.5" },
      { id: "pay-demo", type: "payment", from: "issuer", to: "recipient", asset: "demo", amount: "7" },
      { id: "reject-demo", type: "payment", from: "issuer", to: "without-trust", asset: "demo", amount: "1" },
    ],
    assertions: [
      { type: "balanceEquals", account: "recipient", asset: "demo", amount: "7" },
      { type: "balanceChangedBy", account: "recipient", asset: "xlm", amount: "1.49999" },
      { type: "stepSucceeded", step: "pay-demo" },
      { type: "stepFailedWith", step: "reject-demo", transactionCode: "tx_failed", operationCodes: ["op_no_trust"] },
      { type: "trustlineExists", account: "recipient", asset: "demo" },
      { type: "trustlineMissing", account: "without-trust", asset: "demo" },
      { type: "transactionConfirmed", step: "pay-demo" },
      { type: "accountExists", account: "recipient" },
    ],
  };
}
