import { describe, expect, it } from "vitest";
import type { RunReport } from "../src/domain.js";
import { InMemoryRunStore } from "../src/run-store.js";

describe("InMemoryRunStore resource bounds", () => {
  it("expires terminal runs after the retention window", () => {
    let now = Date.parse("2026-08-09T00:00:00.000Z");
    const store = new InMemoryRunStore(10, 1_000, () => now);
    store.create(run("old", "passed", new Date(now).toISOString()));
    now += 1_001;
    expect(store.get("old")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("evicts terminal runs but never active runs when bounded", () => {
    const store = new InMemoryRunStore(2, 60_000);
    store.create(run("active", "running"));
    store.create(run("finished", "passed", new Date().toISOString()));
    store.create(run("new", "requested"));
    expect(store.get("active")).toBeDefined();
    expect(store.get("finished")).toBeUndefined();
    expect(store.get("new")).toBeDefined();
  });
});

function run(id: string, status: RunReport["status"], completedAt?: string): RunReport {
  return {
    id,
    scenarioId: "xlm-payment",
    scenarioVersion: 1,
    network: "testnet",
    status,
    createdAt: "2026-08-09T00:00:00.000Z",
    ...(completedAt && { completedAt }),
    steps: [],
    assertions: [],
    summary: { stepsPassed: 0, stepsFailed: 0, assertionsPassed: 0, assertionsFailed: 0 },
  };
}
