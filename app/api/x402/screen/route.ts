import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/x402/catalog";
import { requirePayment, withReceipt } from "@/lib/x402/server";
import { loadMarket } from "@/lib/market";
import { rpc } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const gate = await requirePayment(req, CATALOG.screen);
  if (!gate.paid) return gate.response;

  try {
    const [rows, block] = await Promise.all([loadMarket(), rpc.getBlockNumber()]);
    const tradable = rows.filter((r) => r.price !== null);
    return withReceipt(
      {
        rows: tradable,
        count: tradable.length,
        universe: rows.length,
        block: block.toString(),
        paidBy: gate.payer,
      },
      gate
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "screen failed" }, { status: 500 });
  }
}
