import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { LedgerExecution, LedgerGateway, Scenario } from "../src/domain.js";
import type { AppConfig } from "../src/config.js";
import { SafeRunError } from "../src/errors.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 3001,
  logLevel: "silent",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  runTimeoutMs: 5_000,
  stepTimeoutMs: 1_000,
  maxConcurrentRuns: 2,
  maxStoredRuns: 100,
  runRetentionMs: 60_000,
  rateLimitMax: 100,
  runRateLimitMax: 50,
  rateLimitWindowMs: 60_000,
  bodyLimitBytes: 16_384,
};

const ledger: LedgerGateway = {
  execute: vi.fn(async (_scenario: Scenario): Promise<LedgerExecution> => ({
    steps: [{ id: "send-xlm", type: "payment", status: "passed", message: "Confirmed." }],
    assertions: [{ type: "balanceEquals", status: "passed", message: "Balance matched." }],
  })),
};

const apps: ReturnType<typeof buildApp>[] = [];

function createApp(options: { config?: AppConfig; ledger?: LedgerGateway } = {}) {
  const app = buildApp({ config: options.config ?? config, ledger: options.ledger ?? ledger });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.clearAllMocks();
});

describe("Esure API", () => {
  it("reports Testnet health", async () => {
    const response = await createApp().inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", network: "testnet" });
  });

  it("lists the three bundled scenarios", async () => {
    const response = await createApp().inject({ method: "GET", url: "/api/v1/scenarios" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(3);
  });

  it("returns a consistent not-found envelope", async () => {
    const response = await createApp().inject({ method: "GET", url: "/api/v1/scenarios/unknown" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("SCENARIO_NOT_FOUND");
  });

  it("rejects unknown request properties", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { scenarioId: "xlm-payment", network: "mainnet" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects oversized request bodies before validation or execution", async () => {
    const response = await createApp({ config: { ...config, bodyLimitBytes: 1_024 } }).inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ scenarioId: "xlm-payment", padding: "x".repeat(2_000) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("starts and completes a run without exposing secrets", async () => {
    const app = createApp();
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      payload: { scenarioId: "xlm-payment", inputs: {} },
    });
    expect(started.statusCode).toBe(202);
    const id = started.json().id as string;

    await vi.waitFor(async () => {
      const response = await app.inject({ method: "GET", url: `/api/v1/runs/${id}` });
      expect(response.json().status).toBe("passed");
      expect(response.body).not.toMatch(/S[A-Z2-7]{55}/);
    });
  });

  it("preserves completed steps when a later step fails", async () => {
    const failingLedger: LedgerGateway = {
      execute: vi.fn(async (_scenario, options) => {
        options?.onStep?.({ id: "fund-accounts", type: "fundAccounts", status: "passed", message: "Funded." });
        options?.onStep?.({
          id: "send-xlm",
          type: "payment",
          status: "failed",
          stellarTransactionCode: "tx_failed",
          stellarOperationCodes: ["op_underfunded"],
          message: "Stellar rejected the payment.",
        });
        throw new SafeRunError({
          code: "STELLAR_TRANSACTION_FAILED",
          message: "Stellar rejected the payment.",
          category: "stellar",
          retryable: false,
          failedStepId: "send-xlm",
          stellarTransactionCode: "tx_failed",
          stellarOperationCodes: ["op_underfunded"],
        });
      }),
    };
    const app = createApp({ ledger: failingLedger });
    const started = await app.inject({ method: "POST", url: "/api/v1/runs", payload: { scenarioId: "xlm-payment" } });
    const id = started.json().id as string;

    await vi.waitFor(async () => {
      const report = (await app.inject({ method: "GET", url: `/api/v1/runs/${id}` })).json();
      expect(report.status).toBe("failed");
      expect(report.steps).toHaveLength(2);
      expect(report.summary).toMatchObject({ stepsPassed: 1, stepsFailed: 1 });
      expect(report.error).toMatchObject({
        code: "STELLAR_TRANSACTION_FAILED",
        failedStepId: "send-xlm",
        stellarOperationCodes: ["op_underfunded"],
      });
    });
  });

  it("enforces the overall run timeout with a sanitized structured error", async () => {
    const stalledLedger: LedgerGateway = { execute: vi.fn(() => new Promise<LedgerExecution>(() => undefined)) };
    const app = createApp({ config: { ...config, runTimeoutMs: 25 }, ledger: stalledLedger });
    const started = await app.inject({ method: "POST", url: "/api/v1/runs", payload: { scenarioId: "xlm-payment" } });
    const id = started.json().id as string;

    await vi.waitFor(async () => {
      const report = (await app.inject({ method: "GET", url: `/api/v1/runs/${id}` })).json();
      expect(report.status).toBe("failed");
      expect(report.error).toMatchObject({ code: "RUN_TIMEOUT", category: "timeout", retryable: true });
    }, { timeout: 1_000 });
  });

  it("rejects run creation when the concurrency limit is reached", async () => {
    let release!: (value: LedgerExecution) => void;
    const blockedLedger: LedgerGateway = {
      execute: vi.fn(() => new Promise<LedgerExecution>((resolve) => { release = resolve; })),
    };
    const app = createApp({ config: { ...config, maxConcurrentRuns: 1 }, ledger: blockedLedger });
    const first = await app.inject({ method: "POST", url: "/api/v1/runs", payload: { scenarioId: "xlm-payment" } });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(() => expect(blockedLedger.execute).toHaveBeenCalled());
    const second = await app.inject({ method: "POST", url: "/api/v1/runs", payload: { scenarioId: "xlm-payment" } });
    expect(second.statusCode).toBe(503);
    expect(second.json().error.code).toBe("RUNNER_AT_CAPACITY");
    release({ steps: [], assertions: [] });
  });

  it("applies a stricter per-client rate limit to run creation", async () => {
    const app = createApp({ config: { ...config, runRateLimitMax: 1 } });
    expect((await app.inject({ method: "POST", url: "/api/v1/runs", payload: { scenarioId: "xlm-payment" } })).statusCode).toBe(202);
    const limited = await app.inject({ method: "POST", url: "/api/v1/runs", payload: { scenarioId: "xlm-payment" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
  });
});
