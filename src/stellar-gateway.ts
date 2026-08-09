import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type {
  AssertionResult,
  LedgerExecution,
  LedgerExecutionOptions,
  LedgerGateway,
  Scenario,
  StepResult,
} from "./domain.js";
import { SafeRunError, StepTimeoutError, withTimeout } from "./errors.js";

const TEST_ASSET_CODE = "TESTUSD";

export class StellarTestnetGateway implements LedgerGateway {
  readonly #server: Horizon.Server;

  constructor(
    horizonUrl: string,
    private readonly friendbotUrl: string,
  ) {
    this.#server = new Horizon.Server(horizonUrl);
  }

  async execute(scenario: Scenario, options: LedgerExecutionOptions = {}): Promise<LedgerExecution> {
    switch (scenario.kind) {
      case "xlm-payment":
        return this.executeXlmPayment(options);
      case "issued-asset-payment":
        return this.executeIssuedAssetPayment(false, options);
      case "missing-trustline":
        return this.executeIssuedAssetPayment(true, options);
    }
  }

  private async executeXlmPayment(options: LedgerExecutionOptions): Promise<LedgerExecution> {
    const sender = Keypair.random();
    const recipient = Keypair.random();
    const steps: StepResult[] = [];
    const assertions: AssertionResult[] = [];

    await this.performStep("fund-accounts", "fundAccounts", options, steps, async (signal) => {
      await Promise.all([this.fund(sender.publicKey(), signal), this.fund(recipient.publicKey(), signal)]);
      return step("fund-accounts", "fundAccounts", "Test accounts funded.");
    });

    const startingBalance = await this.readBalanceForAssertion(recipient.publicKey(), Asset.native(), options, steps, "send-xlm");
    const payment = await this.performStep("send-xlm", "payment", options, steps, async () => {
      const response = await this.submit(sender, [
        Operation.payment({ destination: recipient.publicKey(), asset: Asset.native(), amount: "5" }),
      ]);
      return txStep("send-xlm", "payment", response);
    });
    void payment;
    const finalBalance = await this.readBalanceForAssertion(recipient.publicKey(), Asset.native(), options, steps, "balance-delta");
    recordAssertion(assertions, balanceDeltaAssertion(startingBalance, finalBalance, "5", "Recipient balance increased by 5 XLM."), options);
    return { steps, assertions };
  }

  private async executeIssuedAssetPayment(
    expectMissingTrustline: boolean,
    options: LedgerExecutionOptions,
  ): Promise<LedgerExecution> {
    const issuer = Keypair.random();
    const recipient = Keypair.random();
    const asset = new Asset(TEST_ASSET_CODE, issuer.publicKey());
    const steps: StepResult[] = [];
    const assertions: AssertionResult[] = [];

    await this.performStep("fund-accounts", "fundAccounts", options, steps, async (signal) => {
      await Promise.all([this.fund(issuer.publicKey(), signal), this.fund(recipient.publicKey(), signal)]);
      return step("fund-accounts", "fundAccounts", "Test accounts funded.");
    });

    if (!expectMissingTrustline) {
      await this.performStep("create-trustline", "changeTrust", options, steps, async () => {
        const response = await this.submit(recipient, [Operation.changeTrust({ asset })]);
        return txStep("create-trustline", "changeTrust", response);
      });
    }

    try {
      const sendAsset = async () => {
        const response = await this.submit(issuer, [
          Operation.payment({ destination: recipient.publicKey(), asset, amount: "100" }),
        ]);
        return txStep("send-testusd", "payment", response);
      };
      if (expectMissingTrustline) {
        const result = await executeBounded("send-testusd", options, sendAsset);
        recordStep(steps, result, options);
      } else {
        await this.performStep("send-testusd", "payment", options, steps, sendAsset);
      }

      if (expectMissingTrustline) {
        recordAssertion(assertions, {
          type: "stepFailedWith",
          status: "failed",
          expected: "tx_failed/op_no_trust",
          actual: "transaction_succeeded",
          message: "Payment unexpectedly succeeded.",
        }, options);
        return { steps, assertions };
      }
    } catch (error) {
      const safe = normalizeStellarError(error, "send-testusd");
      if (!expectMissingTrustline || !isExpectedMissingTrustlineError(safe)) {
        if (expectMissingTrustline) {
          recordStep(steps, {
            id: "send-testusd",
            type: "payment",
            status: "failed",
            ...(safe.report.stellarTransactionCode && { stellarTransactionCode: safe.report.stellarTransactionCode }),
            ...(safe.report.stellarOperationCodes && { stellarOperationCodes: safe.report.stellarOperationCodes }),
            message: safe.report.message,
          }, options);
        }
        throw safe;
      }
      const report = safe.report;
      const expectedStep: StepResult = {
        id: "send-testusd",
        type: "payment",
        status: "passed",
        ...(report.stellarTransactionCode && { stellarTransactionCode: report.stellarTransactionCode }),
        ...(report.stellarOperationCodes && { stellarOperationCodes: report.stellarOperationCodes }),
        message: "Payment failed with tx_failed/op_no_trust as expected because the recipient has no trustline.",
      };
      recordStep(steps, expectedStep, options);
      recordAssertion(assertions, {
        type: "stepFailedWith",
        status: "passed",
        expected: "tx_failed/op_no_trust",
        actual: `${report.stellarTransactionCode}/${report.stellarOperationCodes?.[0]}`,
        message: "Missing trustline was rejected with the expected Stellar result code.",
      }, options);
      return { steps, assertions };
    }

    const balance = await this.readBalanceForAssertion(recipient.publicKey(), asset, options, steps, "balance-equals");
    recordAssertion(assertions, balanceAssertion(balance, "100", "Recipient holds 100 TESTUSD."), options);
    return { steps, assertions };
  }

