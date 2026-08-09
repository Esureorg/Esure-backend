import { describe, expect, it } from "vitest";
import {
  balanceDeltaAssertion,
  canonicalDecimal,
  isExpectedMissingTrustlineError,
  normalizeStellarError,
} from "../src/stellar-gateway.js";

describe("canonicalDecimal", () => {
  it("normalizes Horizon's fixed precision balances", () => {
    expect(canonicalDecimal("100.0000000")).toBe("100");
    expect(canonicalDecimal("001.2500000")).toBe("1.25");
  });

  it("preserves meaningful fractional digits", () => {
    expect(canonicalDecimal("0.0000001")).toBe("0.0000001");
  });
});

describe("balanceDeltaAssertion", () => {
  it("asserts the change rather than a fragile absolute Friendbot balance", () => {
    expect(balanceDeltaAssertion("9999.9999900", "10004.9999900", "5", "ok")).toMatchObject({
      type: "balanceChangedBy",
      status: "passed",
      expected: "5",
      actual: "5",
    });
  });

  it("reports the actual delta when it differs", () => {
    expect(balanceDeltaAssertion("10", "14.5", "5", "ok")).toMatchObject({ status: "failed", actual: "4.5" });
  });
});

describe("Stellar result-code normalization", () => {
  it("accepts only exact tx_failed/op_no_trust as the expected negative outcome", () => {
    const expected = normalizeStellarError(horizonError("tx_failed", ["op_no_trust"]), "send-testusd");
    expect(isExpectedMissingTrustlineError(expected)).toBe(true);

    for (const error of [
      horizonError("tx_failed", ["op_underfunded"]),
      horizonError("tx_failed", ["op_no_trust", "op_success"]),
      horizonError("tx_failed", []),
      horizonError("tx_bad_seq", []),
      new Error("network timeout"),
    ]) {
      expect(isExpectedMissingTrustlineError(normalizeStellarError(error, "send-testusd"))).toBe(false);
    }
  });

  it("returns allowlisted structured codes without leaking raw response details", () => {
    const secret = `S${"A".repeat(55)}`;
    const error = horizonError("tx_failed", ["op_no_trust"], secret);
    const normalized = normalizeStellarError(error, "send-testusd").report;
    expect(normalized).toMatchObject({
      code: "STELLAR_TRANSACTION_FAILED",
      category: "stellar",
      retryable: false,
      failedStepId: "send-testusd",
      stellarTransactionCode: "tx_failed",
      stellarOperationCodes: ["op_no_trust"],
    });
    expect(JSON.stringify(normalized)).not.toContain(secret);
  });
});

function horizonError(transaction: string, operations: string[], privateDetail = "removed") {
  return {
    response: {
      data: {
        extras: { result_codes: { transaction, operations }, result_xdr: privateDetail },
      },
    },
  };
}
