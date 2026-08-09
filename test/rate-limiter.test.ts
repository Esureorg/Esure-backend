import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/rate-limiter.js";

describe("FixedWindowRateLimiter", () => {
  it("bounds requests and resets without real waiting", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1_000, 10, () => now);
    expect(limiter.consume("run:client", 1)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("run:client", 1)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    now = 1_001;
    expect(limiter.consume("run:client", 1).allowed).toBe(true);
  });
});
