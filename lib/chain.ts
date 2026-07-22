import { defineChain } from "viem";

/**
 * Robinhood Chain — Arbitrum-stack L2 that settles tokenized US equities.
 * Everything AgentOS does (x402 settlement, swaps, yield) happens here.
 */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

// trim() strips whitespace and byte-order marks that shell pipes smuggle into
// env values — an invisible BOM in an address breaks every read with no clue why.
const env = (v: string | undefined, fallback: string) => (v || fallback).trim();

export const ADDR = {
  /** Global Dollar — Robinhood Chain's native settlement stablecoin. 6 decimals. */
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as `0x${string}`,
  /** Uniswap V3 deployment on 4663. EIP-55 checksums — viem rejects a bad one. */
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as `0x${string}`,
  swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2" as `0x${string}`,
  /** Steakhouse USDG — ERC-4626 vault, asset = USDG. Where idle agent cash earns. */
  yieldVault: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd" as `0x${string}`,
} as const;

/** USDG has 6 decimals; every stock token and the vault share have 18. */
export const USDG_DECIMALS = 6;
export const STOCK_DECIMALS = 18;
export const VAULT_DECIMALS = 18;

/**
 * EIP-712 domain for USDG's EIP-3009 authorizations. `version` is "1" — the
 * token does not expose version(), so this was recovered by matching the
 * on-chain DOMAIN_SEPARATOR (0x7a3d7400…2036). Do not change without re-deriving.
 */
export const USDG_DOMAIN = {
  name: "Global Dollar",
  version: "1",
  chainId: robinhood.id,
  verifyingContract: ADDR.usdg,
} as const;

/** Fee tiers to probe, most-liquid-first, when routing a stock <> USDG swap. */
export const FEE_TIERS = [10_000, 3_000, 500, 100] as const;

/** Where x402 payments land. Override per-deployment. */
export const PAY_TO = env(
  process.env.NEXT_PUBLIC_PAY_TO,
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

export const explorerTx = (h: string) => `${robinhood.blockExplorers.default.url}/tx/${h}`;
export const explorerAddr = (a: string) =>
  `${robinhood.blockExplorers.default.url}/address/${a}`;
