import { NextResponse } from "next/server";
import { loadMarket } from "@/lib/market";
import { rpc } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Free market feed powering the site's own UI. The metered twin is /api/x402/screen. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols");
  const symbols = raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined;

  try {
    const [rows, block] = await Promise.all([loadMarket(symbols), rpc.getBlockNumber()]);
    return NextResponse.json(
      { rows, block: block.toString(), tradable: rows.filter((r) => r.price !== null).length },
      { headers: { "Cache-Control": "s-maxage=10, stale-while-revalidate=30" } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "market read failed" }, { status: 500 });
  }
}
