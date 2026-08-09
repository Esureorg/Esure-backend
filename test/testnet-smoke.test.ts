import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RunReport } from "../src/domain.js";

const live = process.env.RUN_STELLAR_SMOKE === "1";

describe.runIf(live)("real Stellar Testnet smoke", () => {
  const app = buildApp({
    config: loadConfig({
      RUN_TIMEOUT_MS: "180000",
      STEP_TIMEOUT_MS: "45000",
      MAX_CONCURRENT_RUNS: "1",
      RUN_RATE_LIMIT_MAX: "20",
    }),
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  for (const scenarioId of ["xlm-payment", "issued-asset-payment", "missing-trustline"] as const) {
    it(`executes ${scenarioId} through the public API`, async () => {
      const started = await app.inject({
        method: "POST",
        url: "/api/v1/runs",
        payload: { scenarioId, inputs: {} },
      });
      expect(started.statusCode).toBe(202);
      const report = await waitForRun(started.json().id as string);
      expect(report.status).toBe("passed");
      expect(report.steps.every((step) => step.status === "passed")).toBe(true);
      expect(report.assertions.every((assertion) => assertion.status === "passed")).toBe(true);
      if (scenarioId === "xlm-payment") {
        expect(report.assertions[0]).toMatchObject({ type: "balanceChangedBy", expected: "5", actual: "5" });
      }
      if (scenarioId === "missing-trustline") {
        expect(report.assertions[0]).toMatchObject({
          type: "stepFailedWith",
          actual: "tx_failed/op_no_trust",
        });
      }
      const downloaded = await app.inject({ method: "GET", url: `/api/v1/runs/${report.id}/report` });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["content-disposition"]).toContain(`esure-run-${report.id}.json`);
    }, 150_000);
  }

  async function waitForRun(id: string): Promise<RunReport> {
    const deadline = Date.now() + 140_000;
    while (Date.now() < deadline) {
      const response = await app.inject({ method: "GET", url: `/api/v1/runs/${id}` });
      const report = response.json() as RunReport;
      if (report.status === "passed" || report.status === "failed") return report;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Run ${id} did not finish before the smoke-test deadline`);
  }
});
