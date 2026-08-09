import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ScenarioDefinition, ScenarioSummary, ValidatedScenario } from "./domain.js";
import { SCENARIO_LIMITS, ScenarioValidationError, validateScenarioDefinition } from "./scenario-schema.js";

const extensions = new Set([".json", ".yaml", ".yml"]);

export function parseScenario(source: string, format: "json" | "yaml"): ValidatedScenario {
  if (Buffer.byteLength(source, "utf8") > SCENARIO_LIMITS.definitionBytes) {
    throw new ScenarioValidationError([`definition exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`]);
  }
  let parsed: unknown;
  try {
    parsed = format === "json"
      ? JSON.parse(source)
      : parseYaml(source, { maxAliasCount: 0, uniqueKeys: true, prettyErrors: false });
  } catch {
    throw new ScenarioValidationError([`definition is not valid ${format.toUpperCase()}`]);
  }
  return prepareScenario(parsed);
}

export function prepareScenario(value: unknown): ValidatedScenario {
  let serialized: string;
  try { serialized = JSON.stringify(value); }
  catch { throw new ScenarioValidationError(["definition must be JSON-serializable"]); }
  if (Buffer.byteLength(serialized, "utf8") > SCENARIO_LIMITS.definitionBytes) {
    throw new ScenarioValidationError([`definition exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`]);
  }
  const definition = validateScenarioDefinition(value);
  return { ...definition, contentHash: contentHash(definition) };
}

export function contentHash(definition: ScenarioDefinition): string {
  return `sha256:${createHash("sha256").update(canonicalJson(definition)).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class ScenarioRegistry {
  readonly #scenarios = new Map<string, ValidatedScenario>();

  constructor(directories: string[]) {
    for (const directory of directories) this.loadDirectory(directory);
  }

  list(): ScenarioSummary[] {
    return [...this.#scenarios.values()].map(({ id, version, name, description, contentHash }) => ({ id, version, name, description, contentHash }));
  }

  find(id: string): ValidatedScenario | undefined {
    const found = this.#scenarios.get(id);
    return found ? structuredClone(found) : undefined;
  }

  private loadDirectory(directory: string): void {
    const absolute = resolve(directory);
    const files = readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (files.length > 100) throw new ScenarioValidationError([`scenario directory ${absolute} exceeds 100 files`]);
    for (const file of files) {
      const extension = extname(file.name).toLowerCase();
      const path = resolve(absolute, file.name);
      if (statSync(path).size > SCENARIO_LIMITS.definitionBytes) throw new ScenarioValidationError([`definition ${file.name} exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`]);
      const scenario = parseScenario(readFileSync(path, "utf8"), extension === ".json" ? "json" : "yaml");
      if (this.#scenarios.has(scenario.id)) throw new ScenarioValidationError([`duplicate scenario id ${scenario.id}`]);
      this.#scenarios.set(scenario.id, scenario);
    }
  }
}
