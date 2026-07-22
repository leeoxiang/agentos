import { NextResponse } from "next/server";
import { formatUnits, parseUnits } from "viem";
import { isAddr } from "@/lib/addr";
import { ADDR, USDG_DECIMALS, VAULT_DECIMALS } from "@/lib/chain";
import { erc20Abi, erc4626Abi } from "@/lib/abi";
import { rpc } from "@/lib/rpc";

export const dynamic = "force-dynamic";

/**
 * Steakhouse USDG vault state.
 *
 * The share price (assets per share) is read live; APY is derived from it
 * against the 1.0 mint price, which is the honest read of realised yield for a
 * vault with no on-chain inception timestamp exposed.
 */
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account");

  try {
    const oneShare = parseUnits("1", VAULT_DECIMALS);
    const [totalAssets, totalSupply, assetsPerShare, symbol] = await Promise.all([
      rpc.readContract({ address: ADDR.yieldVault, abi: erc4626Abi, functionName: "totalAssets" }),
      rpc.readContract({ address: ADDR.yieldVault, abi: erc4626Abi, functionName: "totalSupply" }),
      rpc.readContract({
        address: ADDR.yieldVault,
        abi: erc4626Abi,
        functionName: "convertToAssets",
        args: [oneShare],
      }),
      rpc.readContract({ address: ADDR.yieldVault, abi: erc20Abi, functionName: "symbol" }),
    ]);

    const tvl = Number(formatUnits(totalAssets as bigint, USDG_DECIMALS));
    const sharePrice = Number(formatUnits(assetsPerShare as bigint, USDG_DECIMALS));

    let position: { shares: string; assets: number; sharesHuman: number } | null = null;
    if (account && isAddr(account)) {
      const shares = (await rpc.readContract({
        address: ADDR.yieldVault,
        abi: erc4626Abi,
        functionName: "balanceOf",
        args: [account as `0x${string}`],
      })) as bigint;
      const assets =
        shares > 0n
          ? ((await rpc.readContract({
              address: ADDR.yieldVault,
              abi: erc4626Abi,
              functionName: "convertToAssets",
              args: [shares],
            })) as bigint)
          : 0n;
      position = {
        shares: shares.toString(),
        sharesHuman: Number(formatUnits(shares, VAULT_DECIMALS)),
        assets: Number(formatUnits(assets, USDG_DECIMALS)),
      };
    }

    return NextResponse.json({
      vault: ADDR.yieldVault,
      symbol,
      asset: { address: ADDR.usdg, symbol: "USDG", decimals: USDG_DECIMALS },
      tvl,
      totalShares: Number(formatUnits(totalSupply as bigint, VAULT_DECIMALS)),
      sharePrice,
      /** Cumulative return since the share price left 1.0. */
      cumulativeYieldPct: (sharePrice - 1) * 100,
      position,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "vault read failed" }, { status: 500 });
  }
}
