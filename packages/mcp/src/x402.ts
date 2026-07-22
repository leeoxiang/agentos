import type { PrivateKeyAccount } from "viem/accounts";
import type { Config } from "./config.js";

/**
 * The x402 client, node-side.
 *
 * Mirrors the browser implementation in the AgentOS app: call unpaid, and only
 * if the server answers 402 sign an EIP-3009 TransferWithAuthorization over
 * USDG and retry once. It never retries twice — a second 402 means the terms
 * changed or settlement failed, and silently re-signing there is how an agent
 * drains its own wallet.
 */

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

type PaymentRequirements = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  asset: `0x${string}`;
  extra: { name: string; version: string; chainId: number; decimals: number };
};

export type Settlement = {
  success: boolean;
  transaction: string | null;
  errorReason?: string;
};

export type PaidResult<T> = {
  data: T;
  /** Null when the resource was free or already entitled. */
  payment: {
    priceUsdg: number;
    payTo: string;
    nonce: string;
    settlement: Settlement | null;
  } | null;
};

export class PaymentError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "PaymentError";
  }
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

async function sign(
  account: PrivateKeyAccount,
  terms: PaymentRequirements
): Promise<{ header: string; nonce: `0x${string}` }> {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // clock skew between agent and facilitator
  const validBefore = now + (terms.maxTimeoutSeconds || 120);
  const nonce = randomNonce();
  const value = BigInt(terms.maxAmountRequired);

  const signature = await account.signTypedData({
    domain: {
      name: terms.extra.name,
      version: terms.extra.version,
      chainId: terms.extra.chainId,
      verifyingContract: terms.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: terms.payTo,
      value,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  const envelope = {
    x402Version: 1,
    scheme: "exact",
    network: terms.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: terms.payTo,
        value: value.toString(),
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
    },
  };

  return { header: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"), nonce };
}

/**
 * Fetch a resource, paying for it if the server demands payment.
 *
 * The spend cap is checked *before* the key is used, not after — a cap enforced
 * only on the response is not a cap.
 */
export async function fetchPaid<T = unknown>(
  cfg: Config,
  path: string,
  init: RequestInit = {}
): Promise<PaidResult<T>> {
  const url = `${cfg.baseUrl}${path}`;
  const first = await fetch(url, init);

  if (first.status !== 402) {
    if (!first.ok) {
      const body = await first.text().catch(() => "");
      throw new PaymentError(`${init.method ?? "GET"} ${path} failed: HTTP ${first.status}`, body.slice(0, 400));
    }
    return { data: (await first.json()) as T, payment: null };
  }

  const challenge = (await first.json()) as { accepts?: PaymentRequirements[]; error?: string };
  const terms = challenge.accepts?.[0];
  if (!terms) throw new PaymentError("402 response carried no payment terms", challenge);

  if (!cfg.account) {
    throw new PaymentError(
      `${path} costs USDG and no wallet is configured. Set AGENTOS_PRIVATE_KEY to let this agent pay.`,
      { priceAtomic: terms.maxAmountRequired, payTo: terms.payTo }
    );
  }

  const priceUsdg = Number(terms.maxAmountRequired) / 10 ** terms.extra.decimals;
  if (priceUsdg > cfg.maxPaymentUsdg) {
    throw new PaymentError(
      `Refusing to sign: ${path} asks ${priceUsdg} USDG, over the ${cfg.maxPaymentUsdg} USDG cap ` +
        `(AGENTOS_MAX_PAYMENT_USDG).`
    );
  }

  const { header, nonce } = await sign(cfg.account, terms);

  const second = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-PAYMENT": header },
  });

  const receipt = second.headers.get("X-PAYMENT-RESPONSE");
  const settlement: Settlement | null = receipt
    ? (JSON.parse(Buffer.from(receipt, "base64").toString("utf8")) as Settlement)
    : null;

  if (!second.ok) {
    const body = (await second.json().catch(() => ({}))) as { error?: string };
    throw new PaymentError(
      `Payment for ${path} was not accepted: ${body.error ?? `HTTP ${second.status}`}`,
      { nonce, settlement }
    );
  }

  return {
    data: (await second.json()) as T,
    payment: { priceUsdg, payTo: terms.payTo, nonce, settlement },
  };
}

/** Read a free endpoint. Kept separate so a free path can never sign anything. */
export async function fetchFree<T = unknown>(cfg: Config, path: string): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PaymentError(`GET ${path} failed: HTTP ${res.status}`, body.slice(0, 400));
  }
  return (await res.json()) as T;
}
