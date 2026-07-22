import { createPublicClient, http, type PublicClient } from "viem";
import { robinhood } from "./chain";

/**
 * Shared read-only client. Batched so a 94-token market sweep collapses into a
 * handful of multicall round-trips instead of 94 sequential ones.
 */
export const rpc: PublicClient = createPublicClient({
  chain: robinhood,
  transport: http(undefined, { batch: true, retryCount: 2 }),
  batch: { multicall: { wait: 16 } },
}) as PublicClient;
