import type { RunReport } from "./domain.js";

export interface RunStore {
  create(run: RunReport): void;
  get(id: string): RunReport | undefined;
  update(id: string, update: Partial<RunReport>): RunReport;
}

export class InMemoryRunStore implements RunStore {
  readonly #runs = new Map<string, RunReport>();

  create(run: RunReport): void {
    this.#runs.set(run.id, structuredClone(run));
  }

  get(id: string): RunReport | undefined {
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : undefined;
  }

  update(id: string, update: Partial<RunReport>): RunReport {
    const current = this.#runs.get(id);
    if (!current) throw new Error(`Run ${id} does not exist`);
    const updated = { ...current, ...structuredClone(update) };
    this.#runs.set(id, updated);
    return structuredClone(updated);
  }
}

