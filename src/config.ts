export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  horizonUrl: string;
  friendbotUrl: string;
  runTimeoutMs: number;
  stepTimeoutMs: number;
  maxConcurrentRuns: number;
  maxStoredRuns: number;
  runRetentionMs: number;
  rateLimitMax: number;
  runRateLimitMax: number;
  rateLimitWindowMs: number;
  bodyLimitBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const horizonUrl = env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  const friendbotUrl = env.STELLAR_FRIENDBOT_URL ?? "https://friendbot.stellar.org";
  requireHttpsUrl("STELLAR_HORIZON_URL", horizonUrl);
  requireHttpsUrl("STELLAR_FRIENDBOT_URL", friendbotUrl);

  if (!horizonUrl.includes("testnet") || friendbotUrl !== "https://friendbot.stellar.org") {
    throw new Error("Esure MVP is locked to the official Stellar Testnet services");
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    logLevel: env.LOG_LEVEL ?? "info",
    horizonUrl,
    friendbotUrl,
    runTimeoutMs: integerEnv(env, "RUN_TIMEOUT_MS", 120_000, 1_000, 600_000),
    stepTimeoutMs: integerEnv(env, "STEP_TIMEOUT_MS", 30_000, 500, 120_000),
    maxConcurrentRuns: integerEnv(env, "MAX_CONCURRENT_RUNS", 2, 1, 20),
    maxStoredRuns: integerEnv(env, "MAX_STORED_RUNS", 500, 10, 10_000),
    runRetentionMs: integerEnv(env, "RUN_RETENTION_MS", 3_600_000, 60_000, 86_400_000),
    rateLimitMax: integerEnv(env, "RATE_LIMIT_MAX", 120, 1, 10_000),
    runRateLimitMax: integerEnv(env, "RUN_RATE_LIMIT_MAX", 10, 1, 1_000),
    rateLimitWindowMs: integerEnv(env, "RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000),
    bodyLimitBytes: integerEnv(env, "BODY_LIMIT_BYTES", 16_384, 1_024, 1_048_576),
  };
}

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function requireHttpsUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
}