  private async performStep(
    id: string,
    type: string,
    options: LedgerExecutionOptions,
    steps: StepResult[],
    action: (signal: AbortSignal) => Promise<StepResult>,
  ): Promise<StepResult> {
    try {
      const result = await executeBounded(id, options, action);
      recordStep(steps, result, options);
      return result;
    } catch (error) {
      const safe = normalizeStellarError(error, id);
      const failed: StepResult = {
        id,
        type,
        status: "failed",
        ...(safe.report.stellarTransactionCode && { stellarTransactionCode: safe.report.stellarTransactionCode }),
        ...(safe.report.stellarOperationCodes && { stellarOperationCodes: safe.report.stellarOperationCodes }),
        message: safe.report.message,
      };
      recordStep(steps, failed, options);
      throw safe;
    }
  }

  private async readBalanceForAssertion(
    publicKey: string,
    asset: Asset,
    options: LedgerExecutionOptions,
    steps: StepResult[],
    failedStepId: string,
  ): Promise<string> {
    try {
      return await executeBounded(failedStepId, options, async () => this.balance(publicKey, asset));
    } catch (error) {
      const safe = normalizeStellarError(error, failedStepId);
      if (!steps.some((candidate) => candidate.id === failedStepId)) {
        recordStep(steps, {
          id: failedStepId,
          type: "ledgerRead",
          status: "failed",
          message: safe.report.message,
        }, options);
      }
      throw safe;
    }
  }

  private async fund(publicKey: string, signal: AbortSignal): Promise<void> {
    const url = new URL(this.friendbotUrl);
    url.searchParams.set("addr", publicKey);
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new SafeRunError({
        code: "FRIENDBOT_UNAVAILABLE",
        message: "Friendbot could not be reached.",
        category: "network",
        retryable: true,
        failedStepId: "fund-accounts",
      });
    }
    if (!response.ok) {
      throw new SafeRunError({
        code: "FRIENDBOT_UNAVAILABLE",
        message: `Friendbot rejected the funding request with HTTP ${response.status}.`,
        category: "network",
        retryable: response.status === 429 || response.status >= 500,
        failedStepId: "fund-accounts",
      });
    }
  }

  private async submit(source: Keypair, operations: ReturnType<typeof Operation.payment>[]) {
    const account = await this.#server.loadAccount(source.publicKey());
    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
      timebounds: await this.#server.fetchTimebounds(60),
    });
    for (const operation of operations) builder.addOperation(operation);
    const transaction = builder.build();
    transaction.sign(source);
    return this.#server.submitTransaction(transaction);
  }

  private async balance(publicKey: string, asset: Asset): Promise<string> {
    const account = await this.#server.loadAccount(publicKey);
    const found = account.balances.find((balance) =>
      asset.isNative()
        ? balance.asset_type === "native"
        : "asset_code" in balance && balance.asset_code === asset.getCode() &&
          "asset_issuer" in balance && balance.asset_issuer === asset.getIssuer(),
    );
    return found?.balance ?? "0";
  }
}

