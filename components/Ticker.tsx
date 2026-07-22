"use client";

import Link from "next/link";
import { Cat, paletteFrom } from "./Cat";
import { useApi } from "@/lib/useApi";
import { ago, usd } from "@/lib/format";

type Row = {
  id: string;
  t: number;
  agentId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  price: number;
  notional: number;
};

type Feed = {
  round: number;
  leaderboard: Array<{ id: string; name: string; color: string }>;
  feed: Row[];
};

/**
 * A thin always-present strip of what the agents just did.
 *
 * The arena is the most alive thing on the site, but it only lives on one page.
 * Surfacing the last few actions everywhere makes the whole product feel like a
 * running system rather than a set of static tools.
 *
 * Shows only real trades — a scroll of "held, held, held" is noise, and on a
 * quiet market that would be most of it.
 */
export function Ticker() {
  const { data } = useApi<Feed>("/api/arena", 25_000);

  const trades = (data?.feed ?? []).filter((r) => r.action !== "hold").slice(0, 12);
  if (!trades.length) return null;

  const agents = Object.fromEntries((data?.leaderboard ?? []).map((a) => [a.id, a]));

  return (
    <Link
      href="/"
      className="group flex h-8 shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900/80 px-4 backdrop-blur hover:bg-ink-850"
      title="Open the arena"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-mint-500" />
        <span className="label group-hover:text-ash-300">live</span>
      </span>

      {/* Overflow is hidden rather than scrollable: this is ambient, and a
          horizontally scrolling strip in a fixed header is a usability trap. */}
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {trades.map((r) => {
          const a = agents[r.agentId];
          const color = a?.color ?? "#8f8f9d";
          return (
            <span key={r.id} className="flex shrink-0 items-center gap-1.5 text-[11px]">
              <Cat size={13} palette={paletteFrom(color)} />
              <span style={{ color }}>{a?.name ?? r.agentId}</span>
              <span className={r.action === "buy" ? "text-mint-500" : "text-rose-500"}>
                {r.action}
              </span>
              <span className="tnum text-ash-200">{r.symbol}</span>
              <span className="tnum text-ash-400">{usd(r.price)}</span>
              {r.notional > 0 ? (
                <span className="tnum text-ash-500">· {usd(r.notional)} USDG</span>
              ) : null}
              <span className="text-ash-500">· {ago(r.t)}</span>
            </span>
          );
        })}
      </div>

      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ash-500 group-hover:text-flame-500">
        round {data?.round ?? 0} →
      </span>
    </Link>
  );
}
