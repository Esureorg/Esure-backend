import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { LedgerExecution, LedgerGateway, Scenario } from "../src/domain.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 3001,
  logLevel: "silent",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
};

const ledger: LedgerGateway = {
  execute: vi.fn(async (_scenario: Scenario): Promise<LedgerExecution> => ({
    steps: [{ id: "send-xlm", type: "payment", status: "passed", message: "Confirmed." }],
    assertions: [{ type: "balanceEquals", status: "passed", message: "Balance matched." }],
  })),
};

const apps: ReturnType<typeof buildApp>[] = [];

function createApp() {
  const app = buildApp({ config, ledger });
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
});
