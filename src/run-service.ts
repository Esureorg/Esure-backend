import { randomUUID } from "node:crypto";
import type { LedgerGateway, RunReport, RunSummary, Scenario } from "./domain.js";
import type { RunStore } from "./run-store.js";

const emptySummary = (): RunSummary => ({
  stepsPassed: 0,
  stepsFailed: 0,
  assertionsPassed: 0,
  assertionsFailed: 0,
});

export class RunService {
  constructor(
    private readonly store: RunStore,
    private readonly ledger: LedgerGateway,
  ) {}

  start(scenario: Scenario): RunReport {
    const run: RunReport = {
      id: randomUUID(),
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      network: "testnet",
      status: "requested",
      createdAt: new Date().toISOString(),
      steps: [],
      assertions: [],
      summary: emptySummary(),
    };
    this.store.create(run);
    setImmediate(() => void this.execute(run.id, scenario));
    return run;
  }

  get(id: string): RunReport | undefined {
    return this.store.get(id);
  }

  async execute(id: string, scenario: Scenario): Promise<void> {
    this.store.update(id, { status: "validating" });
    try {
      this.store.update(id, { status: "running" });
      const result = await this.ledger.execute(scenario);
      const summary = summarize(result.steps, result.assertions);
      const passed = summary.stepsFailed === 0 && summary.assertionsFailed === 0;
      this.store.update(id, {
        status: passed ? "passed" : "failed",
        completedAt: new Date().toISOString(),
        steps: result.steps,
        assertions: result.assertions,
        summary,
        ...(!passed && { error: { code: "ASSERTION_FAILED", message: "One or more checks failed." } }),
      });
    } catch (error) {
      this.store.update(id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: normalizeError(error),
      });
    }
  }
}

function summarize(steps: RunReport["steps"], assertions: RunReport["assertions"]): RunSummary {
  return {
    stepsPassed: steps.filter((step) => step.status === "passed").length,
    stepsFailed: steps.filter((step) => step.status === "failed").length,
    assertionsPassed: assertions.filter((item) => item.status === "passed").length,
    assertionsFailed: assertions.filter((item) => item.status === "failed").length,
  };
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : "The scenario run failed unexpectedly.";
  const safeMessage = /S[A-Z2-7]{55}/.test(message)
    ? "The scenario run failed. Sensitive details were removed."
    : message.slice(0, 300);
  return { code: "TRANSACTION_FAILED", message: safeMessage };
}

