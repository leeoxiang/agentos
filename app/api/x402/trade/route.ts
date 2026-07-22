import { NextResponse } from "next/server";
import { isAddr } from "@/lib/addr";
import { CATALOG } from "@/lib/x402/catalog";
import { requirePayment, withReceipt } from "@/lib/x402/server";
import { buildOrder, type Side } from "@/lib/order";

export const dynamic = "force-dynamic";

/**
 * The paid endpoint an agent calls to buy stock.
 *
 * It sells routing, not custody: settle 0.02 USDG over x402 and get back
 * SwapRouter02 calldata plus a slippage-bounded minimum out, ready to submit
 * from the agent's own wallet.
 */
export async function POST(req: Request) {
  let body: { symbol?: string; side?: Side; amount?: number; trader?: string; slippageBps?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { symbol, side, amount, trader, slippageBps } = body;
  if (!symbol || !side || !amount || !trader)
    return NextResponse.json(
      { error: "symbol, side, amount and trader are required" },
      { status: 400 }
    );
  if (side !== "buy" && side !== "sell")
    return NextResponse.json({ error: "side must be buy or sell" }, { status: 400 });
  if (!isAddr(trader))
    return NextResponse.json({ error: "trader must be an address" }, { status: 400 });

  const gate = await requirePayment(req, CATALOG.trade);
  if (!gate.paid) return gate.response;

  try {
    const order = await buildOrder({
      symbol,
      side,
      amount: Number(amount),
      trader: trader as `0x${string}`,
      slippageBps,
    });
    return withReceipt({ order, paidBy: gate.payer }, gate);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "order build failed" },
      { status: 400 }
    );
  }
}
