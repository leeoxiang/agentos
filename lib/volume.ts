import { parseAbiItem } from "viem";
import { ADDR, USDG_DECIMALS } from "./chain";
import { rpc } from "./rpc";
import { priceFromSqrt, type Pool } from "./market";
import type { Candle } from "./twap";

/**
 * Market data reconstructed from actual trades.
 *
 * The obvious source — the pool's TWAP oracle — is unusable on exactly the pools
 * that matter here: Uniswap V3 pools ship with `observationCardinality = 1`
 * unless somebody pays to grow the ring buffer, and nobody has on Robinhood
 * Chain. So `observe()` reverts on NVDA (877 swaps in 33 minutes) while it
 * happily returns an hour of history for AAPL, which nobody trades. History
 * where there is no volume, and no history where there is.
 *
 * `Swap` events carry `sqrtPriceX96` on every fill, so replaying them gives a
 * real, trade-by-trade price series for precisely the pools with flow — and the
 * USDG volume alongside it, which is what "does this ticker actually trade"
 * should be measured on.
 */

export const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);

/**
 * Two windows, because they answer different questions.
 *
 * Volume ranking wants a wide, stable window — whether a ticker trades at all
 * shouldn't flip because of one quiet minute. The price series wants a narrow
 * one: at ~0.1s blocks, a 15-minute window shifts by under 3% between rounds two
 * minutes apart, so every indicator reads almost identically round to round and
 * the strategies never see anything change.
 */
export const VOLUME_LOOKBACK_BLOCKS = 9_000n; // ~15 min
export const PRICE_LOOKBACK_BLOCKS = 2_400n; // ~4 min
export const DEFAULT_LOOKBACK_BLOCKS = VOLUME_LOOKBACK_BLOCKS;
const CHUNK = 1_000n;

export type PoolActivity = {
  swaps: number;
  /** Traded USDG notional over the window. The real definition of volume. */
  volumeUsdg: number;
  /** Chronological price series, one point per fill. */
  prices: Array<{ blockNumber: bigint; price: number }>;
};

/**
 * Scan Swap events for a set of pools in one pass.
 *
 * Filtering by address server-side matters: an unfiltered sweep of this chain
 * returns ~68,000 events per 10k blocks, versus ~1,400 for the stock pools.
 */
export async function scanSwaps(
  pools: Pool[],
  lookbackBlocks = DEFAULT_LOOKBACK_BLOCKS
): Promise<Map<string, PoolActivity>> {
  const out = new Map<string, PoolActivity>();
  if (!pools.length) return out;

  const byAddress = new Map(pools.map((p) => [p.address.toLowerCase(), p]));
  const addresses = pools.map((p) => p.address);
  for (const p of pools)
    out.set(p.address.toLowerCase(), { swaps: 0, volumeUsdg: 0, prices: [] });

  const latest = await rpc.getBlockNumber();
  const from = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;

  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    let logs;
    try {
      logs = await rpc.getLogs({ address: addresses, event: swapEvent, fromBlock: start, toBlock: end });
    } catch {
      // A chunk the RPC refuses is a gap in history, not a failure — the series
      // is still usable, just shorter.
      continue;
    }

    for (const log of logs) {
      const key = log.address.toLowerCase();
      const pool = byAddress.get(key);
      const entry = out.get(key);
      if (!pool || !entry) continue;

      const args = log.args as {
        amount0?: bigint;
        amount1?: bigint;
        sqrtPriceX96?: bigint;
      };
      if (args.sqrtPriceX96 === undefined) continue;

      // The USDG leg is whichever side USDG sits on; sign indicates direction,
      // so take the magnitude.
      const usdgRaw = pool.usdgIsToken0 ? args.amount0 : args.amount1;
      if (usdgRaw !== undefined) {
        const abs = usdgRaw < 0n ? -usdgRaw : usdgRaw;
        entry.volumeUsdg += Number(abs) / 10 ** USDG_DECIMALS;
      }

      entry.swaps += 1;
      entry.prices.push({
        blockNumber: log.blockNumber!,
        price: priceFromSqrt(args.sqrtPriceX96, pool.usdgIsToken0),
      });
    }
  }

  // Logs arrive in block order per chunk, but chunk order isn't guaranteed
  // across a partial failure — sort so the series is strictly chronological.
  for (const entry of out.values())
    entry.prices.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));

  return out;
}

/**
 * Downsample a fill series into evenly spaced candles.
 *
 * Strategies read a fixed number of points; handing them 900 raw fills for one
 * ticker and 3 for another would make the same indicator mean different things
 * per ticker.
 */
export function toCandles(activity: PoolActivity, count = 30): Candle[] {
  const { prices } = activity;
  if (prices.length < 2) return [];

  // Timestamps are synthetic but evenly spaced and correctly ordered, which is
  // all any of the indicators use them for. Fetching real block timestamps would
  // cost one RPC call per point for no analytical gain.
  const now = Date.now();
  const spanMs = 15 * 60_000;

  if (prices.length <= count)
    return prices.map((p, i) => ({
      t: now - spanMs + (i / Math.max(1, prices.length - 1)) * spanMs,
      price: p.price,
    }));

  const bucket = prices.length / count;
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    // Close of each bucket — the last trade in the interval, like a real candle.
    const idx = Math.min(prices.length - 1, Math.floor((i + 1) * bucket) - 1);
    out.push({ t: now - spanMs + (i / (count - 1)) * spanMs, price: prices[idx].price });
  }
  return out;
}

/**
 * Minimum traded USDG over the window for a ticker to be considered tradable.
 *
 * Depth is not the same thing as volume: a pool can hold millions in liquidity
 * and never trade, which is exactly the case for most stock tokens here. An
 * agent needs a counterparty, not a balance sheet.
 */
export const MIN_VOLUME_USDG = 1_000;
