import { NextResponse } from "next/server";
import { DEFAULT_POLICY, store, type Policy } from "@/lib/trader/store";
import { markToMarket, traderAccount } from "@/lib/trader/engine";
import { evaluate } from "@/lib/trader/strategy";
import { STOCKS } from "@/lib/stocks";

export const dynamic = "force-dynamic";

export async function GET() {
  const account = traderAccount();
  const positions = await markToMarket();
  return NextResponse.json({
    policy: store.policy,
    armed: !!account,
    live: store.policy.live && !!account,
    trader: account?.address ?? null,
    ticks: store.ticks,
    lastTick: store.lastTick,
    positions,
    log: store.log.slice(0, 60),
    signals: store.policy.watchlist.map((s) => evaluate(s)),
    samples: Object.fromEntries(
      store.policy.watchlist.map((s) => [s, (store.history[s] ?? []).slice(-120)])
    ),
  });
}

const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  orderSizeUsdg: [0.1, 100_000],
  maxExposureUsdg: [1, 1_000_000],
  fastPeriod: [2, 100],
  slowPeriod: [3, 400],
  thresholdBps: [0, 2_000],
  maxImpactPct: [0.01, 50],
  slippageBps: [1, 5_000],
  takeProfitPct: [0.1, 500],
  stopLossPct: [0.1, 100],
};

/**
 * Update the trading policy.
 *
 * Every field is bounds-checked server-side. The UI enforces the same ranges,
 * but the UI is not the only thing that can POST here — an agent with the URL
 * must not be able to set a 100% slippage tolerance and drain itself.
 */
export async function POST(req: Request) {
  let patch: Partial<Policy>;
  try {
    patch = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const next: Policy = { ...store.policy };

  if (patch.watchlist) {
    if (!Array.isArray(patch.watchlist) || patch.watchlist.length === 0)
      return NextResponse.json({ error: "watchlist must be a non-empty array" }, { status: 400 });
    const known = new Set(STOCKS.map((s) => s.symbol));
    const cleaned = patch.watchlist.map((s) => String(s).toUpperCase().trim()).filter(Boolean);
    const unknown = cleaned.filter((s) => !known.has(s));
    if (unknown.length)
      return NextResponse.json({ error: `unknown tickers: ${unknown.join(", ")}` }, { status: 400 });
    if (cleaned.length > 20)
      return NextResponse.json({ error: "watchlist capped at 20 tickers" }, { status: 400 });
    next.watchlist = [...new Set(cleaned)];
  }

  for (const [key, [min, max]] of Object.entries(NUMERIC_BOUNDS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max)
      return NextResponse.json({ error: `${key} must be between ${min} and ${max}` }, { status: 400 });
    (next as unknown as Record<string, number>)[key] = n;
  }

  if (next.fastPeriod >= next.slowPeriod)
    return NextResponse.json({ error: "fastPeriod must be below slowPeriod" }, { status: 400 });

  if (patch.live !== undefined) {
    if (patch.live && !traderAccount())
      return NextResponse.json(
        { error: "cannot go live: TRADER_PRIVATE_KEY is not configured" },
        { status: 400 }
      );
    next.live = !!patch.live;
  }

  store.policy = next;
  return NextResponse.json({ policy: store.policy });
}

export async function DELETE() {
  store.policy = { ...DEFAULT_POLICY };
  store.history = {};
  store.positions = {};
  store.log = [];
  store.ticks = 0;
  store.lastTick = null;
  return NextResponse.json({ reset: true, policy: store.policy });
}
