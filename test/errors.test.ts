import { describe, expect, it, vi } from "vitest";
import { StepTimeoutError, withTimeout } from "../src/errors.js";

describe("withTimeout", () => {
  it("fails a stalled step with a structured timeout", async () => {
    vi.useFakeTimers();
    const promise = withTimeout(
      new Promise<void>(() => undefined),
      100,
      () => new StepTimeoutError("send-xlm", 100),
    );
    const expectation = expect(promise).rejects.toMatchObject({
      report: { code: "STEP_TIMEOUT", failedStepId: "send-xlm", category: "timeout" },
    });
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    vi.useRealTimers();
  });
});
