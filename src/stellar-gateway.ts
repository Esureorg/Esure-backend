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
  LedgerGateway,
  Scenario,
  StepResult,
} from "./domain.js";

const TEST_ASSET_CODE = "TESTUSD";

export class StellarTestnetGateway implements LedgerGateway {
  readonly #server: Horizon.Server;

  constructor(
    horizonUrl: string,
    private readonly friendbotUrl: string,
  ) {
    this.#server = new Horizon.Server(horizonUrl);
  }

  async execute(scenario: Scenario): Promise<LedgerExecution> {
    switch (scenario.kind) {
      case "xlm-payment":
        return this.executeXlmPayment();
      case "issued-asset-payment":
        return this.executeIssuedAssetPayment(false);
      case "missing-trustline":
        return this.executeIssuedAssetPayment(true);
    }
  }

  private async executeXlmPayment(): Promise<LedgerExecution> {
    const sender = Keypair.random();
    const recipient = Keypair.random();
    await Promise.all([this.fund(sender.publicKey()), this.fund(recipient.publicKey())]);

    const payment = await this.submit(sender, [
      Operation.payment({ destination: recipient.publicKey(), asset: Asset.native(), amount: "5" }),
    ]);
    const balance = await this.balance(recipient.publicKey(), Asset.native());

    return {
      steps: [step("fund-accounts", "fundAccounts", "Test accounts funded."), txStep("send-xlm", "payment", payment)],
      assertions: [balanceAssertion(balance, "10005", "Recipient received 5 XLM.")],
    };
  }

  private async executeIssuedAssetPayment(expectFailure: boolean): Promise<LedgerExecution> {
    const issuer = Keypair.random();
    const recipient = Keypair.random();
    await Promise.all([this.fund(issuer.publicKey()), this.fund(recipient.publicKey())]);
    const asset = new Asset(TEST_ASSET_CODE, issuer.publicKey());
    const steps: StepResult[] = [step("fund-accounts", "fundAccounts", "Test accounts funded.")];

    if (!expectFailure) {
      const trust = await this.submit(recipient, [Operation.changeTrust({ asset })]);
      steps.push(txStep("create-trustline", "changeTrust", trust));
    }

    try {
      const payment = await this.submit(issuer, [
        Operation.payment({ destination: recipient.publicKey(), asset, amount: "100" }),
      ]);
      steps.push(txStep("send-testusd", "payment", payment));
      const balance = await this.balance(recipient.publicKey(), asset);
      return {
        steps,
        assertions: [
          expectFailure
            ? { type: "stepFailedWith", status: "failed", message: "Payment unexpectedly succeeded." }
            : balanceAssertion(balance, "100", "Recipient holds 100 TESTUSD."),
        ],
      };
    } catch (error) {
      if (!expectFailure) throw error;
      steps.push({
        id: "send-testusd",
        type: "payment",
        status: "passed",
        message: "Payment failed as expected because the recipient has no trustline.",
      });
      return {
        steps,
        assertions: [{ type: "stepFailedWith", status: "passed", message: "Missing trustline was rejected." }],
      };
    }
  }

  private async fund(publicKey: string): Promise<void> {
    const url = new URL(this.friendbotUrl);
    url.searchParams.set("addr", publicKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Friendbot request failed with HTTP ${response.status}`);
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
  const passed = canonicalDecimal(actual) === canonicalDecimal(expected);
  return {
    type: "balanceEquals",
    status: passed ? "passed" : "failed",
    message: passed ? success : `Expected balance ${expected}, received ${actual}.`,
  };
}

export function canonicalDecimal(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}
