import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { swapRouterAbi } from "@/lib/abi";
import { USDG_DOMAIN, USDG_DECIMALS, STOCK_DECIMALS } from "@/lib/chain";
import { findPool, priceFromSqrt, estimateOut, type Pool } from "@/lib/market";
import { STOCKS } from "@/lib/stocks";
import { buildOrder } from "@/lib/order";
import { verifyPayment } from "@/lib/x402/facilitator";
import { buildRequirements } from "@/lib/x402/server";
import { CATALOG } from "@/lib/x402/catalog";
import { TRANSFER_WITH_AUTHORIZATION_TYPES, X402_VERSION } from "@/lib/x402/types";
import { applyTrade, freshPlayer } from "@/lib/arena/players";
import { toCandles, type PoolActivity } from "@/lib/volume";
import { sma, volatilityPct, rangePosition, changePct } from "@/lib/twap";

/**
 * Tests over the paths that move money.
 *
 * Deliberately narrow: price math, order construction, payment verification and
 * book accounting. These are the places where a silent regression costs someone
 * real funds rather than producing a visibly broken page — a mispriced quote or
 * a slippage guard computed the wrong way round looks completely normal until
 * the transaction lands.
 */

/**
 * Read the live pool rather than hardcoding a fixture.
 *
 * A pinned sqrtPriceX96 is a number nobody can sanity-check by eye, and the
 * first version of this file shipped one that was wrong by eighteen orders of
 * magnitude — the test failed for the fixture's sake, not the code's. Reading
 * real state means the assertions are about the maths, and they keep meaning
 * that as the market moves.
 */
async function nvdaPool(): Promise<Pool> {
  const stock = STOCKS.find((s) => s.symbol === "NVDA")!;
  const pool = await findPool(stock.address);
  if (!pool) throw new Error("no NVDA/USDG pool — cannot test price math");
  return pool;
}

describe("V3 price math", () => {
  it("unwinds the 12-decimal gap and token ordering into a dollar price", async () => {
    const pool = await nvdaPool();
    const price = priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0);
    // NVDA trades in the low hundreds. A decimals or inversion bug lands this
    // many orders of magnitude away, which is exactly what this pins.
    expect(price).toBeGreaterThan(50);
    expect(price).toBeLessThan(1000);
  });

  it("inverts when the token ordering flips", async () => {
    const pool = await nvdaPool();
    const asToken0 = priceFromSqrt(pool.sqrtPriceX96, true);
    const asToken1 = priceFromSqrt(pool.sqrtPriceX96, false);
    expect(asToken0).not.toBeCloseTo(asToken1, 6);

    // The two readings are reciprocal apart from the decimal shift applied
    // twice: (1 / (raw * s)) * (raw / s) === 1 / s², where s = 10^(6-18).
    const shift = 10 ** (USDG_DECIMALS - STOCK_DECIMALS);
    expect(asToken0 * asToken1).toBeCloseTo(1 / shift ** 2, -20);
  });

  it("charges the pool fee and reports non-negative impact", async () => {
    const { out, priceImpactPct, price } = estimateOut(await nvdaPool(), 100, "usdg->stock");
    expect(out).toBeGreaterThan(0);
    // Fee alone means you always receive less than the spot-implied amount.
    expect(out).toBeLessThan(100 / price);
    expect(priceImpactPct).toBeGreaterThanOrEqual(0);
  });

  it("charges more impact for a larger order", async () => {
    const pool = await nvdaPool();
    const small = estimateOut(pool, 100, "usdg->stock").priceImpactPct;
    const large = estimateOut(pool, 100_000, "usdg->stock").priceImpactPct;
    expect(large).toBeGreaterThan(small);
  });
});

