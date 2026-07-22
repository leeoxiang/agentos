import { kvGet, kvSet } from "../kv";
import { AGENTS } from "./agents";
import type { TapeMode } from "./tape";

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
  /** Which tape produced this price. Simulated rows must stay labelled. */
  tape: TapeMode;
};

export type ArenaState = {
  round: number;
  startedAt: number;
  lastTickAt: number | null;
  tape: TapeMode;
  books: Record<string, AgentBook>;
  feed: FeedEntry[];
  /** Per-symbol simulated price path, persisted so the walk stays continuous. */
  simPaths: Record<string, number[]>;
  /** Rounds in a row where the live tape produced no price change anywhere. */
  flatRounds: number;
};

export const STARTING_BANKROLL = 1_000;
const MAX_FEED = 120;
const KEY = "agentos:arena:v1";

export function freshState(): ArenaState {
  return {
    round: 0,
    startedAt: Date.now(),
    lastTickAt: null,
    tape: "live",
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
    simPaths: {},
    flatRounds: 0,
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
    simPaths: stored.simPaths ?? {},
    flatRounds: stored.flatRounds ?? 0,
    tape: stored.tape ?? "live",
  };
}

export async function saveState(state: ArenaState): Promise<boolean> {
  state.feed = state.feed.slice(0, MAX_FEED);
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
