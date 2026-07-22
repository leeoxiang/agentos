import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR, USDG_DOMAIN, robinhood } from "../chain";
import { eip3009Abi, erc20Abi } from "../abi";
import { rpc } from "../rpc";
import {
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_NETWORK,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "./types";

/**
 * Verify an x402 `exact` payment without touching chain state.
 *
 * Six checks, cheapest first: scheme/network match, terms match, freshness,
 * signature recovery, on-chain nonce unused, payer solvent. Anything that fails
 * here would have failed as a reverted transaction — catching it now keeps the
 * facilitator from burning gas on doomed settlements.
 */
export async function verifyPayment(
  payment: PaymentPayload,
  requirements: PaymentRequirements
): Promise<VerifyResult> {
  const { authorization: auth, signature } = payment.payload ?? {};
  if (!auth || !signature) return { isValid: false, invalidReason: "malformed_payload" };

  if (payment.scheme !== "exact")
    return { isValid: false, invalidReason: `unsupported_scheme:${payment.scheme}` };
  if (payment.network !== requirements.network)
    return { isValid: false, invalidReason: `network_mismatch:${payment.network}` };

  // The payer must be paying the right person, at least the asking price.
  if (getAddress(auth.to) !== getAddress(requirements.payTo))
    return { isValid: false, invalidReason: "recipient_mismatch" };
  let value: bigint;
  try {
    value = BigInt(auth.value);
  } catch {
    return { isValid: false, invalidReason: "malformed_value" };
  }
  if (value < BigInt(requirements.maxAmountRequired))
    return { isValid: false, invalidReason: "insufficient_amount" };

  const now = Math.floor(Date.now() / 1000);
  if (Number(auth.validAfter) > now)
    return { isValid: false, invalidReason: "authorization_not_yet_valid" };
  // Require a little runway so settlement cannot expire mid-broadcast.
  if (Number(auth.validBefore) < now + 6)
    return { isValid: false, invalidReason: "authorization_expired" };

  let payer: `0x${string}`;
  try {
    payer = await recoverTypedDataAddress({
      domain: USDG_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(auth.from),
        to: getAddress(auth.to),
        value,
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: signature as `0x${string}`,
    });
  } catch {
    return { isValid: false, invalidReason: "signature_recovery_failed" };
  }

  if (getAddress(payer) !== getAddress(auth.from))
    return { isValid: false, invalidReason: "signature_signer_mismatch", payer };

  try {
    const [used, balance] = await Promise.all([
      rpc.readContract({
        address: ADDR.usdg,
        abi: eip3009Abi,
        functionName: "authorizationState",
        args: [getAddress(auth.from), auth.nonce],
      }),
      rpc.readContract({
        address: ADDR.usdg,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(auth.from)],
      }),
    ]);
    if (used) return { isValid: false, invalidReason: "authorization_already_used", payer };
    if ((balance as bigint) < value)
      return { isValid: false, invalidReason: "insufficient_funds", payer };
  } catch {
    return { isValid: false, invalidReason: "chain_read_failed", payer };
  }

  return { isValid: true, payer };
}

/** Calldata for the settlement transfer — the same bytes in both settle modes. */
export function settlementCalldata(payment: PaymentPayload): `0x${string}` {
  const auth = payment.payload.authorization;
  const sig = payment.payload.signature.slice(2);
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`;
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`;
  let v = parseInt(sig.slice(128, 130), 16);
  // EIP-2098 / legacy signers emit 0|1; EIP-3009 expects 27|28.
  if (v < 27) v += 27;

  return encodeFunctionData({
    abi: eip3009Abi,
    functionName: "transferWithAuthorization",
    args: [
      getAddress(auth.from),
      getAddress(auth.to),
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce,
      v,
      r,
      s,
    ],
  });
}

/**
 * Serialises facilitator broadcasts *including confirmation*.
 *
 * A single wallet sending several transactions at once is a nonce collision:
 * every concurrent call reads the same account nonce and only the first to land
 * is accepted, the rest reverting with "nonce too low". The arena settles five
 * payments per round in parallel, so without this exactly one succeeds.
 *
 * Serialising only the `sendTransaction` call is not enough, and that was the
 * first attempt at this: the second transaction asks for its nonce before the
 * first has been *mined*, so the chain still reports the old count and both use
 * the same one. The lock therefore has to span broadcast and receipt, which is
 * why this is slower than it looks like it should be. At ~0.1s blocks that is
 * a second or two per round — a fair price for every payment landing.
 */
let broadcastQueue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const result = broadcastQueue.then(work, work);
  // Keep the chain alive regardless of outcome; a rejection here must not
  // poison every subsequent settlement.
  broadcastQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Condense a broadcast failure into something displayable.
 *
 * viem errors carry the full request — calldata, arguments, docs links — which
 * runs to about a kilobyte. Storing that verbatim per feed entry bloats the KV
 * blob and, rendered, blows the layout apart horizontally. The first line
 * carries the actual cause; the rest is context for a stack trace nobody reads
 * on a leaderboard.
 */
function shortReason(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const first = raw.split("\n").find((l) => l.trim()) ?? "broadcast failed";
  const cleaned = first.trim();
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
}

export function facilitatorAccount() {
  const key = process.env.FACILITATOR_PRIVATE_KEY?.trim();
  if (!key) return null;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

/**
 * Broadcast the authorization.
 *
 * With a funded `FACILITATOR_PRIVATE_KEY` the payment is truly gasless for the
 * agent — the facilitator pays. Without one we hand the exact calldata back so
 * the payer can self-submit; the signed authorization is identical either way,
 * which keeps the demo path and the production path from diverging.
 */
export async function settlePayment(
  payment: PaymentPayload,
  requirements: PaymentRequirements
): Promise<SettleResult> {
  const verification = await verifyPayment(payment, requirements);
  if (!verification.isValid) {
    return {
      success: false,
      transaction: null,
      network: X402_NETWORK,
      payer: verification.payer ?? null,
      errorReason: verification.invalidReason,
    };
  }

  const data = settlementCalldata(payment);
  const account = facilitatorAccount();

  if (!account) {
    return {
      success: false,
      transaction: null,
      network: X402_NETWORK,
      payer: verification.payer,
      errorReason: "facilitator_unfunded",
      selfSubmit: { to: ADDR.usdg, data },
    };
  }

  try {
    const wallet = createWalletClient({ account, chain: robinhood, transport: http() });

    // Broadcast *and* confirm inside the lock — releasing after the broadcast
    // lets the next transaction read a nonce the chain hasn't advanced yet.
    const { hash, receipt } = await serialise(async () => {
      const sent = await wallet.sendTransaction({ to: ADDR.usdg, data });
      const mined = await rpc.waitForTransactionReceipt({ hash: sent, timeout: 60_000 });
      return { hash: sent, receipt: mined };
    });

    return {
      success: receipt.status === "success",
      transaction: hash,
      network: X402_NETWORK,
      payer: verification.payer,
      errorReason: receipt.status === "success" ? undefined : "transaction_reverted",
    };
  } catch (e) {
    return {
      success: false,
      transaction: null,
      network: X402_NETWORK,
      payer: verification.payer,
      errorReason: shortReason(e),
      selfSubmit: { to: ADDR.usdg, data },
    };
  }
}
