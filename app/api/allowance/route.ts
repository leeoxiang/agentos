import { NextResponse } from "next/server";
import { isAddr } from "@/lib/addr";
import { erc20Abi } from "@/lib/abi";
import { rpc } from "@/lib/rpc";

export const dynamic = "force-dynamic";

/** On-demand allowance read, so the deposit flow can skip a needless approve. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const [owner, spender, token] = [p.get("owner"), p.get("spender"), p.get("token")];
  if (!owner || !spender || !token || ![owner, spender, token].every(isAddr))
    return NextResponse.json({ error: "owner, spender and token addresses required" }, { status: 400 });

  try {
    const allowance = (await rpc.readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    })) as bigint;
    return NextResponse.json({ allowance: allowance.toString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "allowance read failed" },
      { status: 500 }
    );
  }
}
