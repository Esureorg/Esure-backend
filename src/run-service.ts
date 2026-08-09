import { randomUUID } from "node:crypto";
import type { LedgerGateway, RunError, RunReport, RunSummary, ValidatedScenario } from "./domain.js";
import type { RunStore } from "./run-store.js";
import { RunCapacityError, RunTimeoutError, SafeRunError, withTimeout } from "./errors.js";

const emptySummary = (): RunSummary => ({
  stepsPassed: 0,
  stepsFailed: 0,
  assertionsPassed: 0,
  assertionsFailed: 0,
});

export class RunService {
  #activeRuns = 0;

  constructor(
    private readonly store: RunStore,
    private readonly ledger: LedgerGateway,
    private readonly options: { maxConcurrentRuns: number; runTimeoutMs: number; stepTimeoutMs: number },
  ) {}

  start(scenario: ValidatedScenario): RunReport {
    if (this.#activeRuns >= this.options.maxConcurrentRuns) throw new RunCapacityError();
    const run: RunReport = {
      id: randomUUID(),
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      scenarioSchemaVersion: scenario.schemaVersion,
      scenarioContentHash: scenario.contentHash,
      network: "testnet",
      status: "requested",
      createdAt: new Date().toISOString(),
      steps: [],
      assertions: [],
      summary: emptySummary(),
    };
    this.store.create(run);
    this.#activeRuns += 1;
    setImmediate(() => void this.execute(run.id, scenario));
    return run;
  }

  get(id: string): RunReport | undefined {
    return this.store.get(id);
  }

  async execute(id: string, scenario: ValidatedScenario): Promise<void> {
    const controller = new AbortController();
    this.store.update(id, { status: "validating" });
    try {
      this.store.update(id, { status: "running" });
      const execution = this.ledger.execute(scenario, {
        signal: controller.signal,
        stepTimeoutMs: this.options.stepTimeoutMs,
        onStep: (step) => {
          const current = this.store.get(id);
          if (!current) return;
          const steps = [...current.steps, step];
          this.store.update(id, { steps, summary: summarize(steps, current.assertions) });
        },
        onAssertion: (assertion) => {
          const current = this.store.get(id);
          if (!current) return;
          const assertions = [...current.assertions, assertion];
          this.store.update(id, { assertions, summary: summarize(current.steps, assertions) });
        },
      });
      const result = await withTimeout(
        execution,
        this.options.runTimeoutMs,
        () => new RunTimeoutError(this.options.runTimeoutMs),
        () => controller.abort(),
      );
      const summary = summarize(result.steps, result.assertions);
      const passed = summary.stepsFailed === 0 && summary.assertionsFailed === 0;
      this.store.update(id, {
        status: passed ? "passed" : "failed",
        completedAt: new Date().toISOString(),
        steps: result.steps,
        assertions: result.assertions,
        summary,
        ...(!passed && {
          error: {
            code: "ASSERTION_FAILED",
            message: "One or more checks failed.",
            category: "stellar" as const,
            retryable: false,
          },
        }),
      });
    } catch (error) {
      const current = this.store.get(id);
      const steps = current?.steps ?? [];
      const assertions = current?.assertions ?? [];
      this.store.update(id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        steps,
        assertions,
        summary: summarize(steps, assertions),
        error: normalizeError(error),
      });
    } finally {
      controller.abort();
      this.#activeRuns = Math.max(0, this.#activeRuns - 1);
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

function normalizeError(error: unknown): RunError {
  if (error instanceof SafeRunError) return structuredClone(error.report);
  return {
    code: "INTERNAL_ERROR",
    message: "The scenario run failed unexpectedly. Sensitive internal details were removed.",
    category: "internal",
    retryable: false,
  };
}