async function executeBounded<T>(
  stepId: string,
  options: LedgerExecutionOptions,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (options.signal?.aborted) throw new SafeRunError({
    code: "RUN_TIMEOUT",
    message: "The run was cancelled after reaching its execution limit.",
    category: "timeout",
    retryable: true,
    failedStepId: stepId,
  });
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeoutMs = options.stepTimeoutMs ?? 30_000;
  return withTimeout(action(signal), timeoutMs, () => new StepTimeoutError(stepId, timeoutMs), () => controller.abort());
}

function recordStep(steps: StepResult[], result: StepResult, options: LedgerExecutionOptions): void {
  steps.push(result);
  options.onStep?.(structuredClone(result));
}

function recordAssertion(
  assertions: AssertionResult[],
  result: AssertionResult,
  options: LedgerExecutionOptions,
): void {
  assertions.push(result);
  options.onAssertion?.(structuredClone(result));
}

function step(id: string, type: string, message: string): StepResult {
  return { id, type, status: "passed", message };
}

function txStep(id: string, type: string, response: Horizon.HorizonApi.SubmitTransactionResponse): StepResult {
  return {
    id,
    type,
    status: "passed",
    transactionHash: response.hash,
    ledger: response.ledger,
    message: "Transaction confirmed on Stellar Testnet.",
  };
}

function balanceAssertion(actual: string, expected: string, success: string): AssertionResult {
  const canonicalActual = canonicalDecimal(actual);
  const canonicalExpected = canonicalDecimal(expected);
  const passed = canonicalActual === canonicalExpected;
  return {
    type: "balanceEquals",
    status: passed ? "passed" : "failed",
    expected: canonicalExpected,
    actual: canonicalActual,
    message: passed ? success : `Expected balance ${canonicalExpected}, received ${canonicalActual}.`,
  };
}

export function balanceDeltaAssertion(
  before: string,
  after: string,
  expectedDelta: string,
  success: string,
): AssertionResult {
  const actualDelta = stroopsToDecimal(decimalToStroops(after) - decimalToStroops(before));
  const expected = canonicalDecimal(expectedDelta);
  const passed = actualDelta === expected;
  return {
    type: "balanceChangedBy",
    status: passed ? "passed" : "failed",
    expected,
    actual: actualDelta,
    message: passed ? success : `Expected balance change ${expected}, received ${actualDelta}.`,
  };
}

export function isExpectedMissingTrustlineError(error: unknown): boolean {
  if (!(error instanceof SafeRunError)) return false;
  return error.report.stellarTransactionCode === "tx_failed" &&
    error.report.stellarOperationCodes?.length === 1 &&
    error.report.stellarOperationCodes[0] === "op_no_trust";
}

export function normalizeStellarError(error: unknown, failedStepId: string): SafeRunError {
  if (error instanceof SafeRunError) {
    if (!error.report.failedStepId) error.report.failedStepId = failedStepId;
    return error;
  }
  const codes = extractStellarResultCodes(error);
  if (codes) {
    return new SafeRunError({
      code: "STELLAR_TRANSACTION_FAILED",
      message: `Stellar rejected step ${failedStepId} with ${codes.transactionCode}/${codes.operationCodes.join(",") || "no_operation_code"}.`,
      category: "stellar",
      retryable: false,
      failedStepId,
      stellarTransactionCode: codes.transactionCode,
      stellarOperationCodes: codes.operationCodes,
    });
  }
  return new SafeRunError({
    code: "NETWORK_UNAVAILABLE",
    message: `Stellar network execution failed during step ${failedStepId}. Internal details were removed.`,
    category: "network",
    retryable: true,
    failedStepId,
  });
}

function extractStellarResultCodes(error: unknown): { transactionCode: string; operationCodes: string[] } | undefined {
  if (!isRecord(error)) return undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  const data = response && isRecord(response.data) ? response.data : undefined;
  const extras = data && isRecord(data.extras) ? data.extras : undefined;
  const resultCodes = extras && isRecord(extras.result_codes) ? extras.result_codes : undefined;
  const transactionCode = resultCodes && safeCode(resultCodes.transaction);
  if (!transactionCode) return undefined;
  const operationCodes = Array.isArray(resultCodes?.operations)
    ? resultCodes.operations.map(safeCode).filter((value): value is string => Boolean(value)).slice(0, 100)
    : [];
  return { transactionCode, operationCodes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : undefined;
}

export function canonicalDecimal(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function decimalToStroops(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("Balance must be a non-negative decimal with at most seven places");
  const [integer = "0", fraction = ""] = value.split(".");
  return BigInt(integer) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

function stroopsToDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const integer = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}
