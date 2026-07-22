"use client";

import { useState } from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Cat, paletteFrom } from "@/components/Cat";
import { AddrLink, Badge, Button, Dot, Empty, Loading, Panel, PanelHeader, TxLink } from "@/components/ui";
import { ago, compact, pct, qty, usd } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { EquityCurve, type EquityPoint } from "@/components/EquityCurve";
import { PlayPanel, PlayerBoard } from "@/components/PlayPanel";
import { VideoPanel } from "@/components/VideoPanel";
import { useAccount } from "wagmi";

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
  readout: Record<string, number>;
  x402: { priceUsdg: number; status: string; reason?: string; nonce: string; payer: string; txHash?: string };
  txHash?: string;
  thin?: boolean;
};

type Arena = {
  round: number;
  startedAt: number;
  lastTickAt: number | null;
  flatRounds: number;
  startingBankroll: number;
  universe: string[];
  leaderboard: Standing[];
  feed: Entry[];
  curve: EquityPoint[];
  players: Array<{
    address: string;
    equity: number;
    pnl: number;
    pnlPct: number;
    position: { symbol: string; qty: number; avgCost: number } | null;
    trades: number;
    wins: number;
    losses: number;
  }>;
  news: {
    fetchedAt: number;
    verified: boolean;
    items: Array<{
      symbol: string;
      sentiment: number;
      headline: string;
      source: string;
      url: string;
      publishedAt: string;
      summary: string;
    }>;
  };
  config: {
    durableState: boolean;
    receiverConfigured: boolean;
    facilitatorArmed: boolean;
    commentaryEnabled: boolean;
    defaultSeed: boolean;
    liveTrading: boolean;
  };
};

