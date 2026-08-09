import type { RunReport } from "./domain.js";
import { RunCapacityError } from "./errors.js";

export interface RunStore {
  create(run: RunReport): void;
  get(id: string): RunReport | undefined;
  update(id: string, update: Partial<RunReport>): RunReport;
}

export class InMemoryRunStore implements RunStore {
  readonly #runs = new Map<string, RunReport>();

  constructor(
    private readonly maxEntries = 500,
    private readonly retentionMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    this.removeExpired();
    return this.#runs.size;
  }

  create(run: RunReport): void {
    this.removeExpired();
    while (this.#runs.size >= this.maxEntries) {
      const terminal = [...this.#runs.entries()].find(([, candidate]) => isTerminal(candidate));
      if (!terminal) throw new RunCapacityError("The run store is full with active runs. Try again later.");
      this.#runs.delete(terminal[0]);
    }
    this.#runs.set(run.id, structuredClone(run));
  }

  get(id: string): RunReport | undefined {
    this.removeExpired();
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : undefined;
  }

  update(id: string, update: Partial<RunReport>): RunReport {
    this.removeExpired();
    const current = this.#runs.get(id);
    if (!current) throw new Error(`Run ${id} does not exist`);
    const updated = { ...current, ...structuredClone(update) };
    this.#runs.set(id, updated);
    return structuredClone(updated);
  }

  private removeExpired(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [id, run] of this.#runs) {
      const terminalAt = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
      if (isTerminal(run) && Number.isFinite(terminalAt) && terminalAt <= cutoff) this.#runs.delete(id);
    }
  }
}

function isTerminal(run: RunReport): boolean {
  return run.status === "passed" || run.status === "failed";
}
