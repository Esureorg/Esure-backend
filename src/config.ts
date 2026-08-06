export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  horizonUrl: string;
  friendbotUrl: string;
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
  };
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

