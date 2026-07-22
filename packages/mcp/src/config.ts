import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * Runtime configuration, read once at startup.
 *
 * The design rule this file enforces is the one the whole product is built on:
 * *the agent gets wallet capabilities, not wallet ownership*. The key never
 * leaves this process, the host model never sees it, and every spend is bounded
 * by a cap the operator sets — not by the model's judgement.
 */

export type Config = {
  /** Base URL of the AgentOS deployment to talk to. */
  baseUrl: string;
  /** The agent's signer. Null means only free tools are available. */
  account: PrivateKeyAccount | null;
  /** Hard ceiling on a single x402 payment, in USDG. */
  maxPaymentUsdg: number;
  /**
   * Whether this server may broadcast a swap. Off by default: routing an order
   * is read-only, submitting one moves money.
   */
  allowSubmit: boolean;
  /** Ceiling on a single submitted trade, in USDG notional. */
  maxTradeUsdg: number;
};

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return n;
}

export function loadConfig(): Config {
  const key = process.env.AGENTOS_PRIVATE_KEY?.trim();
  let account: PrivateKeyAccount | null = null;

  if (key) {
    const normalized = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
      throw new Error("AGENTOS_PRIVATE_KEY must be a 32-byte hex private key");
    }
    account = privateKeyToAccount(normalized);
  }

  return {
    baseUrl: (process.env.AGENTOS_URL?.trim() || "https://agentos.markets").replace(/\/+$/, ""),
    account,
    maxPaymentUsdg: num("AGENTOS_MAX_PAYMENT_USDG", 0.1),
    allowSubmit: /^(1|true|yes)$/i.test(process.env.AGENTOS_ALLOW_SUBMIT?.trim() ?? ""),
    maxTradeUsdg: num("AGENTOS_MAX_TRADE_USDG", 25),
  };
}
