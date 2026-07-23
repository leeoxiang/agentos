/**
 * Off-chain brand and token constants.
 *
 * `CONTRACT_ADDRESS` is intentionally the literal string "SOON" until the token
 * launches. Every surface that renders it checks {@link hasContract} rather than
 * truthiness, so a placeholder can never be mistaken for a real address by a
 * component that only asked "is it set".
 */

export const SOCIAL = {
  twitter: "https://x.com/tryagentos",
  github: "https://github.com/ArchieHowell/agentOS",
  npm: "https://www.npmjs.com/package/agentos-mcp",
} as const;

export const TOKEN: {
  symbol: string;
  /** The deployed address, or the literal "SOON" before launch. */
  contractAddress: string;
} = {
  symbol: "$AGENT",
  // EIP-55 checksummed. Verified on Robinhood Chain: name "AgentOS",
  // symbol "AGENT", 18 decimals, 1e9 supply.
  contractAddress: "0xc93F5fc6563020e3D164474b03e8C2251fA5BBA8",
};

export const hasContract = () =>
  TOKEN.contractAddress !== "SOON" && TOKEN.contractAddress.startsWith("0x");

/** Launchpad root — where the buy button points before the token exists. */
const LAUNCHPAD = "https://www.ponsfamily.com/launchpad";

/**
 * Where "Buy $AGENT" goes.
 *
 * Derived from the address rather than stored alongside it, so the two can't
 * drift — setting `contractAddress` is the single edit that takes the token
 * live everywhere. Before launch this deliberately points at the launchpad root
 * instead of interpolating "SOON" into a URL that would 404.
 */
export const buyUrl = () =>
  hasContract() ? `${LAUNCHPAD}/${TOKEN.contractAddress}` : LAUNCHPAD;
