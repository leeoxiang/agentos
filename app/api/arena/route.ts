import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/arena/agents";
import { equity, markPositions, resolveUniverse, universeVolumes } from "@/lib/arena/engine";
import { loadState, resetState, saveState, STARTING_BANKROLL } from "@/lib/arena/store";
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

  return NextResponse.json({
    round: state.round,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    tape: state.tape,
    flatRounds: state.flatRounds,
    startingBankroll: STARTING_BANKROLL,
    universe: await resolveUniverse(),
    universeVolumes: universeVolumes(),
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
    },
  });
}

/** Switch which tape the arena trades against. */
export async function POST(req: Request) {
  let body: { tape?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.tape !== "live" && body.tape !== "sim")
    return NextResponse.json({ error: "tape must be 'live' or 'sim'" }, { status: 400 });

  const state = await loadState();
  if (state.tape === body.tape) return NextResponse.json({ tape: state.tape });

  // Flatten every open position at its own cost basis before switching.
  // A position entered on one tape and marked on the other produces a P&L that
  // reflects the mode change rather than any decision the agent made — the
  // first live round after a switch would show phantom stop-losses across the
  // whole field. Returning the basis to cash keeps the books honest.
  let flattened = 0;
  for (const book of Object.values(state.books)) {
    if (!book.position) continue;
    book.cashUsdg += book.position.qty * book.position.avgCost;
    book.position = null;
    flattened += 1;
  }

  state.tape = body.tape;
  state.flatRounds = 0;
  await saveState(state);
  return NextResponse.json({ tape: state.tape, flattened });
}

export async function DELETE() {
  const state = await resetState();
  return NextResponse.json({ reset: true, round: state.round });
}
