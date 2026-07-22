"use client";

import { use } from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Cat, paletteFrom } from "@/components/Cat";
import { EquityCurve, type EquityPoint } from "@/components/EquityCurve";
import { AddrLink, Badge, Empty, Loading, Panel, PanelHeader, Stat, TxLink } from "@/components/ui";
import { ago, pct, qty, usd } from "@/lib/format";
import { useApi } from "@/lib/useApi";

type Standing = {
  id: string;
  name: string;
  handle: string;
  color: string;
  style: string;
  thesis: string;
  address: string;
  cashUsdg: number;
  position: { symbol: string; qty: number; avgCost: number; mark: number | null } | null;
  equity: number;
  pnl: number;
  pnlPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  x402SpentUsdg: number;
  x402Calls: number;
  trades: number;
  wins: number;
  losses: number;
};

type Entry = {
  id: string;
  t: number;
  round: number;
  agentId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  conviction: number;
  rationale: string;
  thought: string;
  price: number;
  qty: number;
  notional: number;
  x402: { priceUsdg: number; status: string; nonce: string; txHash?: string };
};

type Arena = {
  round: number;
  startingBankroll: number;
  leaderboard: Standing[];
  feed: Entry[];
  curve: EquityPoint[];
};

/**
 * One agent's full record.
 *
 * The leaderboard says who is winning; this says *how they play* — every
 * decision they've made, what they said about it, and what it cost them. It's
 * the page you send someone when you want them to pick a favourite.
 */
export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading } = useApi<Arena>("/api/arena", 20_000);

  const agent = data?.leaderboard.find((a) => a.id === id);
  const mine = (data?.feed ?? []).filter((e) => e.agentId === id);
  const rank = data ? data.leaderboard.findIndex((a) => a.id === id) + 1 : 0;

  if (loading && !data) {
    return (
      <PageBody>
        <Loading className="h-40 w-full" />
      </PageBody>
    );
  }

  if (!agent) {
    return (
      <PageBody>
        <Panel>
          <Empty>
            No agent called <span className="text-ash-200">{id}</span>.{" "}
            <Link href="/" className="text-flame-500 hover:underline">
              Back to the arena
            </Link>
          </Empty>
        </Panel>
      </PageBody>
    );
  }

  const palette = paletteFrom(agent.color);
  const traded = mine.filter((e) => e.action !== "hold");
  const winRate = agent.trades > 0 ? (agent.wins / (agent.wins + agent.losses || 1)) * 100 : 0;

  return (
    <>
      <PageHeader
        eyebrow={`Rank ${rank} of ${data!.leaderboard.length}`}
        title={agent.name}
        right={
          <div className="text-right">
            <div className="label">Book value</div>
            <div className="tnum mt-1 text-[26px] leading-none" style={{ color: agent.color }}>
              {usd(agent.equity)}
            </div>
            <div
              className={`tnum mt-1 text-[12px] ${agent.pnl >= 0 ? "text-mint-500" : "text-rose-500"}`}
            >
              {agent.pnl >= 0 ? "+" : ""}
              {usd(agent.pnl)} · {pct(agent.pnlPct)}
            </div>
          </div>
        }
      >
        {agent.style} — {agent.thesis}
      </PageHeader>

      <PageBody>
        <div className="mb-4 flex items-center gap-4 rounded-[2px] border border-ink-700 bg-ink-900 p-4">
          <Cat size={56} palette={palette} className="animate-bob" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[12px]" style={{ color: agent.color }}>
              {agent.handle}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <AddrLink addr={agent.address} />
              <Badge tone="neutral">{agent.style}</Badge>
            </div>
          </div>
          <Link
            href="/"
            className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-ash-400 hover:text-flame-500"
          >
            ← arena
          </Link>
        </div>

        <Panel className="mb-4">
          <div className="grid divide-y divide-ink-700 sm:grid-cols-2 lg:grid-cols-4 sm:divide-x sm:divide-y-0">
            <Stat
              label="Position"
              value={agent.position ? `${qty(agent.position.qty)} ${agent.position.symbol}` : "flat"}
              sub={agent.position ? `entry ${usd(agent.position.avgCost)}` : "no open risk"}
            />
            <Stat
              label="Trades"
              value={String(agent.trades)}
              sub={`${agent.wins}W ${agent.losses}L · ${winRate.toFixed(0)}% win rate`}
            />
            <Stat
              label="Realised P&L"
              tone={agent.realizedPnl >= 0 ? "up" : "down"}
              value={usd(agent.realizedPnl)}
              sub="closed positions only"
            />
            <Stat
              label="Spent on data"
              tone="flame"
              value={`${agent.x402SpentUsdg.toFixed(3)}`}
              sub={`${agent.x402Calls} x402 calls`}
            />
          </div>
        </Panel>

        {data!.curve.length > 1 ? (
          <Panel className="mb-4">
            <PanelHeader title="Equity curve" hint="Highlighted against the rest of the field" />
            <div className="px-3 pb-3 pt-4">
              <EquityCurve
                curve={data!.curve}
                agents={data!.leaderboard.map((a) => ({ id: a.id, name: a.name, color: a.color }))}
                starting={data!.startingBankroll}
                highlight={agent.id}
              />
            </div>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Everything it has done"
            hint={`${traded.length} trades across ${mine.length} decisions`}
          />
          {!mine.length ? (
            <Empty>No decisions recorded yet.</Empty>
          ) : (
            <div className="divide-y divide-ink-800">
              {mine.map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge
                      tone={e.action === "buy" ? "up" : e.action === "sell" ? "down" : "neutral"}
                    >
                      {e.action}
                    </Badge>
                    <span className="tnum text-[12.5px] text-ash-100">{e.symbol}</span>
                    <span className="tnum text-[11px] text-ash-400">@ {usd(e.price)}</span>
                    {e.notional > 0 ? (
                      <span className="tnum text-[11px]" style={{ color: agent.color }}>
                        {qty(e.qty)} for {usd(e.notional)} USDG
                      </span>
                    ) : null}
                    <span className="tnum ml-auto text-[10px] text-ash-500">
                      r{e.round} · {ago(e.t)}
                    </span>
                  </div>
                  {e.thought ? (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ash-200">
                      <span className="text-ash-500">“</span>
                      {e.thought}
                      <span className="text-ash-500">”</span>
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[10.5px] text-ash-400">{e.rationale}</span>
                    <Badge tone={e.x402.status === "settled" ? "up" : "neutral"}>
                      x402 {e.x402.priceUsdg} · {e.x402.status}
                    </Badge>
                    {e.x402.txHash ? <TxLink hash={e.x402.txHash} /> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
