import { isAddress } from "viem";

/**
 * Address validation for anything crossing the API boundary.
 *
 * viem's `isAddress` defaults to `strict: true`, which rejects a correctly
 * formed address whose *checksum casing* is wrong — including every all-lowercase
 * address. Agents and scripts routinely send lowercase, so strict mode turns a
 * perfectly valid request into a 400. Validate the shape here and let
 * `getAddress` do the checksumming downstream.
 */
export function isAddr(value: unknown): value is `0x${string}` {
  return typeof value === "string" && isAddress(value, { strict: false });
}
