/**
 * Off-chain brand and token constants.
 *
 * `CONTRACT_ADDRESS` is intentionally the literal string "SOON" until the token
 * launches. Every surface that renders it checks {@link hasContract} rather than
 * truthiness, so a placeholder can never be mistaken for a real address by a
 * component that only asked "is it set".
 */

export const SOCIAL = {
  twitter: "https://x.com/agentos",
  github: "https://github.com/leeoxiang/agentos",
  npm: "https://www.npmjs.com/package/agentos-mcp",
} as const;

export const TOKEN: {
  symbol: string;
  buyUrl: string;
  /** The deployed address, or the literal "SOON" before launch. */
  contractAddress: string;
} = {
  symbol: "$AGENT",
  buyUrl: "https://ponsfamily.com",
  contractAddress: "SOON",
};

export const hasContract = () =>
  TOKEN.contractAddress !== "SOON" && TOKEN.contractAddress.startsWith("0x");
