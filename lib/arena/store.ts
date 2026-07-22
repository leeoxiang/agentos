import { kvGet, kvSet } from "../kv";
import { AGENTS } from "./agents";

export type AgentBook = {
  id: string;
  /** Free USDG in the agent's paper ledger. */
  cashUsdg: number;
  position: {
    symbol: string;
    qty: number;
    /** Fee-inclusive cost basis — what P&L is measured against. */
    avgCost: number;
    /**
     * The raw pool price paid, excluding fees.
     *
     * Risk exits measure against this, not against `avgCost`: a 1% fee tier puts
     * the basis ~100bps above mid the instant the position opens, so a stop
     * measured on `avgCost` would fire immediately on every entry regardless of
     * what the market did.
     */
    entryPrice: number;
  } | null;
  realizedPnl: number;
  /** Cumulative USDG spent on x402 market data — a real cost of doing business. */
  x402SpentUsdg: number;
  x402Calls: number;
  trades: number;
  wins: number;
  losses: number;
};

/**
 * Outcome of a real EIP-3009 verification.
 *
 *  settled  — signature valid and broadcast on-chain; USDG actually moved.
 *  verified — signature valid, nonce unused, payer solvent; not broadcast
 *             because no facilitator is armed.
 *  unfunded — signature valid and nonce unused, but the payer holds no USDG.
 *             The cryptography passed; only the transfer can't happen. The fee
 *             is charged to the paper book so the meter still costs the agent
 *             something.
 *  rejected — the payment itself was invalid: forged signature, replayed nonce,
 *             wrong recipient, or no receiver configured. This blocks the agent.
 */
export type X402Receipt = {
  priceUsdg: number;
  status: "settled" | "verified" | "unfunded" | "rejected";
  reason?: string;
  nonce: string;
  payer: string;
  txHash?: string;
};

export type FeedEntry = {
  id: string;
  t: number;
  round: number;
  agentId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  conviction: number;
  rationale: string;
  thought: string;
  price: number;
  qty: number;
  notional: number;
  readout: Record<string, number>;
  x402: X402Receipt;
  /** Set when the fill was placed on-chain rather than only on the paper book. */
  txHash?: string;
  /** True when the ticker trades thinly — surfaced rather than hidden. */
  thin?: boolean;
};

export type ArenaState = {
  round: number;
  startedAt: number;
  lastTickAt: number | null;
  books: Record<string, AgentBook>;
  feed: FeedEntry[];
  /** Rounds in a row where the market produced no price change anywhere. */
  flatRounds: number;
  /**
   * Equity per agent, sampled once per round.
   *
   * A leaderboard shows who is ahead; the curve shows how they got there, which
   * is the part that makes a strategy legible. Stored as a flat series rather
   * than derived from the feed because the feed is capped and would truncate the
   * history out from under the chart.
   */
  curve: EquityPoint[];
};

export type EquityPoint = { t: number; round: number; equity: Record<string, number> };

export const STARTING_BANKROLL = 1_000;
const MAX_FEED = 120;
const MAX_CURVE = 240;
const KEY = "agentos:arena:v1";

export function freshState(): ArenaState {
  return {
    round: 0,
    startedAt: Date.now(),
    lastTickAt: null,
    books: Object.fromEntries(
      AGENTS.map((a) => [
        a.id,
        {
          id: a.id,
          cashUsdg: STARTING_BANKROLL,
          position: null,
          realizedPnl: 0,
          x402SpentUsdg: 0,
          x402Calls: 0,
          trades: 0,
          wins: 0,
          losses: 0,
        } satisfies AgentBook,
      ])
    ),
    feed: [],
    flatRounds: 0,
    curve: [],
  };
}

export async function loadState(): Promise<ArenaState> {
  const stored = await kvGet<ArenaState>(KEY);
  if (!stored) return freshState();

  // Tolerate an agent roster that changed since the state was written — a new
  // competitor should join at the starting bankroll rather than crash the tick.
  const base = freshState();
  return {
    ...base,
    ...stored,
    books: { ...base.books, ...stored.books },
    feed: (stored.feed ?? []).slice(0, MAX_FEED),
    flatRounds: stored.flatRounds ?? 0,
    curve: (stored.curve ?? []).slice(-MAX_CURVE),
  };
}

export async function saveState(state: ArenaState): Promise<boolean> {
  state.feed = state.feed.slice(0, MAX_FEED);
  state.curve = state.curve.slice(-MAX_CURVE);
  return kvSet(KEY, state);
}

export async function resetState(): Promise<ArenaState> {
  const state = freshState();
  await saveState(state);
  return state;
}

/** Book value = idle cash plus the position marked to the live pool price. */
export function equity(book: AgentBook, marks: Record<string, number>): number {
  const held = book.position ? book.position.qty * (marks[book.position.symbol] ?? book.position.avgCost) : 0;
  return book.cashUsdg + held;
}
