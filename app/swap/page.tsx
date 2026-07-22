"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { AddrLink, Badge, Button, Empty, Input, Loading, Panel, PanelHeader, TxLink } from "@/components/ui";
import { compact, feeLabel, qty, usd } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { BuiltOrder, Side } from "@/lib/order";

type Market = {
  rows: Array<{
    symbol: string;
    name: string;
    sector: string;
    address: `0x${string}`;
    price: number | null;
    fee: number | null;
    depthUsdg: number;
  }>;
  block: string;
  tradable: number;
};

export default function SwapPage() {
  const { address, isConnected } = useAccount();
  const { data: market, loading } = useApi<Market>("/api/market", 30_000);

  const [symbol, setSymbol] = useState("AAPL");
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("25");
  const [slippage, setSlippage] = useState("100");
  const [order, setOrder] = useState<BuiltOrder | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const { sendTransactionAsync, isPending } = useSendTransaction();
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  const tradable = useMemo(
    () => (market?.rows ?? []).filter((r) => r.price !== null),
    [market]
  );
  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? tradable.filter(
          (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
        )
      : tradable;
  }, [tradable, filter]);

  const active = tradable.find((r) => r.symbol === symbol) ?? null;

  // Re-quote whenever the trade changes. Debounced because every quote is a
  // pool read, and typing an amount would otherwise fire one per keystroke.
  useEffect(() => {
    const n = Number(amount);
    if (!address || !symbol || !(n > 0)) {
      setOrder(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, side, amount: n, trader: address, slippageBps: Number(slippage) }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "quote failed");
        setOrder(body.order as BuiltOrder);
        setErr(null);
      } catch (e) {
        if (cancelled) return;
        setOrder(null);
        setErr(e instanceof Error ? e.message : "quote failed");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [symbol, side, amount, address, slippage]);

  async function submit() {
    if (!order) return;
    setErr(null);
    try {
      // Allowance first when the router doesn't have one — two prompts, but the
      // alternative is a swap that reverts and burns the user's gas for nothing.
      if (order.approval) {
        const approveHash = await sendTransactionAsync({
          to: order.approval.to,
          data: order.approval.data,
        });
        setHash(approveHash);
        return;
      }
      const swapHash = await sendTransactionAsync({ to: order.to, data: order.data });
      setHash(swapHash);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "transaction rejected");
    }
  }

  const impactTone =
    !order ? "neutral" : order.priceImpactPct > 3 ? "down" : order.priceImpactPct > 1 ? "gold" : "up";

  return (
    <>
      <PageHeader
        eyebrow="Uniswap V3 · Robinhood Chain"
        title="Swap USDG ↔ tokenized stocks"
        right={
          market ? (
            <div className="text-right">
              <div className="label">Live block</div>
              <div className="tnum mt-1 text-[15px] text-ash-100">{market.block}</div>
            </div>
          ) : null
        }
      >
        Orders route through the deepest USDG pool for each ticker with a
        slippage-bounded minimum out. AgentOS never custodies funds — you sign and
        submit every swap yourself.
      </PageHeader>

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <Panel>
            <PanelHeader
              title="Market"
              hint={`${tradable.length} tickers with live USDG liquidity`}
              right={
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="h-7 w-32 text-[11px]"
                />
              }
            />
            {loading && !market ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Loading key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : !listed.length ? (
              <Empty>No tickers match.</Empty>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-ink-900">
                    <tr className="border-b border-ink-700">
                      {["Ticker", "Sector", "Price", "Depth", "Fee"].map((h, i) => (
                        <th key={h} className={`label px-4 py-2 font-normal ${i >= 2 ? "text-right" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((r) => (
                      <tr
                        key={r.address}
                        onClick={() => setSymbol(r.symbol)}
                        className={`cursor-pointer border-b border-ink-800 last:border-0 hover:bg-ink-850 ${
                          r.symbol === symbol ? "bg-ink-850" : ""
                        }`}
                      >
                        <td className="relative px-4 py-2.5">
                          <span
                            className={`absolute left-0 top-0 h-full w-[2px] ${
                              r.symbol === symbol ? "bg-flame-500" : "bg-transparent"
                            }`}
                          />
                          <div className="text-[13px] font-medium text-ash-100">{r.symbol}</div>
                          <div className="truncate text-[10.5px] text-ash-400">{r.name}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge>{r.sector}</Badge>
                        </td>
                        <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-100">
                          {usd(r.price)}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-300">
                          {compact(r.depthUsdg)}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right text-[11px] text-ash-400">
                          {feeLabel(r.fee)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title={`${side === "buy" ? "Buy" : "Sell"} ${symbol}`} hint={active?.name} />
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-1.5">
                  {(["buy", "sell"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className={`h-9 rounded-[2px] border text-[12px] font-medium capitalize transition-colors ${
                        side === s
                          ? s === "buy"
                            ? "border-mint-500/50 bg-mint-500/10 text-mint-500"
                            : "border-rose-500/50 bg-rose-500/10 text-rose-500"
                          : "border-ink-600 text-ash-400 hover:text-ash-200"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="label mb-1.5 block">
                    {side === "buy" ? "USDG to spend" : `${symbol} shares to sell`}
                  </label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                </div>

                <div>
                  <label className="label mb-1.5 block">Slippage tolerance (bps)</label>
                  <div className="flex gap-1.5">
                    {["50", "100", "300"].map((b) => (
                      <button
                        key={b}
                        onClick={() => setSlippage(b)}
                        className={`h-8 flex-1 rounded-[2px] border text-[11px] tnum transition-colors ${
                          slippage === b
                            ? "border-flame-500 text-flame-500"
                            : "border-ink-600 text-ash-400 hover:text-ash-200"
                        }`}
                      >
                        {Number(b) / 100}%
                      </button>
                    ))}
                    <Input
                      value={slippage}
                      onChange={(e) => setSlippage(e.target.value)}
                      className="h-8 w-20 text-[11px]"
                    />
                  </div>
                </div>

                <div className="space-y-2 rounded-[2px] border border-ink-700 bg-ink-850 p-3">
                  {[
                    [
                      "You receive",
                      order
                        ? `${qty(order.expectedOut)} ${side === "buy" ? symbol : "USDG"}`
                        : quoting
                          ? "…"
                          : "—",
                    ],
                    ["Spot price", order ? `${usd(order.price)} USDG` : "—"],
                    ["Pool fee", order ? feeLabel(order.fee) : "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <span className="text-[11.5px] text-ash-400">{k}</span>
                      <span className="tnum text-[12.5px] text-ash-100">{v}</span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11.5px] text-ash-400">Price impact</span>
                    {order ? (
                      <Badge tone={impactTone as "up" | "down" | "gold" | "neutral"}>
                        {order.priceImpactPct.toFixed(2)}%
                      </Badge>
                    ) : (
                      <span className="tnum text-[12.5px] text-ash-100">—</span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-ink-700 pt-2">
                    <span className="text-[11.5px] text-ash-400">Minimum out</span>
                    <span className="tnum text-[12.5px] text-flame-500">
                      {order
                        ? qty(
                            Number(order.minOut) / 10 ** (side === "buy" ? 18 : 6)
                          )
                        : "—"}
                    </span>
                  </div>
                </div>

                {order && order.priceImpactPct > 3 ? (
                  <p className="rounded-[2px] border border-rose-500/40 bg-rose-500/8 px-2.5 py-2 text-[10.5px] leading-snug text-rose-500">
                    {order.priceImpactPct.toFixed(1)}% price impact — this pool is too thin for
                    an order this size. Reduce the amount.
                  </p>
                ) : null}

                <Button
                  className="w-full"
                  disabled={!isConnected || !order || isPending || quoting}
                  onClick={submit}
                >
                  {!isConnected
                    ? "Connect a wallet"
                    : isPending
                      ? "Confirm in wallet…"
                      : order?.approval
                        ? `Approve ${side === "buy" ? "USDG" : symbol}`
                        : quoting
                          ? "Quoting…"
                          : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
                </Button>

                {order?.approval ? (
                  <p className="text-center text-[10.5px] text-ash-400">
                    One-time allowance for SwapRouter02, then the swap.
                  </p>
                ) : null}

                {err ? <p className="text-[11px] text-rose-500">{err}</p> : null}

                {hash ? (
                  <div className="rounded-[2px] border border-ink-700 bg-ink-850 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-ash-400">
                        {receipt.isLoading
                          ? "Confirming…"
                          : receipt.data?.status === "success"
                            ? "Confirmed"
                            : receipt.data
                              ? "Reverted"
                              : "Submitted"}
                      </span>
                      <TxLink hash={hash} />
                    </div>
                  </div>
                ) : null}
              </div>
            </Panel>

            {active ? (
              <Panel>
                <PanelHeader title="Pool" hint={`${active.symbol} / USDG`} />
                <div className="space-y-2 p-4">
                  {[
                    ["Stock token", <AddrLink key="t" addr={active.address} />],
                    ["Pool depth", <span key="d" className="tnum text-[12px] text-ash-100">{compact(active.depthUsdg)} USDG</span>],
                    ["Fee tier", <span key="f" className="tnum text-[12px] text-ash-100">{feeLabel(active.fee)}</span>],
                    order ? ["Pool address", <AddrLink key="p" addr={order.pool} />] : null,
                  ]
                    .filter(Boolean)
                    .map((row) => {
                      const [k, v] = row as [string, React.ReactNode];
                      return (
                        <div key={k} className="flex items-baseline justify-between gap-3">
                          <span className="text-[11.5px] text-ash-400">{k}</span>
                          {v}
                        </div>
                      );
                    })}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
