import { getAddress } from "viem";
import { ADDR, FEE_TIERS, STOCK_DECIMALS, USDG_DECIMALS } from "./chain";
import { v3FactoryAbi, v3PoolAbi } from "./abi";
import { rpc } from "./rpc";
import { STOCKS, type Stock } from "./stocks";

export type Pool = {
  address: `0x${string}`;
  fee: number;
  /** True when USDG sorts first in the pair — decides which way to invert price. */
  usdgIsToken0: boolean;
  sqrtPriceX96: bigint;
  liquidity: bigint;
};

export type Quote = {
  stock: Stock;
  pool: Pool;
  /** Spot price in USDG per whole share. */
  price: number;
  /** Depth proxy: USDG-equivalent notional sitting in the active tick. */
  depthUsdg: number;
};

const Q96 = 2 ** 96;

/**
 * Spot price of the stock token denominated in USDG.
 *
 * Uniswap's sqrtPriceX96 encodes token1-per-token0 in *raw* units, so both the
 * 12-decimal gap between USDG (6) and stock tokens (18) and the token ordering
 * have to be unwound before the number means dollars.
 */
export function priceFromSqrt(sqrtPriceX96: bigint, usdgIsToken0: boolean): number {
  const r = Number(sqrtPriceX96) / Q96;
  const raw = r * r; // token1 per token0, raw units
  const shift = 10 ** (USDG_DECIMALS - STOCK_DECIMALS);
  // usdgIsToken0: raw is stock-per-USDG -> invert after the decimal shift.
  return usdgIsToken0 ? 1 / (raw * shift) : raw / shift;
}

/** Pick the deepest USDG pool for a token, probing fee tiers most-liquid-first. */
export async function findPool(token: `0x${string}`): Promise<Pool | null> {
  const usdg = getAddress(ADDR.usdg);
  const t = getAddress(token);

  const addresses = await Promise.all(
    FEE_TIERS.map((fee) =>
      rpc
        .readContract({
          address: ADDR.v3Factory,
          abi: v3FactoryAbi,
          functionName: "getPool",
          args: [t, usdg, fee],
        })
        .catch(() => "0x0000000000000000000000000000000000000000" as `0x${string}`)
    )
  );

  const live = addresses
    .map((address, i) => ({ address, fee: FEE_TIERS[i] }))
    .filter((p) => p.address !== "0x0000000000000000000000000000000000000000");
  if (!live.length) return null;

  const states = await Promise.all(
    live.map(async (p): Promise<Pool | null> => {
      try {
        const [slot0, liquidity] = await Promise.all([
          rpc.readContract({ address: p.address, abi: v3PoolAbi, functionName: "slot0" }),
          rpc.readContract({ address: p.address, abi: v3PoolAbi, functionName: "liquidity" }),
        ]);
        return {
          address: p.address,
          fee: p.fee,
          usdgIsToken0: usdg.toLowerCase() < t.toLowerCase(),
          sqrtPriceX96: slot0[0] as bigint,
          liquidity: liquidity as bigint,
        } satisfies Pool;
      } catch {
        return null;
      }
    })
  );

  const usable = states.filter(
    (s): s is Pool => s !== null && s.liquidity > 0n && s.sqrtPriceX96 > 0n
  );
  if (!usable.length) return null;
  return usable.sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))[0];
}

/**
 * Estimated output for a swap, using constant-product behaviour across the
 * active tick. Exact within a tick; sizes large enough to cross ticks will get
 * slightly more than quoted, never less — so slippage guards stay safe.
 */
export function estimateOut(
  pool: Pool,
  amountIn: number,
  direction: "usdg->stock" | "stock->usdg"
): { out: number; priceImpactPct: number; price: number } {
  const price = priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0);
  const feeMul = 1 - pool.fee / 1_000_000;
  const inAfterFee = amountIn * feeMul;

  // Virtual reserves from L and sqrtP: x = L/sqrtP (token0), y = L*sqrtP (token1).
  const L = Number(pool.liquidity);
  const sp = Number(pool.sqrtPriceX96) / Q96;
  const x0 = L / sp; // raw token0
  const y0 = L * sp; // raw token1

  const d0 = pool.usdgIsToken0 ? USDG_DECIMALS : STOCK_DECIMALS;
  const d1 = pool.usdgIsToken0 ? STOCK_DECIMALS : USDG_DECIMALS;
  const usdgReserve = (pool.usdgIsToken0 ? x0 : y0) / 10 ** (pool.usdgIsToken0 ? d0 : d1);
  const stockReserve = (pool.usdgIsToken0 ? y0 : x0) / 10 ** (pool.usdgIsToken0 ? d1 : d0);

  const [rIn, rOut] =
    direction === "usdg->stock" ? [usdgReserve, stockReserve] : [stockReserve, usdgReserve];
  const out = (rOut * inAfterFee) / (rIn + inAfterFee);

  const spot = direction === "usdg->stock" ? amountIn / price : amountIn * price;
  const priceImpactPct = spot > 0 ? Math.max(0, (1 - out / spot) * 100) : 0;
  return { out, priceImpactPct, price };
}

/** USDG-side depth of a pool — used to rank which tickers are actually tradable. */
export function poolDepthUsdg(pool: Pool): number {
  const L = Number(pool.liquidity);
  const sp = Number(pool.sqrtPriceX96) / Q96;
  const raw = pool.usdgIsToken0 ? L / sp : L * sp;
  return raw / 10 ** USDG_DECIMALS;
}

export type MarketRow = {
  symbol: string;
  name: string;
  sector: string;
  address: `0x${string}`;
  price: number | null;
  fee: number | null;
  pool: `0x${string}` | null;
  depthUsdg: number;
};

/** Sweep every registered stock token for a live USDG pool and its spot price. */
export async function loadMarket(symbols?: string[]): Promise<MarketRow[]> {
  const list: Stock[] = symbols?.length
    ? STOCKS.filter((s) => symbols.includes(s.symbol))
    : STOCKS;

  const rows = await Promise.all(
    list.map(async (s) => {
      const pool = await findPool(s.address);
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        address: s.address,
        price: pool ? priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0) : null,
        fee: pool?.fee ?? null,
        pool: pool?.address ?? null,
        depthUsdg: pool ? poolDepthUsdg(pool) : 0,
      } satisfies MarketRow;
    })
  );

  return rows.sort((a, b) => b.depthUsdg - a.depthUsdg);
}
