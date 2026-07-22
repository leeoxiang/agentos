"use client";

import { parseUnits, formatUnits } from "viem";
import { USDG_DOMAIN, USDG_DECIMALS } from "../chain";
import {
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_VERSION,
  decodeSettleHeader,
  encodePaymentHeader,
  type PaymentPayload,
  type PaymentRequiredResponse,
  type PaymentRequirements,
  type SettleResult,
} from "./types";

/** 32 bytes of randomness; the on-chain nonce map makes replay impossible. */
export function randomNonce(): `0x${string}` {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

export type SignTypedData = (args: {
  domain: typeof USDG_DOMAIN;
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  primaryType: "TransferWithAuthorization";
  message: Record<string, unknown>;
}) => Promise<`0x${string}`>;

/** Build and sign the EIP-3009 authorization that satisfies a 402 challenge. */
export async function signPayment(
  requirements: PaymentRequirements,
  from: `0x${string}`,
  signTypedData: SignTypedData
): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // clock skew between agent and facilitator
  const validBefore = now + (requirements.maxTimeoutSeconds || 120);
  const nonce = randomNonce();
  const value = BigInt(requirements.maxAmountRequired);

  const signature = await signTypedData({
    domain: USDG_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from,
      to: requirements.payTo,
      value,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: requirements.network,
    payload: {
      signature,
      authorization: {
        from,
        to: requirements.payTo,
        value: value.toString(),
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
    },
  };
}

export type FetchStep = {
  stage: "challenge" | "sign" | "settle" | "done" | "error";
  detail: string;
  requirements?: PaymentRequirements;
  settlement?: SettleResult;
};

export type PaidFetchResult<T> = {
  data: T | null;
  steps: FetchStep[];
  settlement: SettleResult | null;
  error?: string;
};

/**
 * `fetch` that pays.
 *
 * Optimistically calls unpaid — a free or already-entitled resource costs
 * nothing. On `402` it signs the advertised terms and retries once. It never
 * retries twice: a second 402 means the terms changed or settlement failed, and
 * silently re-signing there is how an agent drains its own wallet.
 */
export async function fetchWithPayment<T = unknown>(
  url: string,
  init: RequestInit,
  from: `0x${string}`,
  signTypedData: SignTypedData,
  opts: { maxValueUsdg?: number; onStep?: (s: FetchStep) => void } = {}
): Promise<PaidFetchResult<T>> {
  const steps: FetchStep[] = [];
  const push = (s: FetchStep) => {
    steps.push(s);
    opts.onStep?.(s);
  };

  const first = await fetch(url, init);
  if (first.status !== 402) {
    const data = (await first.json().catch(() => null)) as T | null;
    push({ stage: "done", detail: `${first.status} — no payment required` });
    return { data, steps, settlement: null };
  }

  const challenge = (await first.json()) as PaymentRequiredResponse;
  const requirements = challenge.accepts?.[0];
  if (!requirements) {
    push({ stage: "error", detail: "402 carried no payment terms" });
    return { data: null, steps, settlement: null, error: "no_terms" };
  }

  const price = Number(formatUnits(BigInt(requirements.maxAmountRequired), USDG_DECIMALS));
  push({
    stage: "challenge",
    detail: `402 Payment Required — ${price} USDG to ${requirements.payTo.slice(0, 10)}…`,
    requirements,
  });

  // The spend cap is the whole point of letting an agent hold keys. Enforce it
  // before signing, not after.
  if (opts.maxValueUsdg !== undefined && price > opts.maxValueUsdg) {
    push({
      stage: "error",
      detail: `price ${price} USDG exceeds cap ${opts.maxValueUsdg} USDG — refusing to sign`,
    });
    return { data: null, steps, settlement: null, error: "over_cap" };
  }

  let payment: PaymentPayload;
  try {
    payment = await signPayment(requirements, from, signTypedData);
    push({ stage: "sign", detail: `signed EIP-3009 authorization, nonce ${payment.payload.authorization.nonce.slice(0, 12)}…` });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "signature rejected";
    push({ stage: "error", detail });
    return { data: null, steps, settlement: null, error: detail };
  }

  push({ stage: "settle", detail: "retrying with X-PAYMENT — facilitator is settling on Robinhood Chain" });
  const second = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-PAYMENT": encodePaymentHeader(payment) },
  });

  const receiptHeader = second.headers.get("X-PAYMENT-RESPONSE");
  const settlement = receiptHeader ? decodeSettleHeader(receiptHeader) : null;

  if (!second.ok) {
    const body = await second.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${second.status}`;
    push({ stage: "error", detail, settlement: settlement ?? undefined });
    return { data: null, steps, settlement, error: detail };
  }

  const data = (await second.json()) as T;
  push({
    stage: "done",
    detail: settlement?.transaction
      ? `settled in ${settlement.transaction.slice(0, 12)}…`
      : "paid and delivered",
    settlement: settlement ?? undefined,
  });
  return { data, steps, settlement };
}

export const toAtomicUsdg = (n: number) => parseUnits(String(n), USDG_DECIMALS);
export const fromAtomicUsdg = (n: bigint) => Number(formatUnits(n, USDG_DECIMALS));