describe("order construction", () => {
  const trader = "0x6dA8b1c2D3e4f5061728394a5B6C7D8E9F001E69" as const;

  it("encodes exactInputSingle with a correctly bounded minimum out", async () => {
    const order = await buildOrder({ symbol: "NVDA", side: "buy", amount: 100, trader, slippageBps: 100 });

    const { functionName, args } = decodeFunctionData({ abi: swapRouterAbi, data: order.data });
    expect(functionName).toBe("exactInputSingle");

    const p = args[0];
    expect(p.recipient.toLowerCase()).toBe(trader.toLowerCase());
    expect(p.amountIn).toBe(parseUnits("100", USDG_DECIMALS));

    // The guard that actually protects the trader: minOut must be exactly
    // (1 - slippage) of expected, never above it.
    const minOut = Number(p.amountOutMinimum) / 10 ** STOCK_DECIMALS;
    expect(minOut / order.expectedOut).toBeCloseTo(0.99, 3);
    expect(minOut).toBeLessThan(order.expectedOut);
  }, 60_000);

  it("tightens minOut as slippage tolerance falls", async () => {
    const loose = await buildOrder({ symbol: "NVDA", side: "buy", amount: 100, trader, slippageBps: 500 });
    const tight = await buildOrder({ symbol: "NVDA", side: "buy", amount: 100, trader, slippageBps: 50 });
    expect(BigInt(tight.minOut)).toBeGreaterThan(BigInt(loose.minOut));
  }, 60_000);

  it("rejects a non-positive amount rather than encoding a zero swap", async () => {
    await expect(buildOrder({ symbol: "NVDA", side: "buy", amount: 0, trader })).rejects.toThrow();
  });

  it("rejects an unknown ticker", async () => {
    await expect(
      buildOrder({ symbol: "NOTAREALTICKER", side: "buy", amount: 10, trader })
    ).rejects.toThrow(/unknown ticker/i);
  });
});

describe("x402 payment verification", () => {
  const origin = "https://example.test";

  async function signed(overrides: Partial<{ value: string; to: string }> = {}) {
    const account = privateKeyToAccount(generatePrivateKey());
    const requirements = buildRequirements(CATALOG.quote, origin);
    const now = Math.floor(Date.now() / 1000);
    const nonce = `0x${"ab".repeat(32)}` as `0x${string}`;

    const authorization = {
      from: account.address,
      to: (overrides.to ?? requirements.payTo) as `0x${string}`,
      value: BigInt(overrides.value ?? requirements.maxAmountRequired),
      validAfter: BigInt(now - 60),
      validBefore: BigInt(now + 300),
      nonce,
    };

    const signature = await account.signTypedData({
      domain: USDG_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });

    return {
      requirements,
      payload: {
        x402Version: X402_VERSION,
        scheme: "exact" as const,
        network: requirements.network,
        payload: {
          signature,
          authorization: {
            from: authorization.from,
            to: authorization.to,
            value: authorization.value.toString(),
            validAfter: authorization.validAfter.toString(),
            validBefore: authorization.validBefore.toString(),
            nonce,
          },
        },
      },
    };
  }

  it("recovers a genuine signature and fails only on funds", async () => {
    const { payload, requirements } = await signed();
    const result = await verifyPayment(payload, requirements);
    // A fresh key holds no USDG, so reaching `insufficient_funds` proves the
    // signature recovered and the on-chain nonce check ran.
    expect(result.isValid).toBe(false);
    if (!result.isValid) expect(result.invalidReason).toBe("insufficient_funds");
  }, 60_000);

  it("rejects a payment whose value was inflated after signing", async () => {
    const { payload, requirements } = await signed();
    payload.payload.authorization.value = "999999999";
    const result = await verifyPayment(payload, requirements);
    expect(result.isValid).toBe(false);
    if (!result.isValid) expect(result.invalidReason).toBe("signature_signer_mismatch");
  }, 60_000);

  it("rejects a payment addressed to someone else", async () => {
    const { payload, requirements } = await signed({
      to: "0x000000000000000000000000000000000000dEaD",
    });
    const result = await verifyPayment(payload, requirements);
    expect(result.isValid).toBe(false);
    if (!result.isValid) expect(result.invalidReason).toBe("recipient_mismatch");
  }, 60_000);

  it("rejects an expired authorization", async () => {
    const { payload, requirements } = await signed();
    payload.payload.authorization.validBefore = String(Math.floor(Date.now() / 1000) - 10);
    const result = await verifyPayment(payload, requirements);
    expect(result.isValid).toBe(false);
    if (!result.isValid) expect(result.invalidReason).toBe("authorization_expired");
  }, 60_000);
});

