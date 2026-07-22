import { STOCK_DECIMALS, USDG_DECIMALS } from "./chain";
import { v3PoolAbi } from "./abi";
import { rpc } from "./rpc";
import type { Pool } from "./market";

/**
 * Price history from the pool's own TWAP oracle.
 *
 * Uniswap V3 pools record tick cumulatives in a ring buffer, so the last N
 * observations *are* the price history — there is nothing to store and nothing
 * to warm up. A strategy reading this works identically on a cold serverless
 * invocation and on a long-lived process, which is the whole reason the trading
 * agents don't depend on a database.
 */

export type Candle = { t: number; price: number };

/**
 * Convert an average tick over a window into a USDG price.
 *
 * price(token1/token0) = 1.0001^tick in raw units; the same decimal shift and
 * token-ordering unwind as `priceFromSqrt` then applies.
 */
export function priceFromTick(tick: number, usdgIsToken0: boolean): number {
  const raw = Math.pow(1.0001, tick);
  const shift = 10 ** (USDG_DECIMALS - STOCK_DECIMALS);
  return usdgIsToken0 ? 1 / (raw * shift) : raw / shift;
}

/**
 * Windows to try, longest first. A pool only records an observation when it is
 * poked by a swap, so a thin ticker may hold four observations spanning minutes
 * while a busy one reaches back an hour. Asking past the oldest observation
 * reverts the whole call ("OLD"), so walk down until one fits.
 */
const LADDER: Array<{ count: number; step: number }> = [
  { count: 30, step: 120 }, // ~1h
  { count: 30, step: 40 }, // ~20m
  { count: 24, step: 15 }, // ~6m
  { count: 20, step: 6 }, // ~2m
  { count: 16, step: 2 }, // ~30s
  { count: 10, step: 1 }, // ~10s
];

/**
 * Real price history for a pool, as far back as its oracle actually reaches.
 *
 * Returns the longest window the ring buffer can serve. An empty result means
 * the pool has effectively no history — callers should fall back to spot rather
 * than treat it as a flat series.
 */
export async function priceHistory(pool: Pool): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);

  for (const { count, step } of LADDER) {
    // observe() takes secondsAgo descending — oldest first.
    const secondsAgos = Array.from({ length: count }, (_, i) => (count - 1 - i) * step);

    try {
      const [tickCumulatives] = (await rpc.readContract({
        address: pool.address,
        abi: v3PoolAbi,
        functionName: "observe",
        args: [secondsAgos],
      })) as [readonly bigint[], readonly bigint[]];

      const out: Candle[] = [];
      for (let i = 1; i < tickCumulatives.length; i++) {
        const dt = secondsAgos[i - 1] - secondsAgos[i]; // == step
        const avgTick = Number(tickCumulatives[i] - tickCumulatives[i - 1]) / dt;
        out.push({
          t: (now - secondsAgos[i]) * 1000,
          price: priceFromTick(avgTick, pool.usdgIsToken0),
        });
      }
      if (out.length > 1) return out;
    } catch {
      // Ring buffer doesn't reach that far — tighten the window and retry.
    }
  }

  return [];
}

/** Simple moving average over the tail of a series. */
export function sma(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  return candles.slice(-period).reduce((n, c) => n + c.price, 0) / period;
}

/** Population standard deviation of returns, as a percentage. */
export function volatilityPct(candles: Candle[]): number {
  if (candles.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].price;
    if (prev > 0) returns.push((candles[i].price - prev) / prev);
  }
  if (!returns.length) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/** Where the latest price sits inside the window's range, 0..1. */
export function rangePosition(candles: Candle[]): number {
  if (candles.length < 2) return 0.5;
  const prices = candles.map((c) => c.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if (hi === lo) return 0.5;
  return (prices[prices.length - 1] - lo) / (hi - lo);
}

/** Percent change across the window. */
export function changePct(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0].price;
  const last = candles[candles.length - 1].price;
  return first > 0 ? ((last - first) / first) * 100 : 0;
}
