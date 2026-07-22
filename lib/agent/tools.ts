import { formatUnits } from "viem";
import { isAddr } from "../addr";
import { ADDR, USDG_DECIMALS, VAULT_DECIMALS, robinhood } from "../chain";
import { erc20Abi, erc4626Abi } from "../abi";
import { rpc } from "../rpc";
import { findPool, loadMarket, poolDepthUsdg, priceFromSqrt } from "../market";
import { buildOrder, resolveStock, type Side } from "../order";
import { CATALOG_LIST } from "../x402/catalog";
import { markToMarket } from "../trader/engine";
import { store } from "../trader/store";
import { evaluate } from "../trader/strategy";

/**
 * The agent's tool surface.
 *
 * Read tools execute server-side and return immediately. The one write tool
 * (`build_order`) deliberately returns unsigned calldata rather than
 * broadcasting: the model can propose a trade, but only the user's wallet can
 * make it real.
 */
export const TOOLS = [
  {
    name: "get_portfolio",
    description:
      "Read an agent wallet's full position on Robinhood Chain: ETH for gas, USDG cash, ERC-4626 vault position, and every stock token held with live mark-to-market value.",
    input_schema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "0x address to inspect" },
      },
      required: ["account"],
    },
  },
  {
    name: "get_quote",
    description:
      "Live on-chain spot price for one Robinhood stock token, quoted in USDG, with its pool, fee tier and tradable depth.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker, e.g. AAPL or NVDA" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "screen_market",
    description:
      "Sweep the tokenized-stock market and return the most liquid tickers with live prices, ranked by USDG depth. Use when the user asks what is tradable or what looks liquid.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "integer", description: "How many rows to return (default 12, max 40)" },
        sector: { type: "string", description: "Optional sector filter, e.g. Semis, Tech, ETF" },
      },
    },
  },
  {
    name: "build_order",
    description:
      "Route a buy or sell through the deepest USDG pool and return submit-ready SwapRouter02 calldata with a slippage-guarded minimum out. This does NOT execute — the user's wallet must sign and send it. Always state the expected output and price impact when reporting the result.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["buy", "sell"] },
        amount: {
          type: "number",
          description: "USDG to spend for a buy, or number of shares to sell",
        },
        trader: { type: "string", description: "0x address that will submit the transaction" },
        slippageBps: { type: "integer", description: "Slippage tolerance in bps (default 100 = 1%)" },
      },
      required: ["symbol", "side", "amount", "trader"],
    },
  },
  {
    name: "get_yield",
    description:
      "State of the Steakhouse USDG ERC-4626 vault where idle agent cash earns: TVL, share price and realised yield. Pass an account to include its position.",
    input_schema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Optional 0x address" },
      },
    },
  },
  {
    name: "list_x402_services",
    description:
      "The metered endpoints AgentOS sells over x402, with live USDG prices. Use when the user asks what an agent can pay for.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_trader",
    description:
      "State of the autonomous trading agent: policy, whether it is armed and live, open positions with P&L, and the current signal for each watchlist ticker.",
    input_schema: { type: "object" as const, properties: {} },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_portfolio": {
      const account = String(input.account ?? "");
      if (!isAddr(account)) throw new Error("account must be a 0x address");
      const who = account as `0x${string}`;

      const [eth, usdg, shares] = await Promise.all([
        rpc.getBalance({ address: who }),
        rpc.readContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
        rpc.readContract({
          address: ADDR.yieldVault,
          abi: erc4626Abi,
          functionName: "balanceOf",
          args: [who],
        }),
      ]);
      const vaultAssets =
        (shares as bigint) > 0n
          ? ((await rpc.readContract({
              address: ADDR.yieldVault,
              abi: erc4626Abi,
              functionName: "convertToAssets",
              args: [shares as bigint],
            })) as bigint)
          : 0n;

      // Reuse the site's own balance route logic via a direct sweep so the tool
      // and the wallet page can never disagree about what is held.
      const rows = await loadMarket();
      const positions: Array<{ symbol: string; qty: number; price: number | null; valueUsdg: number | null }> = [];
      for (const row of rows) {
        const bal = (await rpc
          .readContract({ address: row.address, abi: erc20Abi, functionName: "balanceOf", args: [who] })
          .catch(() => 0n)) as bigint;
        if (bal === 0n) continue;
        const qty = Number(formatUnits(bal, 18));
        positions.push({
          symbol: row.symbol,
          qty,
          price: row.price,
          valueUsdg: row.price ? qty * row.price : null,
        });
      }
      positions.sort((a, b) => (b.valueUsdg ?? 0) - (a.valueUsdg ?? 0));

      const cash = Number(formatUnits(usdg as bigint, USDG_DECIMALS));
      const earning = Number(formatUnits(vaultAssets, USDG_DECIMALS));
      const equities = positions.reduce((n, p) => n + (p.valueUsdg ?? 0), 0);

      return {
        account: who,
        chain: robinhood.name,
        gasEth: Number(formatUnits(eth, 18)),
        cashUsdg: cash,
        vaultUsdg: earning,
        vaultShares: Number(formatUnits(shares as bigint, VAULT_DECIMALS)),
        positions,
        netWorthUsdg: cash + earning + equities,
      };
    }

    case "get_quote": {
      const stock = resolveStock(String(input.symbol ?? ""));
      const pool = await findPool(stock.address);
      if (!pool) return { symbol: stock.symbol, tradable: false, reason: "no USDG pool" };
      return {
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        token: stock.address,
        priceUsdg: priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0),
        pool: pool.address,
        feeTier: pool.fee,
        depthUsdg: poolDepthUsdg(pool),
      };
    }

    case "screen_market": {
      const limit = Math.min(Number(input.limit ?? 12) || 12, 40);
      const sector = input.sector ? String(input.sector).toLowerCase() : null;
      const rows = (await loadMarket()).filter(
        (r) => r.price !== null && (!sector || r.sector.toLowerCase() === sector)
      );
      return {
        count: rows.length,
        rows: rows.slice(0, limit).map((r) => ({
          symbol: r.symbol,
          name: r.name,
          sector: r.sector,
          priceUsdg: r.price,
          depthUsdg: Math.round(r.depthUsdg),
          feeTier: r.fee,
        })),
      };
    }

    case "build_order": {
      const trader = String(input.trader ?? "");
      if (!isAddr(trader)) throw new Error("trader must be a 0x address");
      const order = await buildOrder({
        symbol: String(input.symbol ?? ""),
        side: String(input.side) as Side,
        amount: Number(input.amount),
        trader: trader as `0x${string}`,
        slippageBps: input.slippageBps ? Number(input.slippageBps) : undefined,
      });
      return {
        ...order,
        note: "Unsigned. The user must approve and submit this from their wallet.",
      };
    }

    case "get_yield": {
      const [totalAssets, sharePrice] = await Promise.all([
        rpc.readContract({ address: ADDR.yieldVault, abi: erc4626Abi, functionName: "totalAssets" }),
        rpc.readContract({
          address: ADDR.yieldVault,
          abi: erc4626Abi,
          functionName: "convertToAssets",
          args: [10n ** BigInt(VAULT_DECIMALS)],
        }),
      ]);
      const price = Number(formatUnits(sharePrice as bigint, USDG_DECIMALS));
      const account = input.account ? String(input.account) : null;
      let position = null;
      if (account && isAddr(account)) {
        const shares = (await rpc.readContract({
          address: ADDR.yieldVault,
          abi: erc4626Abi,
          functionName: "balanceOf",
          args: [account as `0x${string}`],
        })) as bigint;
        position = {
          shares: Number(formatUnits(shares, VAULT_DECIMALS)),
          valueUsdg: Number(formatUnits(shares, VAULT_DECIMALS)) * price,
        };
      }
      return {
        vault: ADDR.yieldVault,
        symbol: "steakUSDG",
        asset: "USDG",
        tvlUsdg: Number(formatUnits(totalAssets as bigint, USDG_DECIMALS)),
        sharePrice: price,
        cumulativeYieldPct: (price - 1) * 100,
        position,
      };
    }

    case "list_x402_services":
      return {
        protocol: "x402",
        settlementAsset: "USDG",
        chain: robinhood.name,
        services: CATALOG_LIST.map((s) => ({
          id: s.id,
          path: s.path,
          priceUsdg: s.priceUsdg,
          description: s.description,
        })),
      };

    case "get_trader": {
      const positions = await markToMarket();
      return {
        policy: store.policy,
        live: store.policy.live,
        ticks: store.ticks,
        positions,
        signals: store.policy.watchlist.map((s) => {
          const sig = evaluate(s);
          return { symbol: s, action: sig.action, reason: sig.reason, price: sig.price };
        }),
        recentLog: store.log.slice(0, 10),
      };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
