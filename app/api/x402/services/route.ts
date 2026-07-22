import { NextResponse } from "next/server";
import { ADDR, PAY_TO, USDG_DECIMALS, USDG_DOMAIN, robinhood } from "@/lib/chain";
import { CATALOG_LIST } from "@/lib/x402/catalog";
import { buildRequirements } from "@/lib/x402/server";
import { X402_NETWORK, X402_VERSION } from "@/lib/x402/types";
import { facilitatorAccount } from "@/lib/x402/facilitator";

export const dynamic = "force-dynamic";

/**
 * x402 service discovery. Free by design — an agent has to be able to read the
 * menu before it can agree to a price.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const facilitator = facilitatorAccount();

  return NextResponse.json({
    x402Version: X402_VERSION,
    network: X402_NETWORK,
    chainId: robinhood.id,
    asset: {
      address: ADDR.usdg,
      symbol: "USDG",
      name: USDG_DOMAIN.name,
      decimals: USDG_DECIMALS,
      eip712Version: USDG_DOMAIN.version,
    },
    payTo: PAY_TO,
    facilitator: {
      mode: facilitator ? "sponsored" : "self-submit",
      address: facilitator?.address ?? null,
      note: facilitator
        ? "Facilitator broadcasts settlement — payment is gasless for the agent."
        : "No facilitator key configured: the 402 response returns calldata for the payer to submit.",
    },
    services: CATALOG_LIST.map((r) => ({
      id: r.id,
      resource: `${origin}${r.path}`,
      priceUsdg: r.priceUsdg,
      description: r.description,
      accepts: [buildRequirements(r, origin)],
    })),
  });
}