export default function ArenaPage() {
  const { address } = useAccount();
  const { data, loading, refresh } = useApi<Arena>("/api/arena", 20_000);
  const [focus, setFocus] = useState<string | null>(null);

  // Rounds are driven server-side by the cron in vercel.json, so the arena runs
  // around the clock whether or not anyone has the page open. The client-side
  // ticker that used to live here was never reachable — its flag started false
  // and only the (now removed) reset button ever touched the setter — and had it
  // run, every open tab would have been POSTing a model-calling endpoint on a
  // timer. The page is a viewer; it polls and renders, it does not drive.

  const board = data?.leaderboard ?? [];
  const feed = (data?.feed ?? []).filter((e) => !focus || e.agentId === focus);
  const best = board[0];
  const worst = board[board.length - 1];
  const spread = best && worst ? best.equity - worst.equity : 0;

  return (
    <>
      <PageHeader
        eyebrow="Live competition"
        title="Agent arena"
        right={
          <div className="flex items-center gap-2.5 rounded-[2px] border border-mint-500/30 bg-mint-500/8 px-3 py-2">
            <Dot tone="up" pulse />
            <div className="leading-none">
              <div className="text-[12px] font-medium text-mint-500">Running live</div>
              <div className="tnum mt-1 text-[10.5px] text-ash-400">
                {data?.lastTickAt ? `round ${data.round} · ${ago(data.lastTickAt)}` : "starting…"}
              </div>
            </div>
          </div>
        }
      >
        Five agents, one market, five incompatible theses. This runs continuously —
        a round fires every minute whether anyone is watching or not. Each agent pays
        for its own market data over x402 before it may act, reads the same headlines,
        and trades a 1,000 USDG book against live Robinhood Chain prices.
      </PageHeader>

      <PageBody>
        {/* Status strip — states plainly which parts are live. */}
        {data ? (
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[2px] border border-ink-700 bg-ink-900 px-4 py-2.5">
            <span className="flex items-center gap-2">
              <Dot tone="up" pulse />
              <span className="text-[12px] text-ash-200">Round every 60s, around the clock</span>
            </span>
            <Meta label="Round" value={String(data.round)} />
            <Meta label="Last" value={ago(data.lastTickAt)} />
            <Meta label="1st vs 5th" value={`${usd(spread)} USDG`} />
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Badge tone={data.config.receiverConfigured ? "up" : "gold"}>
                x402 {data.config.receiverConfigured ? "enforced" : "unconfigured"}
              </Badge>
              <Badge tone={data.config.liveTrading ? "up" : "neutral"}>
                {data.config.liveTrading ? "trading on-chain" : "paper book"}
              </Badge>
              <Badge tone={data.config.facilitatorArmed ? "up" : "neutral"}>
                {data.config.facilitatorArmed ? "settling" : "verify-only"}
              </Badge>
              <Badge tone={data.config.durableState ? "up" : "neutral"}>
                {data.config.durableState ? "durable" : "in-memory"}
              </Badge>
              <Badge tone={data.config.commentaryEnabled ? "flame" : "neutral"}>
                {data.config.commentaryEnabled ? "commentary on" : "commentary off"}
              </Badge>
            </div>
          </div>
        ) : null}

        {/* Leaderboard */}
        <div className="mb-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
          {loading && !data
            ? [0, 1, 2, 3, 4].map((i) => <Loading key={i} className="h-[188px] w-full" />)
            : board.map((s, rank) => (
                <AgentCard
                  key={s.id}
                  s={s}
                  rank={rank}
                  starting={data!.startingBankroll}
                  active={focus === s.id}
                  onClick={() => setFocus(focus === s.id ? null : s.id)}
                />
              ))}
        </div>

        <VideoPanel />

        {data?.news?.items?.length ? (
          <Panel className="mb-4">
            <PanelHeader
              title="The tape everyone is reading"
              hint="Live headlines. Every agent sees these — they just disagree about what they mean."
              right={
                <div className="flex items-center gap-1.5">
                  <Badge tone={data.news.verified ? "up" : "gold"}>
                    {data.news.verified ? "web-searched" : "unverified"}
                  </Badge>
                  <Badge tone="neutral">fetched {ago(data.news.fetchedAt)}</Badge>
                </div>
              }
            />
            <div className="divide-y divide-ink-800">
              {data.news.items.map((n) => {
                const tone =
                  n.sentiment >= 0.2 ? "up" : n.sentiment <= -0.2 ? "down" : "neutral";
                const label =
                  n.sentiment >= 0.2 ? "bullish" : n.sentiment <= -0.2 ? "bearish" : "neutral";
                return (
                  <div key={n.symbol} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3">
                    <span className="tnum w-12 shrink-0 text-[13px] font-medium text-ash-100">
                      {n.symbol}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12.5px] leading-snug text-ash-200 underline decoration-ink-600 underline-offset-2 hover:text-flame-500 hover:decoration-flame-500"
                      >
                        {n.headline}
                      </a>
                      <div className="mt-1 text-[11px] leading-snug text-ash-400">{n.summary}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-ash-500">
                        <span>{n.source}</span>
                        <span>·</span>
                        <span>{ago(Date.parse(n.publishedAt))}</span>
                        <span>·</span>
                        <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-flame-500">
                          verify ↗
                        </a>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={tone as "up" | "down" | "neutral"}>{label}</Badge>
                      <span
                        className={`tnum text-[11px] ${
                          n.sentiment > 0 ? "text-mint-500" : n.sentiment < 0 ? "text-rose-500" : "text-ash-400"
                        }`}
                      >
                        {n.sentiment >= 0 ? "+" : ""}
                        {n.sentiment.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-ink-700 px-4 py-2.5 text-[10.5px] leading-snug text-ash-400">
              Every headline is fetched by live web search and carries its own source link and
              publish date — click through to verify any of them. Items without a resolvable URL,
              or older than 72 hours, are dropped rather than shown. Each agent weights the news
              differently: Momo leans into a catalyst, Vega fades the same story, and a headline
              that contradicts a signal strongly enough cancels the trade outright.
            </div>
          </Panel>
        ) : null}

        {data && data.curve?.length > 1 ? (
          <Panel className="mb-4">
            <PanelHeader
              title="Equity curves"
              hint={`Every agent's book value, sampled once per round. Dashed line is the ${usd(data.startingBankroll)} USDG start.`}
              right={
                focus ? (
                  <Badge tone="neutral">
                    highlighting {board.find((b) => b.id === focus)?.name}
                  </Badge>
                ) : null
              }
            />
            <div className="px-3 pb-3 pt-4">
              <EquityCurve
                curve={data.curve}
                agents={board.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
                starting={data.startingBankroll}
                highlight={focus}
              />
            </div>
          </Panel>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Panel>
            <PanelHeader
              title="Live feed"
              hint={focus ? `Filtered to ${board.find((b) => b.id === focus)?.name}` : "Every decision, newest first"}
              right={
                focus ? (
                  <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
                    Clear filter
                  </Button>
                ) : null
              }
            />
            {!feed.length ? (
              <Empty>
                Nothing yet. Hit <span className="text-flame-500">Start</span> and the agents begin
                paying for data and taking sides.
              </Empty>
            ) : (
              <div className="max-h-[620px] overflow-y-auto overflow-x-hidden">
                {feed.map((e) => (
                  <FeedRow key={e.id} e={e} agent={board.find((b) => b.id === e.agentId)} />
                ))}
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <PlayPanel
              players={data?.players ?? []}
              universe={data?.universe ?? []}
              onChanged={refresh}
            />

            <PlayerBoard players={data?.players ?? []} you={address} />

            <Panel>
              <PanelHeader title="How a round runs" />
              <ol className="divide-y divide-ink-800">
                {[
                  ["Screen", "The universe is ranked by real traded volume — only tickers with actual flow."],
                  ["Pay", "Each agent signs an EIP-3009 authorization over USDG for the 0.001 quote. Real signature, real on-chain nonce and balance checks."],
                  ["Decide", "Each strategy reads a different signal out of real swap-event prices — trend, range, breakout, depth, volatility — plus the same headlines."],
                  ["Fill", "Paper book, real price: the pool's own fee tier is charged against every fill."],
                  ["Talk", "Commentary is written after the fact. The strategies decide; the model only narrates."],
                ].map(([t, b], i) => (
                  <li key={t} className="flex gap-3 px-4 py-3">
                    <span className="tnum mt-0.5 text-[11px] text-flame-500">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="text-[12.5px] font-medium text-ash-100">{t}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-ash-400">{b}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>

            {data && !data.config.receiverConfigured ? (
              <Panel className="border-gold-500/30">
                <PanelHeader title="Payments not enforced" />
                <p className="px-4 py-3 text-[11.5px] leading-relaxed text-ash-400">
                  <code className="font-mono text-flame-400">NEXT_PUBLIC_PAY_TO</code> is unset, so
                  every agent&rsquo;s x402 charge is rejected before verification and they all trade
                  without paying. Set a receiver to make the meter real.
                </p>
              </Panel>
            ) : null}

            {data && data.config.defaultSeed ? (
              <Panel>
                <PanelHeader title="Agent wallets" hint="Deterministic from ARENA_SEED" />
                <div className="space-y-1.5 px-4 py-3">
                  {board.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px]" style={{ color: s.color }}>
                        {s.name}
                      </span>
                      <AddrLink addr={s.address} />
                    </div>
                  ))}
                  <p className="pt-2 text-[10.5px] leading-relaxed text-ash-400">
                    Public demo seed — these sign real authorizations but hold no USDG, so payments
                    verify and stop at <span className="font-mono">insufficient_funds</span>. Set{" "}
                    <code className="font-mono text-flame-400">ARENA_SEED</code> and fund them to
                    settle for real.
                  </p>
                </div>
              </Panel>
            ) : null}

          </div>
        </div>
      </PageBody>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className="tnum text-[12px] text-ash-100">{value}</span>
    </span>
  );
}

const MEDALS = ["01", "02", "03", "04", "05"];

function AgentCard({
  s,
  rank,
  starting,
  active,
  onClick,
}: {
  s: Standing;
  rank: number;
  starting: number;
  active: boolean;
  onClick: () => void;
}) {
  const up = s.pnl >= 0;
  // Bar is centred on the starting bankroll: right of centre is profit.
  const swing = Math.min(1, Math.abs(s.pnl) / (starting * 0.05));

  return (
    <button
      onClick={onClick}
      className={`relative overflow-hidden rounded-[2px] border bg-ink-900 p-3.5 text-left transition-colors ${
        active ? "border-ash-400" : "border-ink-700 hover:border-ink-600"
      }`}
    >
      <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: s.color }} />

      <div className="flex items-start gap-2.5">
        <Cat size={34} palette={paletteFrom(s.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="tnum text-[10px] text-ash-500">{MEDALS[rank]}</span>
            <span className="truncate text-[13.5px] font-semibold text-ash-100">{s.name}</span>
          </div>
          <div className="truncate font-mono text-[10px] text-ash-400">{s.handle}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="tnum text-[19px] leading-none text-ash-100">{usd(s.equity)}</div>
        <div className={`tnum mt-1 text-[11.5px] ${up ? "text-mint-500" : "text-rose-500"}`}>
          {up ? "+" : ""}
          {usd(s.pnl)} · {pct(s.pnlPct)}
        </div>
      </div>

      <div className="mt-2.5 flex h-1 overflow-hidden rounded-[1px] bg-ink-800">
        <div className="flex w-1/2 justify-end">
          {!up ? <div className="bg-rose-500" style={{ width: `${swing * 100}%` }} /> : null}
        </div>
        <div className="w-1/2">
          {up ? <div className="h-full bg-mint-500" style={{ width: `${swing * 100}%` }} /> : null}
        </div>
      </div>

      <div className="mt-3 space-y-1 border-t border-ink-800 pt-2.5">
        <Row k="Position" v={s.position ? `${qty(s.position.qty)} ${s.position.symbol}` : "flat"} />
        <Row k="Trades" v={`${s.trades} · ${s.wins}W ${s.losses}L`} />
        <Row k="x402 spend" v={`${s.x402SpentUsdg.toFixed(3)} (${s.x402Calls})`} />
      </div>

      <p className="mt-2.5 line-clamp-2 text-[10.5px] leading-snug text-ash-400">{s.style} — {s.thesis}</p>

      <Link
        href={`/agent/${s.id}`}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 block font-mono text-[10px] uppercase tracking-wider text-ash-500 hover:text-flame-500"
      >
        full record →
      </Link>
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10.5px] text-ash-400">{k}</span>
      <span className="tnum text-[11px] text-ash-200">{v}</span>
    </div>
  );
}

function FeedRow({ e, agent }: { e: Entry; agent?: Standing }) {
  const color = agent?.color ?? "#8f8f9d";
  const tone = e.action === "buy" ? "up" : e.action === "sell" ? "down" : "neutral";
  const paidTone =
    e.x402.status === "settled"
      ? "up"
      : e.x402.status === "verified"
        ? "flame"
        : e.x402.status === "unfunded"
          ? "gold"
          : "down";

  return (
    <div className="animate-rise flex min-w-0 gap-3 overflow-hidden border-b border-ink-800 px-4 py-3 last:border-0">
      <div className="shrink-0 pt-0.5">
        <Cat size={26} palette={paletteFrom(color)} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12.5px] font-medium" style={{ color }}>
            {agent?.name ?? e.agentId}
          </span>
          <Badge tone={tone as "up" | "down" | "neutral"}>{e.action}</Badge>
          <span className="tnum text-[12px] text-ash-100">{e.symbol}</span>
          <span className="tnum text-[11px] text-ash-400">@ {usd(e.price)}</span>
          {e.notional > 0 ? (
            <span className="tnum text-[11px] text-flame-500">
              {qty(e.qty)} for {usd(e.notional)} USDG
            </span>
          ) : null}
          <span className="tnum ml-auto text-[10px] text-ash-500">r{e.round}</span>
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
          {e.conviction > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="label">conv</span>
              <span className="inline-block h-1 w-10 overflow-hidden rounded-[1px] bg-ink-700">
                <span
                  className="block h-full"
                  style={{ width: `${e.conviction * 100}%`, background: color }}
                />
              </span>
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
          <Badge tone={paidTone as "up" | "flame" | "gold" | "down"}>
            x402 {e.x402.priceUsdg} · {e.x402.status}
          </Badge>
          {e.x402.reason ? (
            <span className="min-w-0 max-w-full break-words font-mono text-[10px] leading-snug text-ash-500">
              {e.x402.reason}
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-ash-500">
            nonce {e.x402.nonce.slice(0, 10)}…
          </span>
          {e.x402.txHash ? <TxLink hash={e.x402.txHash} /> : null}
          {e.thin ? <Badge tone="gold">thin</Badge> : null}
          {e.txHash ? (
            <span className="flex items-center gap-1">
              <Badge tone="up">on-chain</Badge>
              <TxLink hash={e.txHash} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
