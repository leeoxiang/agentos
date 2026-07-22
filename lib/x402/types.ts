/**
 * x402 — HTTP 402 as a machine-to-machine settlement handshake.
 *
 * A server answers an unpaid request with `402` plus machine-readable payment
 * terms. The client signs an EIP-3009 authorization over USDG, base64s it into
 * an `X-PAYMENT` header, and retries. A facilitator verifies the signature and
 * broadcasts the transfer, so the paying agent never needs gas.
 *
 * Shapes follow the x402 v1 wire format. `network` is "robinhood-chain"
 * (chain id 4663) — 4663 has no slug in the upstream registry yet, so the id is
 * echoed in `extra.chainId` for clients that resolve networks numerically.
 */

export const X402_VERSION = 1;
export const X402_NETWORK = "robinhood-chain";

export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  /** Atomic units (USDG has 6 decimals) as a decimal string. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  asset: `0x${string}`;
  outputSchema?: unknown;
  extra: {
    /** EIP-712 domain of the asset — required to reproduce the signature. */
    name: string;
    version: string;
    chainId: number;
    decimals: number;
  };
};

export type PaymentRequiredResponse = {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
};

export type ExactAuthorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  /** Atomic units, decimal string. */
  value: string;
  validAfter: string;
  validBefore: string;
  /** 32-byte random nonce; replay protection lives on-chain. */
  nonce: `0x${string}`;
};

export type PaymentPayload = {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: {
    signature: `0x${string}`;
    authorization: ExactAuthorization;
  };
};

export type VerifyResult =
  | { isValid: true; payer: `0x${string}` }
  | { isValid: false; invalidReason: string; payer?: `0x${string}` };

export type SettleResult = {
  success: boolean;
  transaction: `0x${string}` | null;
  network: string;
  payer: `0x${string}` | null;
  errorReason?: string;
  /** Set when no facilitator key is configured and the payer must self-submit. */
  selfSubmit?: {
    to: `0x${string}`;
    data: `0x${string}`;
  };
};

/** EIP-712 struct the payer signs. Must match USDG's EIP-3009 implementation. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePaymentHeader(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

export function encodeSettleHeader(result: SettleResult): string {
  return Buffer.from(JSON.stringify(result), "utf8").toString("base64");
}

export function decodeSettleHeader(header: string): SettleResult {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}
