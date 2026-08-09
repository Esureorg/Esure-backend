import { scenarioSchemaV1 } from "./scenario-schema.js";

const runRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scenarioId"],
  properties: { scenarioId: { type: "string" }, inputs: { type: "object", additionalProperties: false } },
} as const;

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Esure API", version: "1.0.0", description: "Bounded declarative Stellar Testnet scenario execution." },
    servers: [{ url: "/" }],
    paths: {
      "/health": { get: { operationId: "getHealth", responses: { "200": { description: "Healthy" } } } },
      "/api/v1/scenarios": { get: { operationId: "listScenarios", responses: { "200": { description: "Scenario catalogue" } } } },
      "/api/v1/scenarios/{scenarioId}": { get: { operationId: "getScenario", parameters: [{ name: "scenarioId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Scenario definition", content: { "application/json": { schema: { $ref: "#/components/schemas/ScenarioV1" } } } }, "404": { description: "Not found" } } } },
      "/api/v1/scenarios/validate": { post: { operationId: "validateScenario", requestBody: definitionBody(), responses: { "200": { description: "Validated scenario and content hash" }, "400": { description: "Invalid scenario" } } } },
      "/api/v1/runs": { post: { operationId: "startCataloguedRun", requestBody: { required: true, content: { "application/json": { schema: runRequestSchema } } }, responses: { "202": { description: "Run accepted" } } } },
      "/api/v1/runs/definitions": { post: { operationId: "startDefinitionRun", requestBody: definitionBody(), responses: { "202": { description: "Declarative run accepted" }, "400": { description: "Invalid scenario" } } } },
      "/api/v1/runs/{runId}": { get: { operationId: "getRun", parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Run report" }, "404": { description: "Not found" } } } },
      "/api/v1/runs/{runId}/report": { get: { operationId: "downloadRunReport", parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Final JSON report" }, "409": { description: "Run incomplete" } } } },
    },
    components: { schemas: { ScenarioV1: scenarioSchemaV1, CataloguedRunRequest: runRequestSchema } },
  } as const;
}

function definitionBody() {
  return {
    required: true,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/ScenarioV1" } },
      "application/yaml": { schema: { type: "string" } },
      "text/yaml": { schema: { type: "string" } },
    },
  } as const;
}
