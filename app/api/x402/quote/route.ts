import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/x402/catalog";
import { requirePayment, withReceipt } from "@/lib/x402/server";
import { findPool, poolDepthUsdg, priceFromSqrt } from "@/lib/market";
import { resolveStock } from "@/lib/order";
import { rpc } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "AAPL";

  const gate = await requirePayment(req, CATALOG.quote);
  if (!gate.paid) return gate.response;

  try {
    const stock = resolveStock(symbol);
    const pool = await findPool(stock.address);
    if (!pool) return NextResponse.json({ error: `no USDG pool for ${stock.symbol}` }, { status: 404 });

    const block = await rpc.getBlockNumber();
    return withReceipt(
      {
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        token: stock.address,
        price: priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0),
        quote: "USDG",
        pool: pool.address,
        fee: pool.fee,
        depthUsdg: poolDepthUsdg(pool),
        block: block.toString(),
        paidBy: gate.payer,
      },
      gate
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "quote failed" }, { status: 400 });
  }
}
