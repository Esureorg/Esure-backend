import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { LedgerGateway, ValidatedScenario } from "./domain.js";
import { RunCapacityError } from "./errors.js";
import { openApiDocument } from "./openapi.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";
import { RunService } from "./run-service.js";
import { InMemoryRunStore } from "./run-store.js";
import { parseScenario, prepareScenario } from "./scenario-loader.js";
import { ScenarioValidationError } from "./scenario-schema.js";
import { createScenarioRegistry } from "./scenarios.js";
import { StellarTestnetGateway } from "./stellar-gateway.js";

interface BuildAppOptions { config: AppConfig; ledger?: LedgerGateway; logger?: boolean; }

const runBodySchema = {
  type: "object", additionalProperties: false, required: ["scenarioId"],
  properties: { scenarioId: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" }, inputs: { type: "object", additionalProperties: false, default: {} } },
} as const;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: options.config.bodyLimitBytes, ajv: { customOptions: { removeAdditional: false } } });
  app.addContentTypeParser(["application/yaml", "application/x-yaml", "text/yaml"], { parseAs: "string" }, (_request, body, done) => done(null, body));
  const registry = createScenarioRegistry(options.config.scenarioDirectory);
  const limiter = new FixedWindowRateLimiter(options.config.rateLimitWindowMs);
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    const isRunCreation = request.method === "POST" && (path === "/api/v1/runs" || path === "/api/v1/runs/definitions");
    const limit = isRunCreation ? options.config.runRateLimitMax : options.config.rateLimitMax;
    const result = limiter.consume(`${isRunCreation ? "run" : "global"}:${request.ip}`, limit);
    reply.header("x-ratelimit-limit", limit).header("x-ratelimit-remaining", result.remaining);
    if (!result.allowed) { reply.header("retry-after", result.retryAfterSeconds); return reply.code(429).send(apiError("RATE_LIMITED", "Request limit exceeded. Try again later.", request.id)); }
  });
  const ledger = options.ledger ?? new StellarTestnetGateway(options.config.horizonUrl, options.config.friendbotUrl);
  const runs = new RunService(new InMemoryRunStore(options.config.maxStoredRuns, options.config.runRetentionMs), ledger, {
    maxConcurrentRuns: options.config.maxConcurrentRuns, runTimeoutMs: options.config.runTimeoutMs, stepTimeoutMs: options.config.stepTimeoutMs,
  });

  app.get("/health", async () => ({ status: "ok", network: "testnet" }));
  app.get("/openapi.json", async () => openApiDocument());
  app.get("/api/v1/scenarios", async () => ({ items: registry.list() }));
  app.get<{ Params: { scenarioId: string } }>("/api/v1/scenarios/:scenarioId", async (request, reply) => {
    const scenario = registry.find(request.params.scenarioId);
    if (!scenario) return reply.code(404).send(apiError("SCENARIO_NOT_FOUND", "The requested scenario is not available.", request.id));
    return scenario;
  });
  app.post("/api/v1/scenarios/validate", async (request) => {
    const scenario = submittedScenario(request.body, request.headers["content-type"]);
    return { valid: true, scenarioId: scenario.id, scenarioVersion: scenario.version, schemaVersion: scenario.schemaVersion, contentHash: scenario.contentHash };
  });
  app.post<{ Body: { scenarioId: string; inputs?: Record<string, never> } }>("/api/v1/runs", { schema: { body: runBodySchema } }, async (request, reply) => {
    const scenario = registry.find(request.body.scenarioId);
    if (!scenario) return reply.code(404).send(apiError("SCENARIO_NOT_FOUND", "The requested scenario is not available.", request.id));
    return reply.code(202).send(runs.start(scenario));
  });
  app.post("/api/v1/runs/definitions", async (request, reply) => reply.code(202).send(runs.start(submittedScenario(request.body, request.headers["content-type"]))));
  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId", async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run) return reply.code(404).send(apiError("RUN_NOT_FOUND", "The requested run does not exist.", request.id));
    return run;
  });
  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/report", async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run) return reply.code(404).send(apiError("RUN_NOT_FOUND", "The requested run does not exist.", request.id));
    if (run.status !== "passed" && run.status !== "failed") return reply.code(409).send(apiError("RUN_NOT_COMPLETE", "The requested run is not complete.", request.id));
    return reply.header("content-disposition", `attachment; filename=esure-run-${run.id}.json`).send(run);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RunCapacityError) return reply.code(503).send({ error: { ...error.report, requestId: request.id, details: [] } });
    if (error instanceof ScenarioValidationError) return reply.code(400).send(apiError("INVALID_SCENARIO", error.message, request.id, error.issues));
    if (isScenarioDefinitionPath(request.url) && isInvalidJsonBodyError(error)) {
      return reply.code(400).send(apiError("INVALID_SCENARIO", "Scenario definition is invalid.", request.id, ["definition is not valid JSON"]));
    }
    if (hasStatus(error, 429)) return reply.code(429).send(apiError("RATE_LIMITED", "Request limit exceeded. Try again later.", request.id));
    if (hasStatus(error, 413)) return reply.code(413).send(apiError("INVALID_REQUEST", "The request body exceeded the allowed size.", request.id));
    if (isValidationError(error)) return reply.code(400).send(apiError("INVALID_REQUEST", "The request did not match the API schema.", request.id));
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send(apiError("INTERNAL_ERROR", "The request could not be completed.", request.id));
  });
  return app;
}

function submittedScenario(body: unknown, contentType: string | undefined): ValidatedScenario {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/yaml" || mediaType === "application/x-yaml" || mediaType === "text/yaml") {
    if (typeof body !== "string") throw new ScenarioValidationError(["YAML request body must be text"]);
    return parseScenario(body, "yaml");
  }
  return prepareScenario(body);
}
function apiError(code: string, message: string, requestId: string, details: string[] = []) { return { error: { code, message, requestId, details: details.slice(0, 50) } }; }
function isValidationError(error: unknown): error is { validation: unknown } { return typeof error === "object" && error !== null && "validation" in error; }
function hasStatus(error: unknown, status: number): boolean { return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === status; }
function isInvalidJsonBodyError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "name" in error && error.name === "FastifyError" &&
    "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY" &&
    "statusCode" in error && error.statusCode === 400;
}
function isScenarioDefinitionPath(url: string): boolean {
  const path = url.split("?", 1)[0];
  return path === "/api/v1/scenarios/validate" || path === "/api/v1/runs/definitions";
}
