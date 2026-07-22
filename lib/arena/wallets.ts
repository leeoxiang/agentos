import { keccak256, toBytes } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { AGENTS } from "./agents";

/**
 * Deterministic wallets for the arena competitors.
 *
 * Each agent needs a real key so it can produce a real EIP-3009 signature —
 * that is what makes the x402 leg genuine rather than narrated. Keys are derived
 * from `ARENA_SEED` so addresses stay stable across restarts and deploys.
 *
 * With the default seed these are public, unfunded paper wallets: they can sign,
 * and the facilitator will verify the signature, but settlement stops at
 * `insufficient_funds`. Set `ARENA_SEED` and fund the addresses to make the
 * agents pay for their data for real. Never reuse a seed that controls value.
 */
const SEED = process.env.ARENA_SEED ?? "agentos-arena-public-demo-seed";

const cache = new Map<string, PrivateKeyAccount>();

export function agentAccount(agentId: string): PrivateKeyAccount {
  const hit = cache.get(agentId);
  if (hit) return hit;
  const key = keccak256(toBytes(`${SEED}:${agentId}`));
  const account = privateKeyToAccount(key);
  cache.set(agentId, account);
  return account;
}

export const usingDefaultSeed = () => !process.env.ARENA_SEED;

export const agentAddresses = () =>
  Object.fromEntries(AGENTS.map((a) => [a.id, agentAccount(a.id).address]));
