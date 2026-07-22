import { NextResponse } from "next/server";
import { isAddr } from "@/lib/addr";
import { findPool, priceFromSqrt } from "@/lib/market";
import { resolveStock } from "@/lib/order";
import { resolveUniverse } from "@/lib/arena/engine";
import {
  applyTrade,
  freshPlayer,
  loadPlayers,
  normalise,
  savePlayers,
} from "@/lib/arena/players";
import { guard } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Human players: join the arena, and trade against the agents.
 *
 * Everything is a paper book marked to live pool prices — no signature is
 * requested and nothing is ever spent, so connecting a wallet here is a read of
 * your address and nothing more. That is a deliberate limit: asking a stranger
 * to sign something to play a leaderboard game trains exactly the wrong habit.
 */

export async function POST(req: Request) {
  const limited = await guard(req, "play");
  if (limited) return limited;

  let body: { action?: string; address?: string; symbol?: string; side?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { address } = body;
  if (!address || !isAddr(address))
    return NextResponse.json({ error: "a wallet address is required" }, { status: 400 });

  const key = normalise(address);
  const players = await loadPlayers();

  // --- join ---------------------------------------------------------------
  if (body.action === "join") {
    if (!players[key]) {
      players[key] = freshPlayer(key);
      await savePlayers(players);
    }
    return NextResponse.json({ player: players[key], joined: true });
  }

  // --- trade --------------------------------------------------------------
  if (body.action === "trade") {
    const player = players[key];
    if (!player)
      return NextResponse.json({ error: "join the arena first" }, { status: 400 });

    const { symbol, side, amount } = body;
    if (!symbol || (side !== "buy" && side !== "sell") || !amount || amount <= 0)
      return NextResponse.json(
        { error: "symbol, side (buy|sell) and a positive amount are required" },
        { status: 400 }
      );

    // Only tickers the agents themselves are allowed to trade — the universe is
    // volume-ranked, so this also stops a player picking something untradable.
    const universe = await resolveUniverse();
    if (!universe.includes(symbol.toUpperCase()))
      return NextResponse.json(
        { error: `${symbol} is not in the current universe (${universe.join(", ")})` },
        { status: 400 }
      );

    try {
      const stock = resolveStock(symbol);
      const pool = await findPool(stock.address);
      if (!pool) return NextResponse.json({ error: `no pool for ${symbol}` }, { status: 400 });

      const price = priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0);
      const result = applyTrade(player, side, stock.symbol, Number(amount), price, pool.fee);

      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

      await savePlayers(players);
      return NextResponse.json({
        player,
        fill: { ...result, price, symbol: stock.symbol, side },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "trade failed" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "action must be 'join' or 'trade'" }, { status: 400 });
}
