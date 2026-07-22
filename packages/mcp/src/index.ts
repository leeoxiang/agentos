#!/usr/bin/env node
/**
 * @agentos/mcp — an x402 wallet for any MCP host.
 *
 * Exposes AgentOS as tools so an agent running in Claude Code, Claude Desktop,
 * Cursor or any other MCP host can read the tokenized-stock market on Robinhood
 * Chain, pay for metered data in USDG, and route trades — without a browser and
 * without the host model ever seeing a private key.
 *
 * The security posture, stated once so it isn't buried:
 *   - The key lives in this process. It is never returned by any tool.
 *   - Every payment is bounded by AGENTOS_MAX_PAYMENT_USDG before signing.
 *   - Routing an order is read-only. Broadcasting requires AGENTOS_ALLOW_SUBMIT
 *     and is separately capped by AGENTOS_MAX_TRADE_USDG.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWalletClient, createPublicClient, defineChain, http } from "viem";
import { loadConfig, type Config } from "./config.js";
import { fetchFree, fetchPaid, PaymentError } from "./x402.js";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const cfg = loadConfig();

/** Every tool returns text; structure it so the model can read it reliably. */
function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const detail = e instanceof PaymentError ? e.detail : undefined;
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message, detail }, null, 2) },
    ],
  };
}

/** Attach the payment receipt to a paid tool's output so spend is always visible. */
function withReceipt(result: { data: unknown; payment: unknown }) {
  return ok({ ...(result.data as object), _x402: result.payment });
}

const server = new McpServer(
  { name: "agentos", version: "0.1.0" },
  {
    instructions:
      "AgentOS gives you a wallet on Robinhood Chain, an Ethereum L2 where US equities trade " +
      "as ERC-20 tokens against USDG 24/7.\n\n" +
      "Free tools: agentos_status, agentos_services, agentos_market, agentos_portfolio, agentos_vault.\n" +
      "Paid tools cost USDG per call and settle over x402: agentos_quote (0.001), " +
      "agentos_screen (0.01), agentos_route_order (0.02), agentos_research (0.05).\n\n" +
      "agentos_route_order returns unsigned calldata — it does not trade. Submitting is a " +
      "separate, operator-gated tool. Prefer agentos_quote for one ticker and agentos_screen " +
      "when comparing many; screening costs 10x a quote, so don't screen to answer a " +
      "single-ticker question. Call agentos_status first if you are unsure what is configured.",
  }
);

// --- Free tools ------------------------------------------------------------

