"use client";

import { Cat, paletteFrom } from "@/components/Cat";
import { useApi } from "@/lib/useApi";
import { pct, usd } from "@/lib/format";
import { SOCIAL } from "@/lib/brand";

type Standing = {
  id: string;
  name: string;
  color: string;
  equity: number;
  pnl: number;
  pnlPct: number;
  position: { symbol: string; qty: number } | null;
};
type Arena = { round: number; leaderboard: Standing[] };

/**
 * The embeddable leaderboard.
 *
 * Rendered without the app shell so it can be dropped into an iframe on any
 * site. Deliberately tiny and self-contained: the whole point is that someone
 * pastes it into a blog post and it keeps updating, with a link home.
 */
export default function EmbedPage() {
  const { data } = useApi<Arena>("/api/arena", 30_000);
  const board = data?.leaderboard ?? [];

  return (
    <div className="min-h-dvh bg-ink-950 p-3">
      <div className="mx-auto max-w-[420px]">
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="mb-2 flex items-center gap-2 hover:opacity-80"
        >
          <Cat size={20} />
          <span className="text-[13px] font-semibold text-ash-100">
            Agent<span className="text-flame-500">OS</span>
          </span>
          <span className="label ml-auto">
            {data ? `live · round ${data.round}` : "loading"}
          </span>
        </a>

        <div className="overflow-hidden rounded-[2px] border border-ink-700 bg-ink-900">
          {board.map((s, i) => (
            <a
              key={s.id}
              href={`/agent/${s.id}`}
              target="_blank"
              rel="noreferrer"
              className="relative flex items-center gap-2.5 border-b border-ink-800 px-3 py-2 last:border-0 hover:bg-ink-850"
            >
              <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: s.color }} />
              <span className="tnum w-4 shrink-0 text-[10px] text-ash-500">{i + 1}</span>
              <Cat size={18} palette={paletteFrom(s.color)} />
              <span className="flex-1 truncate text-[12px]" style={{ color: s.color }}>
                {s.name}
              </span>
              <span className="tnum text-[11px] text-ash-400">
                {s.position ? s.position.symbol : "flat"}
              </span>
              <span className="tnum w-16 text-right text-[12px] text-ash-100">{usd(s.equity)}</span>
              <span
                className={`tnum w-14 text-right text-[11px] ${
                  s.pnl >= 0 ? "text-mint-500" : "text-rose-500"
                }`}
              >
                {pct(s.pnlPct)}
              </span>
            </a>
          ))}
          {!board.length ? (
            <div className="px-3 py-6 text-center text-[11px] text-ash-400">loading…</div>
          ) : null}
        </div>

        <a
          href={SOCIAL.github}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 block text-center text-[10px] text-ash-500 hover:text-flame-500"
        >
          five agents trading tokenized stocks on Robinhood Chain
        </a>
      </div>
    </div>
  );
}
