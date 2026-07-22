"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Identicon, identiconColor } from "./Identicon";
import { Badge, Button, Empty, Input, Panel, PanelHeader } from "./ui";
import { pct, qty, short, usd } from "@/lib/format";

type Player = {
  address: string;
  equity: number;
  pnl: number;
  pnlPct: number;
  position: { symbol: string; qty: number; avgCost: number } | null;
  trades: number;
  wins: number;
  losses: number;
};

/**
 * Play against the agents.
 *
 * Same 1,000 USDG book, same live prices, same fee tiers, same leaderboard.
 * Connecting is read-only — no signature is requested and nothing is spent —
 * because asking someone to sign a transaction to enter a leaderboard game
 * teaches a habit that gets people drained elsewhere.
 */
export function PlayPanel({
  players,
  universe,
  onChanged,
}: {
  players: Player[];
  universe: string[];
  onChanged: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("100");
  const [symbol, setSymbol] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const me = address ? players.find((p) => p.address.toLowerCase() === address.toLowerCase()) : undefined;

  useEffect(() => {
    if (!symbol && universe.length) setSymbol(universe[0]);
  }, [universe, symbol]);

  async function call(action: "join" | "trade", extra: Record<string, unknown> = {}) {
    if (!address) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/arena/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, address, ...extra }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");

      if (action === "join") setMsg({ kind: "ok", text: "You're in. 1,000 USDG paper book." });
      else if (body.fill)
        setMsg({
          kind: "ok",
          text: `${body.fill.side === "buy" ? "Bought" : "Sold"} ${qty(body.fill.qty)} ${body.fill.symbol} @ ${usd(body.fill.price)}`,
        });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <Panel>
        <PanelHeader title="Beat the agents" hint="Same book, same prices, same leaderboard" />
        <Empty>
          Connect a wallet to get a 1,000 USDG paper book and a slot on the leaderboard.
          <div className="mt-1.5 text-[10.5px] text-ash-500">
            Read-only — no signature, nothing spent.
          </div>
        </Empty>
      </Panel>
    );
  }

  if (!me) {
    return (
      <Panel>
        <PanelHeader title="Beat the agents" hint="Same book, same prices, same leaderboard" />
        <div className="flex flex-col items-center gap-3 px-4 py-6">
          <Identicon seed={address!} size={52} title="Your avatar" />
          <div className="text-center">
            <div className="tnum text-[12px] text-ash-200">{short(address, 6)}</div>
            <div className="mt-1 text-[11px] text-ash-400">
              This is your avatar. Nobody else gets it.
            </div>
          </div>
          <Button className="w-full" disabled={busy} onClick={() => call("join")}>
            {busy ? "Joining…" : "Join with 1,000 USDG"}
          </Button>
        </div>
      </Panel>
    );
  }

  const up = me.pnl >= 0;

  return (
    <Panel>
      <PanelHeader
        title="Your book"
        hint={`${me.trades} trades · ${me.wins}W ${me.losses}L`}
        right={<Badge tone={up ? "up" : "down"}>{pct(me.pnlPct)}</Badge>}
      />

      <div className="flex items-center gap-3 border-b border-ink-800 px-4 py-3">
        <Identicon seed={me.address} size={40} />
        <div className="min-w-0 flex-1">
          <div className="tnum text-[19px] leading-none text-ash-100">{usd(me.equity)}</div>
          <div className={`tnum mt-1 text-[11.5px] ${up ? "text-mint-500" : "text-rose-500"}`}>
            {up ? "+" : ""}
            {usd(me.pnl)} USDG
          </div>
        </div>
        <div className="text-right">
          <div className="label">Position</div>
          <div className="tnum mt-1 text-[12px] text-ash-200">
            {me.position ? `${qty(me.position.qty)} ${me.position.symbol}` : "flat"}
          </div>
        </div>
      </div>

      <div className="space-y-2.5 p-4">
        <div className="flex gap-1.5">
          {universe.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`h-8 flex-1 rounded-[2px] border text-[11.5px] transition-colors ${
                symbol === s
                  ? "border-flame-500 text-flame-500"
                  : "border-ink-600 text-ash-400 hover:text-ash-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div>
          <label className="label mb-1.5 block">
            {me.position ? "Sell closes the whole position" : "USDG to spend"}
          </label>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            disabled={!!me.position}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            disabled={busy || !!me.position}
            onClick={() => call("trade", { symbol, side: "buy", amount: Number(amount) })}
          >
            Buy {symbol}
          </Button>
          <Button
            variant="danger"
            disabled={busy || !me.position}
            onClick={() =>
              call("trade", { symbol: me.position!.symbol, side: "sell", amount: me.position!.qty })
            }
          >
            Sell {me.position?.symbol ?? ""}
          </Button>
        </div>

        {msg ? (
          <p className={`text-[11.5px] ${msg.kind === "ok" ? "text-mint-500" : "text-rose-500"}`}>
            {msg.text}
          </p>
        ) : null}

        <p className="text-[10.5px] leading-snug text-ash-400">
          Paper book, real prices — filled at the live pool price and charged the pool&rsquo;s
          actual fee tier, exactly like the agents.
        </p>
      </div>
    </Panel>
  );
}

/** Human leaderboard, shown beside the agents'. */
export function PlayerBoard({ players, you }: { players: Player[]; you?: string }) {
  if (!players.length) {
    return (
      <Panel>
        <PanelHeader title="Humans" hint="Nobody has taken them on yet" />
        <Empty>Be the first to join.</Empty>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Humans" hint={`${players.length} playing`} />
      <div className="max-h-[280px] divide-y divide-ink-800 overflow-y-auto">
        {players.map((p, i) => {
          const mine = you && p.address.toLowerCase() === you.toLowerCase();
          return (
            <div
              key={p.address}
              className={`relative flex items-center gap-2.5 px-4 py-2.5 ${mine ? "bg-ink-850" : ""}`}
            >
              {mine ? (
                <span
                  className="absolute left-0 top-0 h-full w-[2px]"
                  style={{ background: identiconColor(p.address.toLowerCase()) }}
                />
              ) : null}
              <span className="tnum w-4 shrink-0 text-[10px] text-ash-500">{i + 1}</span>
              <Identicon seed={p.address} size={22} />
              <span className="tnum flex-1 truncate text-[11.5px] text-ash-200">
                {short(p.address, 4)}
                {mine ? <span className="ml-1.5 text-flame-500">you</span> : null}
              </span>
              <span className="tnum text-[11px] text-ash-400">
                {p.position ? p.position.symbol : "flat"}
              </span>
              <span className="tnum w-16 text-right text-[12px] text-ash-100">{usd(p.equity)}</span>
              <span
                className={`tnum w-14 text-right text-[11px] ${p.pnl >= 0 ? "text-mint-500" : "text-rose-500"}`}
              >
                {pct(p.pnlPct)}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
