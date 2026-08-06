export type RunStatus = "requested" | "validating" | "running" | "passed" | "failed";
export type StepStatus = "passed" | "failed";

export interface ScenarioSummary {
  id: string;
  version: number;
  name: string;
  description: string;
}

export interface Scenario extends ScenarioSummary {
  schemaVersion: 1;
  network: "testnet";
  kind: "xlm-payment" | "issued-asset-payment" | "missing-trustline";
}

export interface StepResult {
  id: string;
  type: string;
  status: StepStatus;
  transactionHash?: string;
  ledger?: number;
  message: string;
}

export interface AssertionResult {
  type: string;
  status: StepStatus;
  message: string;
}

export interface RunSummary {
  stepsPassed: number;
  stepsFailed: number;
  assertionsPassed: number;
  assertionsFailed: number;
}

export interface RunReport {
  id: string;
  scenarioId: string;
  scenarioVersion: number;
  network: "testnet";
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  steps: StepResult[];
  assertions: AssertionResult[];
  summary: RunSummary;
  error?: { code: string; message: string };
}

export interface LedgerExecution {
  steps: StepResult[];
  assertions: AssertionResult[];
}

export interface LedgerGateway {
  execute(scenario: Scenario): Promise<LedgerExecution>;
}

