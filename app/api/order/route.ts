import { NextResponse } from "next/server";
import { isAddr } from "@/lib/addr";
import { buildOrder, type Side } from "@/lib/order";

export const dynamic = "force-dynamic";

/** Free order routing for the site's own swap UI. Metered twin: /api/x402/trade. */
export async function POST(req: Request) {
  try {
    const { symbol, side, amount, trader, slippageBps } = (await req.json()) as {
      symbol: string;
      side: Side;
      amount: number;
      trader: string;
      slippageBps?: number;
    };
    if (!symbol || !side || !amount || !trader || !isAddr(trader))
      return NextResponse.json({ error: "symbol, side, amount, trader required" }, { status: 400 });

    const order = await buildOrder({
      symbol,
      side,
      amount: Number(amount),
      trader: trader as `0x${string}`,
      slippageBps,
    });
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "order failed" }, { status: 400 });
  }
}
