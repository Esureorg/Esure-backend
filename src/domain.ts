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
  stellarTransactionCode?: string;
  stellarOperationCodes?: string[];
  message: string;
}

export interface AssertionResult {
  type: string;
  status: StepStatus;
  expected?: string;
  actual?: string;
  message: string;
}

export type RunErrorCategory = "stellar" | "network" | "timeout" | "capacity" | "internal";

export interface RunError {
  code: string;
  message: string;
  category: RunErrorCategory;
  retryable: boolean;
  failedStepId?: string;
  stellarTransactionCode?: string;
  stellarOperationCodes?: string[];
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
  error?: RunError;
}

export interface LedgerExecution {
  steps: StepResult[];
  assertions: AssertionResult[];
}

export interface LedgerGateway {
  execute(scenario: Scenario, options?: LedgerExecutionOptions): Promise<LedgerExecution>;
}

export interface LedgerExecutionOptions {
  signal?: AbortSignal;
  stepTimeoutMs?: number;
  onStep?: (step: StepResult) => void;
  onAssertion?: (assertion: AssertionResult) => void;
}
