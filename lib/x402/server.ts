import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import { ADDR, PAY_TO, USDG_DECIMALS, USDG_DOMAIN, robinhood } from "../chain";
import { settlePayment, verifyPayment } from "./facilitator";
import {
  X402_NETWORK,
  X402_VERSION,
  decodePaymentHeader,
  encodeSettleHeader,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
} from "./types";

export type PaidRoute = {
  /** Stable id used by the service directory and the agent's tool list. */
  id: string;
  path: string;
  /** Price in whole USDG, e.g. 0.01. */
  priceUsdg: number;
  description: string;
  outputSchema?: unknown;
};

export function buildRequirements(route: PaidRoute, origin: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: parseUnits(String(route.priceUsdg), USDG_DECIMALS).toString(),
    resource: `${origin}${route.path}`,
    description: route.description,
    mimeType: "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
    asset: ADDR.usdg,
    outputSchema: route.outputSchema,
    extra: {
      name: USDG_DOMAIN.name,
      version: USDG_DOMAIN.version,
      chainId: robinhood.id,
      decimals: USDG_DECIMALS,
    },
  };
}

export type Paywall =
  | { paid: false; response: NextResponse }
  | { paid: true; payer: `0x${string}`; settlement: SettleResult; requirements: PaymentRequirements };

/**
 * Gate a route behind x402.
 *
 * No `X-PAYMENT` header, or a bad one, returns a `402` carrying the terms.
 * A good one is verified then settled, and the settlement receipt rides back on
 * `X-PAYMENT-RESPONSE` so the caller can prove what it paid for.
 *
 * Settlement runs *before* the handler produces its result. That ordering makes
 * the paid work non-refundable if the handler later fails — acceptable for
 * cheap metered reads, and the reason `settleAfter` exists for expensive ones.
 */
export async function requirePayment(
  req: Request,
  route: PaidRoute,
  opts: { settle?: boolean } = {}
): Promise<Paywall> {
  const origin = new URL(req.url).origin;
  const requirements = buildRequirements(route, origin);

  const header = req.headers.get("x-payment");
  if (!header) {
    return {
      paid: false,
      response: NextResponse.json(
        {
          x402Version: X402_VERSION,
          accepts: [requirements],
          error: "X-PAYMENT header is required",
        },
        { status: 402 }
      ),
    };
  }

  let payment: PaymentPayload;
  try {
    payment = decodePaymentHeader(header);
  } catch {
    return {
      paid: false,
      response: NextResponse.json(
        { x402Version: X402_VERSION, accepts: [requirements], error: "malformed X-PAYMENT header" },
        { status: 402 }
      ),
    };
  }

  if (PAY_TO === "0x0000000000000000000000000000000000000000") {
    return {
      paid: false,
      response: NextResponse.json(
        {
          x402Version: X402_VERSION,
          accepts: [requirements],
          error: "receiver not configured: set NEXT_PUBLIC_PAY_TO",
        },
        { status: 402 }
      ),
    };
  }

  const verification = await verifyPayment(payment, requirements);
  if (!verification.isValid) {
    return {
      paid: false,
      response: NextResponse.json(
        { x402Version: X402_VERSION, accepts: [requirements], error: verification.invalidReason },
        { status: 402 }
      ),
    };
  }

  if (opts.settle === false) {
    return {
      paid: true,
      payer: verification.payer,
      requirements,
      settlement: {
        success: true,
        transaction: null,
        network: X402_NETWORK,
        payer: verification.payer,
        errorReason: "verified_not_settled",
      },
    };
  }

  const settlement = await settlePayment(payment, requirements);
  if (!settlement.success) {
    return {
      paid: false,
      response: NextResponse.json(
        {
          x402Version: X402_VERSION,
          accepts: [requirements],
          error: settlement.errorReason ?? "settlement_failed",
          selfSubmit: settlement.selfSubmit,
        },
        { status: 402, headers: { "X-PAYMENT-RESPONSE": encodeSettleHeader(settlement) } }
      ),
    };
  }

  return { paid: true, payer: verification.payer, settlement, requirements };
}

/** Attach the settlement receipt to a successful paid response. */
export function withReceipt(body: unknown, gate: Extract<Paywall, { paid: true }>) {
  return NextResponse.json(body, {
    headers: {
      "X-PAYMENT-RESPONSE": encodeSettleHeader(gate.settlement),
      "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
    },
  });
}
