/**
 * Trader state.
 *
 * Deliberately process-local: the strategy only ever needs the last few hundred
 * price samples and its own run log, and keeping that in memory means the agent
 * runs with zero external infrastructure. Swap `store` for Redis/Postgres if you
 * deploy across more than one instance — nothing else in the trader reaches for
 * state directly.
 */

export type Sample = { t: number; price: number };

export type Position = {
  symbol: string;
  /** Shares held according to the trader's own ledger. */
  qty: number;
  avgCost: number;
};

export type RunEntry = {
  id: string;
  t: number;
  symbol: string;
  action: "buy" | "sell" | "hold" | "skip" | "error";
  reason: string;
  price: number | null;
  amount?: number;
  txHash?: string;
  simulated: boolean;
};

export type Policy = {
  /** Tickers the agent is allowed to touch. */
  watchlist: string[];
  /** USDG committed per buy. */
  orderSizeUsdg: number;
  /** Hard ceiling on USDG deployed across all positions. */
  maxExposureUsdg: number;
  /** Fast/slow simple moving averages, in samples. */
  fastPeriod: number;
  slowPeriod: number;
  /** Momentum must clear this to trigger, filtering out noise-level crossings. */
  thresholdBps: number;
  /** Refuse any route whose estimated price impact exceeds this. */
  maxImpactPct: number;
  slippageBps: number;
  /** Take profit / stop loss, percent from average cost. */
  takeProfitPct: number;
  stopLossPct: number;
  /** false => propose orders but never broadcast. */
  live: boolean;
};

export const DEFAULT_POLICY: Policy = {
  watchlist: ["AAPL", "NVDA", "TSLA", "MSFT", "AMD", "COIN"],
  orderSizeUsdg: 25,
  maxExposureUsdg: 250,
  fastPeriod: 5,
  slowPeriod: 20,
  thresholdBps: 25,
  maxImpactPct: 1.5,
  slippageBps: 100,
  takeProfitPct: 8,
  stopLossPct: 4,
  live: false,
};

const MAX_SAMPLES = 500;
const MAX_LOG = 250;

type Store = {
  policy: Policy;
  history: Record<string, Sample[]>;
  positions: Record<string, Position>;
  log: RunEntry[];
  lastTick: number | null;
  ticks: number;
};

// Survives hot-reload in dev, where module identity is otherwise thrown away
// between requests and the price history would reset on every save.
const g = globalThis as unknown as { __agentosTrader?: Store };

export const store: Store =
  g.__agentosTrader ??
  (g.__agentosTrader = {
    policy: { ...DEFAULT_POLICY },
    history: {},
    positions: {},
    log: [],
    lastTick: null,
    ticks: 0,
  });

export function record(symbol: string, price: number, t = Date.now()) {
  const h = (store.history[symbol] ??= []);
  h.push({ t, price });
  if (h.length > MAX_SAMPLES) h.splice(0, h.length - MAX_SAMPLES);
}

export function pushLog(entry: Omit<RunEntry, "id" | "t"> & { t?: number }) {
  const e: RunEntry = {
    ...entry,
    t: entry.t ?? Date.now(),
    id: `${Date.now().toString(36)}-${store.log.length}-${entry.symbol}`,
  };
  store.log.unshift(e);
  if (store.log.length > MAX_LOG) store.log.length = MAX_LOG;
  return e;
}

export function exposureUsdg(): number {
  return Object.values(store.positions).reduce((n, p) => n + p.qty * p.avgCost, 0);
}

export function applyFill(symbol: string, side: "buy" | "sell", qty: number, price: number) {
  const p = (store.positions[symbol] ??= { symbol, qty: 0, avgCost: 0 });
  if (side === "buy") {
    const cost = p.qty * p.avgCost + qty * price;
    p.qty += qty;
    p.avgCost = p.qty > 0 ? cost / p.qty : 0;
  } else {
    p.qty = Math.max(0, p.qty - qty);
    if (p.qty === 0) p.avgCost = 0;
  }
  if (p.qty === 0) delete store.positions[symbol];
}
