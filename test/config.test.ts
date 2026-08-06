import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses safe Testnet defaults", () => {
    const config = loadConfig({});
    expect(config.horizonUrl).toContain("testnet");
    expect(config.friendbotUrl).toBe("https://friendbot.stellar.org");
  });

  it("rejects Mainnet configuration", () => {
    expect(() => loadConfig({ STELLAR_HORIZON_URL: "https://horizon.stellar.org" })).toThrow(/Testnet/);
  });
});

