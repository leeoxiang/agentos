import { createWalletClient, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STOCK_DECIMALS, USDG_DECIMALS, robinhood } from "../chain";
import { buildOrder } from "../order";
import { findPool, priceFromSqrt } from "../market";
import { priceHistory } from "../twap";
import { rpc } from "../rpc";
import { STOCKS } from "../stocks";
import { applyFill, pushLog, record, seedHistory, store, type RunEntry } from "./store";
import { evaluate, type Signal } from "./strategy";

/** The agent's own signer. Absent key => the trader can only ever propose. */
export function traderAccount() {
  const key = process.env.TRADER_PRIVATE_KEY?.trim();
  if (!key) return null;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

export type TickResult = {
  t: number;
  tick: number;
  live: boolean;
  trader: `0x${string}` | null;
  signals: Signal[];
  entries: RunEntry[];
};

/**
 * One pass of the strategy loop: sample prices, evaluate, act.
 *
 * Every action runs through the same `buildOrder` path the paid x402 endpoint
 * serves, so a simulated fill and a live fill differ only in whether the
 * transaction is broadcast — the routing, slippage guard and impact check are
 * identical.
 */
export async function tick(): Promise<TickResult> {
  const policy = store.policy;
  const account = traderAccount();
  const live = policy.live && !!account;
  const signals: Signal[] = [];
  const entries: RunEntry[] = [];

  for (const symbol of policy.watchlist) {
    try {
      const pool = await findPool(resolveAddress(symbol));
      if (!pool) {
        entries.push(
          pushLog({ symbol, action: "skip", reason: "no USDG pool", price: null, simulated: !live })
        );
        continue;
      }
      const price = priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0);
      // Seed from the pool's TWAP oracle so the strategy has real history on the
      // very first tick, then append live spot on top of it.
      seedHistory(symbol, await priceHistory(pool));
      record(symbol, price);

      const signal = evaluate(symbol, policy);
      signals.push(signal);

      if (signal.action === "hold") {
        entries.push(
          pushLog({ symbol, action: "hold", reason: signal.reason, price, simulated: !live })
        );
        continue;
      }

      const trader = account?.address ?? PROPOSAL_ADDRESS;
      const order = await buildOrder({
        symbol,
        side: signal.action,
        amount: signal.amount,
        trader,
        slippageBps: policy.slippageBps,
      });

      if (order.priceImpactPct > policy.maxImpactPct) {
        entries.push(
          pushLog({
            symbol,
            action: "skip",
            reason: `price impact ${order.priceImpactPct.toFixed(2)}% over ${policy.maxImpactPct}% limit`,
            price,
            simulated: !live,
          })
        );
        continue;
      }

      if (!live) {
        const qty = signal.action === "buy" ? order.expectedOut : signal.amount;
        applyFill(symbol, signal.action, qty, price);
        entries.push(
          pushLog({
            symbol,
            action: signal.action,
            reason: `${signal.reason} — simulated, ${order.priceImpactPct.toFixed(2)}% impact`,
            price,
            amount: signal.amount,
            simulated: true,
          })
        );
        continue;
      }

      const wallet = createWalletClient({ account: account!, chain: robinhood, transport: http() });

      if (order.approval) {
        const approveHash = await wallet.sendTransaction({
          to: order.approval.to,
          data: order.approval.data,
        });
        await rpc.waitForTransactionReceipt({ hash: approveHash, timeout: 90_000 });
      }

      const hash = await wallet.sendTransaction({ to: order.to, data: order.data });
      const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 90_000 });

      if (receipt.status !== "success") {
        entries.push(
          pushLog({
            symbol,
            action: "error",
            reason: "swap reverted on-chain",
            price,
            txHash: hash,
            simulated: false,
          })
        );
        continue;
      }

      const qty = signal.action === "buy" ? order.expectedOut : signal.amount;
      applyFill(symbol, signal.action, qty, price);
      entries.push(
        pushLog({
          symbol,
          action: signal.action,
          reason: signal.reason,
          price,
          amount: signal.amount,
          txHash: hash,
          simulated: false,
        })
      );
    } catch (e) {
      entries.push(
        pushLog({
          symbol,
          action: "error",
          reason: e instanceof Error ? e.message : "tick failed",
          price: null,
          simulated: !live,
        })
      );
    }
  }

  store.lastTick = Date.now();
  store.ticks += 1;
  return { t: store.lastTick, tick: store.ticks, live, trader: account?.address ?? null, signals, entries };
}

/**
 * Stand-in recipient used when routing a proposal with no signer configured.
 * Calldata built for it is never broadcast — it exists so dry runs still
 * exercise the real encoder rather than a parallel mock.
 */
const PROPOSAL_ADDRESS = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;

function resolveAddress(symbol: string): `0x${string}` {
  const s = STOCKS.find((x) => x.symbol === symbol);
  if (!s) throw new Error(`unknown ticker: ${symbol}`);
  return s.address;
}

/** Mark positions to the live market for the trader dashboard. */
export async function markToMarket() {
  const rows = await Promise.all(
    Object.values(store.positions).map(async (p) => {
      const pool = await findPool(resolveAddress(p.symbol)).catch(() => null);
      const price = pool ? priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0) : null;
      const value = price ? p.qty * price : null;
      const cost = p.qty * p.avgCost;
      return {
        ...p,
        price,
        value,
        cost,
        pnl: value !== null ? value - cost : null,
        pnlPct: value !== null && cost > 0 ? ((value - cost) / cost) * 100 : null,
      };
    })
  );
  return rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

export const fmtUsdg = (n: bigint) => Number(formatUnits(n, USDG_DECIMALS));
export const fmtShares = (n: bigint) => Number(formatUnits(n, STOCK_DECIMALS));
