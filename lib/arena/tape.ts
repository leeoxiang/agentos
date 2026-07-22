import type { Candle } from "../twap";

/**
 * Where the arena's prices come from.
 *
 *   live — Uniswap V3 pool state and the pool's own TWAP oracle. Every number is
 *          real. The catch is that Robinhood Chain pools are frequently dormant:
 *          if no swaps land, price is genuinely flat and honest strategies
 *          correctly do nothing.
 *
 *   sim  — a simulated tape *anchored to the real current price*, so the agents
 *          have something to disagree about when the chain is quiet. Entry
 *          prices, depth, fee tiers and the x402 payments stay real; only the
 *          round-to-round price path is generated.
 *
 * The mode is carried on every feed entry and rendered in the UI. Simulated
 * results must never be presentable as live ones.
 */
export type TapeMode = "live" | "sim";

/**
 * Deterministic per (symbol, round) rather than random.
 *
 * A given round always produces the same path, so a reload doesn't rewrite
 * history and two servers reading the same state agree on what happened.
 */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // XOR in JS yields a signed int; force unsigned or the modulo below can go
  // negative and index off the front of an array.
  return h >>> 0;
}

/** Box–Muller from two hashed uniforms — a normal draw with no global RNG. */
function gauss(seed: string): number {
  const u1 = (hash32(`${seed}:a`) % 1_000_000) / 1_000_000 || 1e-6;
  const u2 = (hash32(`${seed}:b`) % 1_000_000) / 1_000_000;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Basis points of per-round volatility for the simulated tape.
 *
 * Has to clear a round trip through the pool: these tiers charge 0.3%–1.0% per
 * side, so a tape that only moves a few bps guarantees every strategy bleeds to
 * fees no matter how well it reads the market. At 45bps a good call can actually
 * pay for itself, which is what makes the leaderboard mean something.
 */
const SIM_VOL_BPS = 45;

/**
 * Advance one symbol's simulated price by a single round.
 *
 * A random walk anchored to the real spot: it drifts, but a weak pull back
 * toward the on-chain price keeps it from wandering somewhere the real market
 * never was.
 */
export function stepSim(symbol: string, round: number, prev: number, anchor: number): number {
  const shock = gauss(`${symbol}:${round}`) * (SIM_VOL_BPS / 10_000);
  const pull = (anchor - prev) / anchor / 12;
  return Math.max(prev * (1 + shock + pull), anchor * 0.5);
}

/**
 * Build a candle series from a stored simulated path so strategies see the same
 * shape of history they would get from the oracle.
 */
export function simCandles(path: number[], stepMs = 25_000): Candle[] {
  const now = Date.now();
  return path.map((price, i) => ({ t: now - (path.length - 1 - i) * stepMs, price }));
}

/** How much simulated path to keep per symbol. */
export const SIM_PATH_LEN = 30;

/**
 * Seed a fresh simulated path around the real price, so an agent's first look at
 * a symbol isn't a flat line.
 */
export function seedSimPath(symbol: string, anchor: number): number[] {
  const path = [anchor];
  for (let i = 1; i < SIM_PATH_LEN; i++) {
    path.push(stepSim(symbol, -i, path[i - 1], anchor));
  }
  return path;
}
