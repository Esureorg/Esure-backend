import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioRegistry } from "./scenario-loader.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export function createScenarioRegistry(additionalDirectory?: string): ScenarioRegistry {
  const bundledDirectory = resolve(moduleDirectory, "..", "scenarios");
  return new ScenarioRegistry([bundledDirectory, ...(additionalDirectory ? [additionalDirectory] : [])]);
}
