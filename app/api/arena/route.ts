import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/arena/agents";
import { equity, markPositions, resolveUniverse, universeVolumes } from "@/lib/arena/engine";
import { loadState, resetState, STARTING_BANKROLL } from "@/lib/arena/store";
import { getNews } from "@/lib/arena/news";
import { loadPlayers, playerEquity } from "@/lib/arena/players";
import { liveTrading } from "@/lib/arena/engine";
import { agentAddresses, usingDefaultSeed } from "@/lib/arena/wallets";
import { isDurable } from "@/lib/kv";
import { facilitatorAccount } from "@/lib/x402/facilitator";
import { PAY_TO } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const state = await loadState();
  const marks = await markPositions(state);
  const addresses = agentAddresses();
  const universe = await resolveUniverse();
  // Cached hard, so this is a read of whatever the last round fetched.
  const news = await getNews(universe);

  const leaderboard = AGENTS.map((def) => {
    const book = state.books[def.id];
    const eq = equity(book, marks);
    const unrealized = book.position
      ? book.position.qty * ((marks[book.position.symbol] ?? book.position.avgCost) - book.position.avgCost)
      : 0;
    return {
      id: def.id,
      name: def.name,
      handle: def.handle,
      color: def.color,
      style: def.style,
      thesis: def.thesis,
      address: addresses[def.id],
      cashUsdg: book.cashUsdg,
      position: book.position
        ? { ...book.position, mark: marks[book.position.symbol] ?? null }
        : null,
      equity: eq,
      pnl: eq - STARTING_BANKROLL,
      pnlPct: ((eq - STARTING_BANKROLL) / STARTING_BANKROLL) * 100,
      realizedPnl: book.realizedPnl,
      unrealizedPnl: unrealized,
      x402SpentUsdg: book.x402SpentUsdg,
      x402Calls: book.x402Calls,
      trades: book.trades,
      wins: book.wins,
      losses: book.losses,
    };
  }).sort((a, b) => b.equity - a.equity);

  // Humans are ranked on exactly the same marks as the agents.
  const playerBook = await loadPlayers();
  const players = Object.values(playerBook)
    .map((p) => {
      const eq = playerEquity(p, marks);
      return {
        address: p.address,
        equity: eq,
        pnl: eq - STARTING_BANKROLL,
        pnlPct: ((eq - STARTING_BANKROLL) / STARTING_BANKROLL) * 100,
        position: p.position,
        trades: p.trades,
        wins: p.wins,
        losses: p.losses,
        joinedAt: p.joinedAt,
      };
    })
    .sort((a, b) => b.equity - a.equity);

  return NextResponse.json({
    round: state.round,
    players,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    flatRounds: state.flatRounds,
    startingBankroll: STARTING_BANKROLL,
    universe,
    universeVolumes: universeVolumes(),
    news,
    leaderboard,
    feed: state.feed.slice(0, 60),
    curve: state.curve.slice(-120),
    marks,
    config: {
      // Surfaced so the UI can state exactly which parts are live rather than
      // letting the viewer assume more than is configured.
      durableState: isDurable(),
      receiverConfigured: PAY_TO !== "0x0000000000000000000000000000000000000000",
      facilitatorArmed: !!facilitatorAccount(),
      commentaryEnabled: !!process.env.ANTHROPIC_API_KEY,
      defaultSeed: usingDefaultSeed(),
      liveTrading: liveTrading(),
    },
  });
}

export async function DELETE() {
  const state = await resetState();
  return NextResponse.json({ reset: true, round: state.round });
}