server.registerTool(
  "agentos_status",
  {
    title: "Wallet & configuration status",
    description:
      "What this wallet is and what it may do: the agent's address, which AgentOS deployment " +
      "it talks to, the per-payment cap, and whether trade submission is enabled. Costs nothing. " +
      "Call this first if a paid tool fails or you are unsure of your limits.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const services = await fetchFree<{
        chainId: number;
        asset: { symbol: string; decimals: number };
        payTo: string;
        facilitator: { mode: string };
        services: Array<{ id: string; priceUsdg: number }>;
      }>(cfg, "/api/x402/services");

      return ok({
        wallet: cfg.account?.address ?? null,
        walletConfigured: !!cfg.account,
        endpoint: cfg.baseUrl,
        chain: { id: services.chainId, name: robinhood.name },
        settlementAsset: services.asset.symbol,
        limits: {
          maxPaymentUsdg: cfg.maxPaymentUsdg,
          submitEnabled: cfg.allowSubmit,
          maxTradeUsdg: cfg.maxTradeUsdg,
        },
        facilitatorMode: services.facilitator.mode,
        priceList: Object.fromEntries(services.services.map((s) => [s.id, s.priceUsdg])),
        note: cfg.account
          ? undefined
          : "No AGENTOS_PRIVATE_KEY set — only free tools will work.",
      });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_services",
  {
    title: "x402 service catalog",
    description:
      "The metered endpoints AgentOS sells, with live USDG prices and full payment terms. Free — " +
      "an agent has to be able to read the menu before agreeing to a price.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return ok(await fetchFree(cfg, "/api/x402/services"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_market",
  {
    title: "Free market snapshot",
    description:
      "Live prices and USDG pool depth for tokenized stocks, straight off chain. Free. Use this " +
      "for a broad look; use agentos_quote when you need the routed pool and fee tier for a " +
      "specific ticker.",
    inputSchema: {
      symbols: z
        .array(z.string())
        .optional()
        .describe("Tickers to fetch, e.g. ['NVDA','AAPL']. Omit for the whole market (slower)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ symbols }) => {
    try {
      const q = symbols?.length ? `?symbols=${encodeURIComponent(symbols.join(","))}` : "";
      return ok(await fetchFree(cfg, `/api/market${q}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_portfolio",
  {
    title: "Wallet holdings",
    description:
      "Everything an address holds on Robinhood Chain: ETH for gas, USDG cash, ERC-4626 vault " +
      "position, and every stock token marked to live pool prices. Free. Defaults to this " +
      "agent's own wallet.",
    inputSchema: {
      account: z.string().optional().describe("0x address. Defaults to this agent's wallet."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ account }) => {
    try {
      const who = account ?? cfg.account?.address;
      if (!who) throw new Error("No account given and no AGENTOS_PRIVATE_KEY configured.");
      return ok(await fetchFree(cfg, `/api/balances?account=${who}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_vault",
  {
    title: "USDG yield vault",
    description:
      "State of the Steakhouse USDG ERC-4626 vault where idle agent cash earns: TVL, share price " +
      "and realised yield. Free. Pass an account to include its position.",
    inputSchema: {
      account: z.string().optional().describe("0x address. Defaults to this agent's wallet."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ account }) => {
    try {
      const who = account ?? cfg.account?.address;
      return ok(await fetchFree(cfg, `/api/vault${who ? `?account=${who}` : ""}`));
    } catch (e) {
      return fail(e);
    }
  }
);

// --- Paid tools ------------------------------------------------------------

server.registerTool(
  "agentos_quote",
  {
    title: "Quote a stock token (0.001 USDG)",
    description:
      "Live on-chain quote for one Robinhood stock token: spot price in USDG, the routed pool, " +
      "fee tier and tradable depth. Costs 0.001 USDG, settled over x402 from this agent's wallet.",
    inputSchema: { symbol: z.string().describe("Ticker, e.g. NVDA") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ symbol }) => {
    try {
      return withReceipt(
        await fetchPaid(cfg, `/api/x402/quote?symbol=${encodeURIComponent(symbol)}`)
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_screen",
  {
    title: "Screen the whole market (0.01 USDG)",
    description:
      "Sweep every tokenized stock with a live USDG pool, ranked by tradable depth. Costs " +
      "0.01 USDG — ten quotes' worth — so use it to compare the field, not to look up one ticker.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return withReceipt(await fetchPaid(cfg, "/api/x402/screen"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_route_order",
  {
    title: "Route an order (0.02 USDG)",
    description:
      "Route a buy or sell through the deepest USDG pool and return submit-ready SwapRouter02 " +
      "calldata with a slippage-guarded minimum out. Costs 0.02 USDG. This does NOT trade — it " +
      "returns unsigned calldata. Always report the expected output and price impact. Use " +
      "agentos_submit_order to actually execute, if the operator has enabled it.",
    inputSchema: {
      symbol: z.string().describe("Ticker, e.g. NVDA"),
      side: z.enum(["buy", "sell"]),
      amount: z.number().positive().describe("USDG to spend for a buy, or shares to sell"),
      slippageBps: z.number().int().min(1).max(5000).optional().describe("Default 100 (1%)"),
      trader: z.string().optional().describe("Submitting address. Defaults to this agent's wallet."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ symbol, side, amount, slippageBps, trader }) => {
    try {
      const who = trader ?? cfg.account?.address;
      if (!who) throw new Error("No trader address and no AGENTOS_PRIVATE_KEY configured.");
      return withReceipt(
        await fetchPaid(cfg, "/api/x402/trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, side, amount, trader: who, slippageBps }),
        })
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "agentos_research",
  {
    title: "Research brief (0.05 USDG)",
    description:
      "A written trading brief for a ticker, grounded in live on-chain price, pool depth and fee " +
      "tier — including what the depth implies for maximum sane order size. Costs 0.05 USDG, the " +
      "priciest call in the catalog.",
    inputSchema: { symbol: z.string().describe("Ticker, e.g. TSLA") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ symbol }) => {
    try {
      return withReceipt(
        await fetchPaid(cfg, `/api/x402/research?symbol=${encodeURIComponent(symbol)}`)
      );
    } catch (e) {
      return fail(e);
    }
  }
);

// --- The one tool that moves money ----------------------------------------

server.registerTool(
  "agentos_submit_order",
  {
    title: "Submit a routed order on-chain",
    description:
      "Broadcast calldata returned by agentos_route_order, spending real funds. Disabled unless " +
      "the operator sets AGENTOS_ALLOW_SUBMIT, and capped by AGENTOS_MAX_TRADE_USDG. Handles the " +
      "ERC-20 approval first when the router lacks an allowance. Returns transaction hashes.",
    inputSchema: {
      symbol: z.string().describe("Ticker, restated so the trade is self-describing in logs"),
      side: z.enum(["buy", "sell"]),
      amount: z.number().positive().describe("USDG to spend for a buy, or shares to sell"),
      slippageBps: z.number().int().min(1).max(5000).optional(),
      confirm: z
        .literal(true)
        .describe("Must be true. Explicit acknowledgement that this spends real funds."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ symbol, side, amount, slippageBps }) => {
    try {
      if (!cfg.allowSubmit)
        throw new Error(
          "Trade submission is disabled. The operator must set AGENTOS_ALLOW_SUBMIT=1 to enable it."
        );
      if (!cfg.account) throw new Error("No AGENTOS_PRIVATE_KEY configured — nothing can be signed.");

      // The cap is on USDG notional, which only a buy states directly. For a
      // sell, price the shares first so the same ceiling applies to both sides.
      let notionalUsdg = amount;
      if (side === "sell") {
        const quote = await fetchPaid<{ price: number }>(
          cfg,
          `/api/x402/quote?symbol=${encodeURIComponent(symbol)}`
        );
        notionalUsdg = amount * quote.data.price;
      }
      if (notionalUsdg > cfg.maxTradeUsdg)
        throw new Error(
          `Refusing to submit: ${notionalUsdg.toFixed(2)} USDG exceeds the ` +
            `${cfg.maxTradeUsdg} USDG per-trade cap (AGENTOS_MAX_TRADE_USDG).`
        );

      const routed = await fetchPaid<{
        order: {
          to: `0x${string}`;
          data: `0x${string}`;
          expectedOut: number;
          minOut: string;
          priceImpactPct: number;
          approval: { to: `0x${string}`; data: `0x${string}` } | null;
        };
      }>(cfg, "/api/x402/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          amount,
          trader: cfg.account.address,
          slippageBps,
        }),
      });

      const order = routed.data.order;
      const wallet = createWalletClient({
        account: cfg.account,
        chain: robinhood,
        transport: http(),
      });
      const publicClient = createPublicClient({ chain: robinhood, transport: http() });

      const hashes: Record<string, string> = {};

      // Allowance first when missing — otherwise the swap reverts and burns gas
      // for nothing.
      if (order.approval) {
        const approveHash = await wallet.sendTransaction({
          to: order.approval.to,
          data: order.approval.data,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
        hashes.approval = approveHash;
      }

      const swapHash = await wallet.sendTransaction({ to: order.to, data: order.data });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: swapHash,
        timeout: 120_000,
      });
      hashes.swap = swapHash;

      return ok({
        submitted: true,
        status: receipt.status,
        symbol,
        side,
        amount,
        expectedOut: order.expectedOut,
        priceImpactPct: order.priceImpactPct,
        transactions: hashes,
        explorer: `${robinhood.blockExplorers.default.url}/tx/${swapHash}`,
        _x402: routed.payment,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP transport — anything written there corrupts the protocol.
  console.error(
    `agentos-mcp ready · ${cfg.baseUrl} · wallet ${cfg.account?.address ?? "(none)"} · ` +
      `cap ${cfg.maxPaymentUsdg} USDG/call · submit ${cfg.allowSubmit ? "ENABLED" : "disabled"}`
  );
}

main().catch((e) => {
  console.error("agentos-mcp failed to start:", e);
  process.exit(1);
});
