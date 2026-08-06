import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { LedgerGateway } from "./domain.js";
import { findScenario, listScenarios } from "./scenarios.js";
import { RunService } from "./run-service.js";
import { InMemoryRunStore } from "./run-store.js";
import { StellarTestnetGateway } from "./stellar-gateway.js";

interface BuildAppOptions {
  config: AppConfig;
  ledger?: LedgerGateway;
  logger?: boolean;
}

const runBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["scenarioId"],
  properties: {
    scenarioId: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" },
    inputs: { type: "object", additionalProperties: false, default: {} },
  },
} as const;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const ledger = options.ledger ?? new StellarTestnetGateway(options.config.horizonUrl, options.config.friendbotUrl);
  const runs = new RunService(new InMemoryRunStore(), ledger);

  app.get("/health", async () => ({ status: "ok", network: "testnet" }));

  app.get("/api/v1/scenarios", async () => ({ items: listScenarios() }));

  app.get<{ Params: { scenarioId: string } }>("/api/v1/scenarios/:scenarioId", async (request, reply) => {
    const scenario = findScenario(request.params.scenarioId);
    if (!scenario) return reply.code(404).send(apiError("SCENARIO_NOT_FOUND", "The requested scenario is not available.", request.id));
    return scenario;
  });

  app.post<{ Body: { scenarioId: string; inputs?: Record<string, never> } }>(
    "/api/v1/runs",
    { schema: { body: runBodySchema } },
    async (request, reply) => {
      const scenario = findScenario(request.body.scenarioId);
      if (!scenario) return reply.code(404).send(apiError("SCENARIO_NOT_FOUND", "The requested scenario is not available.", request.id));
      return reply.code(202).send(runs.start(scenario));
    },
  );

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId", async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run) return reply.code(404).send(apiError("RUN_NOT_FOUND", "The requested run does not exist.", request.id));
    return run;
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/report", async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run) return reply.code(404).send(apiError("RUN_NOT_FOUND", "The requested run does not exist.", request.id));
    if (run.status !== "passed" && run.status !== "failed") {
      return reply.code(409).send(apiError("RUN_NOT_COMPLETE", "The requested run is not complete.", request.id));
    }
    return reply.header("content-disposition", `attachment; filename=esure-run-${run.id}.json`).send(run);
  });

  app.setErrorHandler((error, request, reply) => {
    if (isValidationError(error)) {
      return reply.code(400).send(apiError("INVALID_REQUEST", "The request did not match the API schema.", request.id));
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send(apiError("INTERNAL_ERROR", "The request could not be completed.", request.id));
  });

  return app;
}

function apiError(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId, details: [] } };
}

function isValidationError(error: unknown): error is { validation: unknown } {
  return typeof error === "object" && error !== null && "validation" in error;
}
