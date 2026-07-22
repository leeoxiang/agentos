import { NextResponse } from "next/server";
import { formatEther, formatUnits } from "viem";
import { isAddr } from "@/lib/addr";
import { ADDR, STOCK_DECIMALS, USDG_DECIMALS, VAULT_DECIMALS } from "@/lib/chain";
import { erc20Abi, erc4626Abi } from "@/lib/abi";
import { rpc } from "@/lib/rpc";
import { STOCKS } from "@/lib/stocks";
import { findPool, priceFromSqrt } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Everything the agent wallet holds: gas, cash, vault position, stock book. */
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account");
  if (!account || !isAddr(account))
    return NextResponse.json({ error: "account query param required" }, { status: 400 });
  const who = account as `0x${string}`;

  try {
    const [eth, usdg, vaultShares] = await Promise.all([
      rpc.getBalance({ address: who }),
      rpc.readContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
      rpc.readContract({
        address: ADDR.yieldVault,
        abi: erc4626Abi,
        functionName: "balanceOf",
        args: [who],
      }),
    ]);

    const vaultAssets =
      (vaultShares as bigint) > 0n
        ? ((await rpc.readContract({
            address: ADDR.yieldVault,
            abi: erc4626Abi,
            functionName: "convertToAssets",
            args: [vaultShares as bigint],
          })) as bigint)
        : 0n;

    // Balance-first: only tokens actually held get the (expensive) pool lookup.
    const raw = await Promise.all(
      STOCKS.map((s) =>
        rpc
          .readContract({ address: s.address, abi: erc20Abi, functionName: "balanceOf", args: [who] })
          .then((b) => ({ s, b: b as bigint }))
          .catch(() => ({ s, b: 0n }))
      )
    );
    const held = raw.filter((r) => r.b > 0n);

    const positions = await Promise.all(
      held.map(async ({ s, b }) => {
        const qty = Number(formatUnits(b, STOCK_DECIMALS));
        const pool = await findPool(s.address).catch(() => null);
        const price = pool ? priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0) : null;
        return {
          symbol: s.symbol,
          name: s.name,
          sector: s.sector,
          address: s.address,
          qty,
          price,
          valueUsdg: price ? qty * price : null,
        };
      })
    );
    positions.sort((a, b) => (b.valueUsdg ?? 0) - (a.valueUsdg ?? 0));

    const cash = Number(formatUnits(usdg as bigint, USDG_DECIMALS));
    const earning = Number(formatUnits(vaultAssets, USDG_DECIMALS));
    const equities = positions.reduce((n, p) => n + (p.valueUsdg ?? 0), 0);

    return NextResponse.json({
      account: who,
      gasEth: Number(formatEther(eth)),
      cashUsdg: cash,
      vault: {
        shares: Number(formatUnits(vaultShares as bigint, VAULT_DECIMALS)),
        assetsUsdg: earning,
      },
      positions,
      totals: { equities, netWorthUsdg: cash + earning + equities },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "balance read failed" },
      { status: 500 }
    );
  }
}
