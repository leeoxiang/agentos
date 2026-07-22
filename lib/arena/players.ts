import { getAddress } from "viem";
import { kvGet, kvSet } from "../kv";
import { STARTING_BANKROLL } from "./store";

/**
 * Human competitors.
 *
 * Anyone who connects a wallet gets the same 1,000 USDG paper book the agents
 * play with, marked to the same real prices, and a slot on the same leaderboard.
 * Stored separately from the agent books so a roster change or an arena reset
 * can't wipe someone's run, and keyed by checksummed address so the same wallet
 * always resolves to the same player.
 */

export type Player = {
  address: string;
  joinedAt: number;
  cashUsdg: number;
  position: { symbol: string; qty: number; avgCost: number } | null;
  realizedPnl: number;
  trades: number;
  wins: number;
  losses: number;
  lastTradeAt: number | null;
};

export type PlayerBook = Record<string, Player>;

const KEY = "agentos:arena:players:v1";
/** Bounded so one busy day can't grow the blob past what KV will serve. */
const MAX_PLAYERS = 500;

export async function loadPlayers(): Promise<PlayerBook> {
  return (await kvGet<PlayerBook>(KEY)) ?? {};
}

export async function savePlayers(players: PlayerBook): Promise<boolean> {
  const entries = Object.entries(players);
  if (entries.length > MAX_PLAYERS) {
    // Evict the least recently active, never the most recent joiner — a new
    // player being dropped the moment they arrive is the worst possible outcome.
    const kept = entries
      .sort((a, b) => (b[1].lastTradeAt ?? b[1].joinedAt) - (a[1].lastTradeAt ?? a[1].joinedAt))
      .slice(0, MAX_PLAYERS);
    players = Object.fromEntries(kept);
  }
  return kvSet(KEY, players);
}

export function normalise(address: string): string {
  return getAddress(address);
}

export function freshPlayer(address: string): Player {
  return {
    address: normalise(address),
    joinedAt: Date.now(),
    cashUsdg: STARTING_BANKROLL,
    position: null,
    realizedPnl: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    lastTradeAt: null,
  };
}

/** Book value: idle cash plus the position marked to the live pool price. */
export function playerEquity(p: Player, marks: Record<string, number>): number {
  const held = p.position
    ? p.position.qty * (marks[p.position.symbol] ?? p.position.avgCost)
    : 0;
  return p.cashUsdg + held;
}

/**
 * Apply a trade to a player's book at the live price, charging the pool's real
 * fee. Identical accounting to the agents' — the leaderboard is only meaningful
 * if everyone is scored the same way.
 */
export function applyTrade(
  player: Player,
  side: "buy" | "sell",
  symbol: string,
  amount: number,
  price: number,
  feeTier: number
): { ok: true; qty: number; notional: number; realized: number } | { ok: false; error: string } {
  const feeMul = feeTier / 1_000_000;

  if (side === "buy") {
    if (player.position && player.position.symbol !== symbol)
      return { ok: false, error: `Already holding ${player.position.symbol}. Sell it first.` };
    if (amount > player.cashUsdg)
      return { ok: false, error: `Only ${player.cashUsdg.toFixed(2)} USDG available.` };
    if (amount < 1) return { ok: false, error: "Minimum trade is 1 USDG." };

    const qty = (amount * (1 - feeMul)) / price;
    const prev = player.position;
    const newQty = (prev?.qty ?? 0) + qty;
    player.position = {
      symbol,
      qty: newQty,
      avgCost: ((prev?.qty ?? 0) * (prev?.avgCost ?? 0) + amount) / newQty,
    };
    player.cashUsdg -= amount;
    player.trades += 1;
    player.lastTradeAt = Date.now();
    return { ok: true, qty, notional: amount, realized: 0 };
  }

  if (!player.position || player.position.symbol !== symbol)
    return { ok: false, error: `No ${symbol} position to sell.` };

  const { qty, avgCost } = player.position;
  const proceeds = qty * price * (1 - feeMul);
  const realized = proceeds - qty * avgCost;
  player.cashUsdg += proceeds;
  player.realizedPnl += realized;
  player.position = null;
  player.trades += 1;
  player.lastTradeAt = Date.now();
  if (realized >= 0) player.wins += 1;
  else player.losses += 1;

  return { ok: true, qty, notional: proceeds, realized };
}
