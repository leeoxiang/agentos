import { encodeFunctionData, getAddress, parseUnits } from "viem";
import { ADDR, STOCK_DECIMALS, USDG_DECIMALS } from "./chain";
import { erc20Abi, swapRouterAbi } from "./abi";
import { estimateOut, findPool, priceFromSqrt } from "./market";
import { rpc } from "./rpc";
import { STOCKS } from "./stocks";

export type Side = "buy" | "sell";

export type BuiltOrder = {
  symbol: string;
  side: Side;
  /** Router call the caller submits from its own wallet. */
  to: `0x${string}`;
  data: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountInHuman: number;
  expectedOut: number;
  minOut: string;
  price: number;
  fee: number;
  pool: `0x${string}`;
  priceImpactPct: number;
  slippageBps: number;
  /** Present when the router still needs an ERC-20 allowance from the trader. */
  approval: { to: `0x${string}`; data: `0x${string}`; current: string } | null;
};

export function resolveStock(symbol: string) {
  const s = STOCKS.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
  if (!s) throw new Error(`unknown ticker: ${symbol}`);
  return s;
}

/**
 * Route an order through the deepest USDG pool and return submit-ready calldata.
 *
 * The caller signs and sends it themselves — AgentOS never custodies funds, so
 * a compromised server can at worst hand back a bad route, and `minOut` bounds
 * even that.
 */
export async function buildOrder(params: {
  symbol: string;
  side: Side;
  /** Whole USDG for a buy, whole shares for a sell. */
  amount: number;
  trader: `0x${string}`;
  slippageBps?: number;
  deadlineSeconds?: number;
}): Promise<BuiltOrder> {
  const { symbol, side, amount, trader } = params;
  const slippageBps = params.slippageBps ?? 100; // 1%
  if (!(amount > 0)) throw new Error("amount must be positive");
  if (slippageBps < 1 || slippageBps > 5_000) throw new Error("slippageBps out of range");

  const stock = resolveStock(symbol);
  const pool = await findPool(stock.address);
  if (!pool) throw new Error(`no USDG pool for ${stock.symbol}`);

  const tokenIn = side === "buy" ? ADDR.usdg : stock.address;
  const tokenOut = side === "buy" ? stock.address : ADDR.usdg;
  const decIn = side === "buy" ? USDG_DECIMALS : STOCK_DECIMALS;
  const decOut = side === "buy" ? STOCK_DECIMALS : USDG_DECIMALS;

  const { out, priceImpactPct } = estimateOut(
    pool,
    amount,
    side === "buy" ? "usdg->stock" : "stock->usdg"
  );
  const price = priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0);

  const amountIn = parseUnits(trim(amount, decIn), decIn);
  const minOutRaw = parseUnits(trim(out, decOut), decOut);
  const minOut = (minOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;

  const data = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: getAddress(tokenIn),
        tokenOut: getAddress(tokenOut),
        fee: pool.fee,
        recipient: getAddress(trader),
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  // Allowance is checked, not assumed: a stale approval is the single most
  // common reason an otherwise-correct agent trade reverts.
  let approval: BuiltOrder["approval"] = null;
  try {
    const current = (await rpc.readContract({
      address: getAddress(tokenIn),
      abi: erc20Abi,
      functionName: "allowance",
      args: [getAddress(trader), ADDR.swapRouter],
    })) as bigint;
    if (current < amountIn) {
      approval = {
        to: getAddress(tokenIn),
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [ADDR.swapRouter, amountIn * 4n],
        }),
        current: current.toString(),
      };
    }
  } catch {
    // Unreadable allowance is not fatal — surface the approve call defensively.
    approval = {
      to: getAddress(tokenIn),
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ADDR.swapRouter, amountIn * 4n],
      }),
      current: "unknown",
    };
  }

  return {
    symbol: stock.symbol,
    side,
    to: ADDR.swapRouter,
    data,
    tokenIn: getAddress(tokenIn),
    tokenOut: getAddress(tokenOut),
    amountIn: amountIn.toString(),
    amountInHuman: amount,
    expectedOut: out,
    minOut: minOut.toString(),
    price,
    fee: pool.fee,
    pool: pool.address,
    priceImpactPct,
    slippageBps,
    approval,
  };
}

/** parseUnits rejects excess precision, so clamp to the token's decimals first. */
function trim(n: number, decimals: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const s = n.toFixed(Math.min(decimals, 18));
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
