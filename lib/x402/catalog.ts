import type { PaidRoute } from "./server";

/**
 * The metered endpoints AgentOS sells.
 *
 * This doubles as the discovery document (`GET /api/x402/services`) and as the
 * tool list handed to the on-site agent, so a price only ever lives in one place.
 */
export const CATALOG: Record<string, PaidRoute> = {
  quote: {
    id: "market.quote",
    path: "/api/x402/quote",
    priceUsdg: 0.001,
    description:
      "Live on-chain quote for one Robinhood Chain stock token: spot price in USDG, pool, fee tier and depth.",
    outputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        price: { type: "number", description: "USDG per share" },
        pool: { type: "string" },
        fee: { type: "number" },
        depthUsdg: { type: "number" },
        block: { type: "string" },
      },
    },
  },
  screen: {
    id: "market.screen",
    path: "/api/x402/screen",
    priceUsdg: 0.01,
    description:
      "Full sweep of all 94 Robinhood stock tokens with live prices, ranked by tradable USDG depth.",
    outputSchema: {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object" } },
        count: { type: "number" },
      },
    },
  },
  trade: {
    id: "trade.buildOrder",
    path: "/api/x402/trade",
    priceUsdg: 0.02,
    description:
      "Route and build an executable stock order. Returns SwapRouter02 calldata with a slippage-guarded minimum out — submit it from the agent wallet to buy or sell the stock token on Robinhood Chain.",
    outputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        data: { type: "string" },
        expectedOut: { type: "number" },
        minOut: { type: "string" },
        priceImpactPct: { type: "number" },
        approvalNeeded: { type: "object" },
      },
    },
  },
  research: {
    id: "research.brief",
    path: "/api/x402/research",
    priceUsdg: 0.05,
    description:
      "Model-written trading brief for a ticker, grounded in live on-chain price, pool depth and the agent's current position.",
    outputSchema: {
      type: "object",
      properties: { symbol: { type: "string" }, brief: { type: "string" } },
    },
  },
};

export const CATALOG_LIST = Object.values(CATALOG);