describe("player book accounting", () => {
  it("charges the pool fee on entry and cannot spend more than the balance", () => {
    const p = freshPlayer("0x1111111111111111111111111111111111111111");
    const before = p.cashUsdg;

    const fill = applyTrade(p, "buy", "NVDA", 100, 200, 3000);
    expect(fill.ok).toBe(true);
    expect(p.cashUsdg).toBeCloseTo(before - 100, 6);
    // 0.3% fee means fewer shares than 100/200 = 0.5.
    if (fill.ok) expect(fill.qty).toBeLessThan(0.5);

    const overspend = applyTrade(p, "buy", "NVDA", 10_000, 200, 3000);
    expect(overspend.ok).toBe(false);
  });

  it("realises a gain on a round trip through a higher price", () => {
    const p = freshPlayer("0x2222222222222222222222222222222222222222");
    applyTrade(p, "buy", "NVDA", 100, 200, 500);
    const sell = applyTrade(p, "sell", "NVDA", p.position!.qty, 260, 500);

    expect(sell.ok).toBe(true);
    expect(p.position).toBeNull();
    expect(p.realizedPnl).toBeGreaterThan(0);
    expect(p.wins).toBe(1);
    // 30% move minus two 0.05% legs still clears the entry cost comfortably.
    expect(p.cashUsdg).toBeGreaterThan(1000);
  });

  it("books a loss when price falls, and counts it", () => {
    const p = freshPlayer("0x3333333333333333333333333333333333333333");
    applyTrade(p, "buy", "NVDA", 100, 200, 500);
    applyTrade(p, "sell", "NVDA", p.position!.qty, 150, 500);
    expect(p.realizedPnl).toBeLessThan(0);
    expect(p.losses).toBe(1);
    expect(p.cashUsdg).toBeLessThan(1000);
  });

  it("refuses to sell something it does not hold", () => {
    const p = freshPlayer("0x4444444444444444444444444444444444444444");
    const r = applyTrade(p, "sell", "NVDA", 1, 200, 500);
    expect(r.ok).toBe(false);
  });

  it("refuses a second position in a different ticker", () => {
    const p = freshPlayer("0x5555555555555555555555555555555555555555");
    applyTrade(p, "buy", "NVDA", 100, 200, 500);
    const r = applyTrade(p, "buy", "SPCX", 100, 120, 3000);
    expect(r.ok).toBe(false);
  });
});

describe("indicators over swap-derived candles", () => {
  const activity = (prices: number[]): PoolActivity => ({
    swaps: prices.length,
    volumeUsdg: 10_000,
    prices: prices.map((price, i) => ({ blockNumber: BigInt(i), price })),
  });

  it("downsamples a long fill series to a fixed candle count", () => {
    const candles = toCandles(activity(Array.from({ length: 900 }, (_, i) => 100 + i * 0.01)), 30);
    expect(candles).toHaveLength(30);
    // Strictly increasing timestamps — every indicator assumes ordering.
    for (let i = 1; i < candles.length; i++) expect(candles[i].t).toBeGreaterThan(candles[i - 1].t);
    expect(candles[29].price).toBeGreaterThan(candles[0].price);
  });

  it("returns nothing rather than a fake series when there are no fills", () => {
    expect(toCandles(activity([]))).toHaveLength(0);
    expect(toCandles(activity([100]))).toHaveLength(0);
  });

  it("computes SMA, volatility, range position and change", () => {
    const candles = toCandles(activity([100, 101, 102, 103, 104, 105, 106, 107]), 8);
    expect(sma(candles, 4)).toBeCloseTo((104 + 105 + 106 + 107) / 4, 6);
    expect(sma(candles, 99)).toBeNull();
    expect(rangePosition(candles)).toBeCloseTo(1, 6); // last price is the high
    expect(changePct(candles)).toBeGreaterThan(0);
    expect(volatilityPct(candles)).toBeGreaterThan(0);
  });

  it("reports zero volatility for a flat series", () => {
    const candles = toCandles(activity(Array(20).fill(200)), 10);
    expect(volatilityPct(candles)).toBe(0);
    expect(changePct(candles)).toBe(0);
  });
});
