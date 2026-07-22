import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/x402/catalog";
import { requirePayment, withReceipt } from "@/lib/x402/server";
import { findPool, poolDepthUsdg, priceFromSqrt } from "@/lib/market";
import { resolveStock } from "@/lib/order";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The most expensive endpoint in the catalog, and the clearest case for x402:
 * it costs real compute to serve, so it settles before the model is called.
 */
export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "AAPL";

  const gate = await requirePayment(req, CATALOG.research);
  if (!gate.paid) return gate.response;

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: "research model is not configured" }, { status: 503 });

  try {
    const stock = resolveStock(symbol);
    const pool = await findPool(stock.address);
    if (!pool) return NextResponse.json({ error: `no USDG pool for ${stock.symbol}` }, { status: 404 });

    const price = priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0);
    const depth = poolDepthUsdg(pool);

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1600,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system:
        "You write tight trading briefs for autonomous agents operating on Robinhood Chain, where US equities trade as ERC-20 tokens against USDG. Ground every claim about price or liquidity in the on-chain figures given. Be specific about what the depth number means for order sizing. No hedging boilerplate, no disclaimers about not being financial advice — the caller is a program. Under 200 words.",
      messages: [
        {
          role: "user",
          content: `Brief on ${stock.symbol} (${stock.name}, ${stock.sector} sector).
On-chain state right now:
- spot: ${price.toFixed(2)} USDG per share
- pool: ${pool.address} at ${pool.fee / 10_000}% fee tier
- USDG-side depth: ${Math.round(depth).toLocaleString()} USDG

Cover: what the depth implies for maximum sane order size, how the fee tier affects round-trip cost, and the sector context an agent should weigh.`,
        },
      ],
    });

    const brief = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return withReceipt(
      {
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        priceUsdg: price,
        depthUsdg: depth,
        feeTier: pool.fee,
        brief,
        paidBy: gate.payer,
      },
      gate
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "research failed" },
      { status: 500 }
    );
  }
}
