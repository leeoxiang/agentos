"use client";

import { useAccount } from "wagmi";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { AddrLink, Badge, Empty, Loading, Panel, PanelHeader, Stat } from "@/components/ui";
import { compact, pct, qty, usd } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { ADDR } from "@/lib/chain";

type Balances = {
  account: string;
  gasEth: number;
  cashUsdg: number;
  vault: { shares: number; assetsUsdg: number };
  positions: Array<{
    symbol: string;
    name: string;
    sector: string;
    address: string;
    qty: number;
    price: number | null;
    valueUsdg: number | null;
  }>;
  totals: { equities: number; netWorthUsdg: number };
};

export default function WalletPage() {
  const { address, isConnected } = useAccount();
  const { data, error, loading } = useApi<Balances>(
    address ? `/api/balances?account=${address}` : null,
    20_000
  );

  const net = data?.totals.netWorthUsdg ?? 0;
  const alloc = data
    ? [
        { label: "Cash", value: data.cashUsdg, color: "bg-flame-500" },
        { label: "Earning", value: data.vault.assetsUsdg, color: "bg-mint-500" },
        { label: "Equities", value: data.totals.equities, color: "bg-gold-500" },
      ].filter((s) => s.value > 0)
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Agent wallet"
        title="Balances & positions"
        right={
          data ? (
            <div className="text-right">
              <div className="label">Net worth</div>
              <div className="tnum mt-1 text-[26px] leading-none text-ash-100">
                {usd(net)} <span className="text-[13px] text-flame-500">USDG</span>
              </div>
            </div>
          ) : null
        }
      >
        Everything your agent controls on Robinhood Chain: gas, USDG cash, the yield
        vault position, and every stock token held — marked to live pool prices.
      </PageHeader>

      <PageBody>
        {!isConnected ? (
          <Panel>
            <Empty>Connect a wallet to read its on-chain position.</Empty>
          </Panel>
        ) : error ? (
          <Panel>
            <Empty>
              <span className="text-rose-500">{error}</span>
            </Empty>
          </Panel>
        ) : (
          <div className="space-y-4">
            <Panel>
              <div className="grid divide-y divide-ink-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
                <Stat
                  label="USDG cash"
                  tone="flame"
                  value={loading && !data ? <Loading className="h-5 w-20" /> : usd(data?.cashUsdg)}
                  sub="Settlement asset · 6 decimals"
                />
                <Stat
                  label="Earning in vault"
                  tone="up"
                  value={loading && !data ? <Loading className="h-5 w-20" /> : usd(data?.vault.assetsUsdg)}
                  sub={data ? `${qty(data.vault.shares)} steakUSDG shares` : "ERC-4626"}
                />
                <Stat
                  label="Equities"
                  value={loading && !data ? <Loading className="h-5 w-20" /> : usd(data?.totals.equities)}
                  sub={data ? `${data.positions.length} stock token${data.positions.length === 1 ? "" : "s"}` : "—"}
                />
                <Stat
                  label="Gas"
                  value={loading && !data ? <Loading className="h-5 w-20" /> : qty(data?.gasEth)}
                  sub={
                    data && data.gasEth === 0
                      ? "No ETH — cannot submit transactions"
                      : "ETH on Robinhood Chain"
                  }
                  tone={data && data.gasEth === 0 ? "down" : "default"}
                />
              </div>

              {alloc.length > 1 ? (
                <div className="border-t border-ink-700 px-4 py-3">
                  <div className="flex h-1.5 overflow-hidden rounded-[2px] bg-ink-800">
                    {alloc.map((s) => (
                      <div
                        key={s.label}
                        className={s.color}
                        style={{ width: `${(s.value / net) * 100}%` }}
                        title={`${s.label}: ${usd(s.value)} USDG`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {alloc.map((s) => (
                      <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-ash-400">
                        <span className={`h-1.5 w-1.5 ${s.color}`} />
                        {s.label} {((s.value / net) * 100).toFixed(1)}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel>
              <PanelHeader
                title="Stock token positions"
                hint="Marked against the deepest live USDG pool for each ticker"
                right={
                  data ? <Badge tone="flame">{data.positions.length} held</Badge> : null
                }
              />
              {loading && !data ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Loading key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : !data?.positions.length ? (
                <Empty>
                  No stock tokens yet. Head to <span className="text-flame-500">Swap</span> to buy
                  your first position with USDG.
                </Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className="border-b border-ink-700">
                        {["Ticker", "Sector", "Quantity", "Price", "Value", "Token"].map((h, i) => (
                          <th
                            key={h}
                            className={`label px-4 py-2 font-normal ${i >= 2 ? "text-right" : ""}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.positions.map((p) => (
                        <tr key={p.address} className="border-b border-ink-800 last:border-0 hover:bg-ink-850">
                          <td className="px-4 py-2.5">
                            <div className="text-[13px] font-medium text-ash-100">{p.symbol}</div>
                            <div className="truncate text-[10.5px] text-ash-400">{p.name}</div>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge>{p.sector}</Badge>
                          </td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-200">
                            {qty(p.qty)}
                          </td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-200">
                            {usd(p.price)}
                          </td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-flame-500">
                            {usd(p.valueUsdg)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <AddrLink addr={p.address} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Contracts" hint="Everything this wallet touches, on mainnet" />
              <div className="divide-y divide-ink-800">
                {[
                  { label: "USDG — Global Dollar", addr: ADDR.usdg, note: "Settlement · EIP-3009 + EIP-2612" },
                  { label: "steakUSDG vault", addr: ADDR.yieldVault, note: "ERC-4626 · asset = USDG" },
                  { label: "SwapRouter02", addr: ADDR.swapRouter, note: "Uniswap V3 execution" },
                  { label: "V3 Factory", addr: ADDR.v3Factory, note: "Pool discovery" },
                ].map((c) => (
                  <div key={c.addr} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-ash-200">{c.label}</div>
                      <div className="text-[10.5px] text-ash-400">{c.note}</div>
                    </div>
                    <AddrLink addr={c.addr} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </PageBody>
    </>
  );
}
