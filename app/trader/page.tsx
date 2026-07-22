"use client";

import { useEffect, useRef, useState } from "react";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Badge, Button, Dot, Empty, Input, Loading, Panel, PanelHeader, Stat, TxLink } from "@/components/ui";
import { ago, pct, qty, usd } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { Policy, RunEntry, Sample } from "@/lib/trader/store";

type TraderState = {
  policy: Policy;
  armed: boolean;
  live: boolean;
  trader: string | null;
  ticks: number;
  lastTick: number | null;
  positions: Array<{
    symbol: string;
    qty: number;
    avgCost: number;
    price: number | null;
    value: number | null;
    cost: number;
    pnl: number | null;
    pnlPct: number | null;
  }>;
  log: RunEntry[];
  signals: Array<{
    symbol: string;
    action: "buy" | "sell" | "hold";
    reason: string;
    price: number;
    fast: number | null;
    slow: number | null;
    spreadBps: number | null;
  }>;
  samples: Record<string, Sample[]>;
};

export default function TraderPage() {
  const { data, loading, refresh } = useApi<TraderState>("/api/trader", 15_000);
  const [ticking, setTicking] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function tick() {
    if (ticking) return;
    setTicking(true);
    setErr(null);
    try {
      const res = await fetch("/api/trader/tick", { method: "POST" });
      const body = await res.json();
      if (!res.ok && !body.busy) throw new Error(body.error ?? "tick failed");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "tick failed");
    } finally {
      setTicking(false);
    }
  }

  // Auto-run drives the strategy from the browser. The server guards against
  // overlapping ticks, so a slow pass can never be re-entered by the timer.
  useEffect(() => {
    if (!auto) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    tick();
    timer.current = setInterval(tick, 20_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  async function patch(next: Partial<Policy>) {
    setErr(null);
    try {
      const res = await fetch("/api/trader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "update failed");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "update failed");
    }
  }

  const equity = data?.positions.reduce((n, p) => n + (p.value ?? 0), 0) ?? 0;
  const pnl = data?.positions.reduce((n, p) => n + (p.pnl ?? 0), 0) ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Autonomous agent"
        title="Momentum trader"
        right={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="md" disabled={ticking} onClick={tick}>
              {ticking ? "Running…" : "Run one tick"}
            </Button>
            <Button variant={auto ? "danger" : "primary"} size="md" onClick={() => setAuto((a) => !a)}>
              {auto ? "Stop loop" : "Start loop"}
            </Button>
          </div>
        }
      >
        A dual-moving-average strategy over live pool prices, with stop-loss, take-profit
        and an exposure cap. Every action routes through the same order builder the
        paid x402 endpoint serves — dry runs and live fills differ only in whether the
        transaction is broadcast.
      </PageHeader>

      <PageBody>
        {err ? (
          <div className="mb-4 rounded-[2px] border border-rose-500/40 bg-rose-500/8 px-3.5 py-2.5 text-[12px] text-rose-500">
            {err}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Panel>
              <div className="grid divide-y divide-ink-700 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <Stat
                  label="Mode"
                  tone={data?.live ? "up" : "flame"}
                  value={
                    loading && !data ? (
                      <Loading className="h-5 w-20" />
                    ) : (
                      <span className="flex items-center gap-2">
                        <Dot tone={data?.live ? "up" : "flame"} pulse={auto} />
                        {data?.live ? "LIVE" : "DRY RUN"}
                      </span>
                    )
                  }
                  sub={data?.armed ? `Signer ${data.trader?.slice(0, 10)}…` : "No signer configured"}
                />
                <Stat
                  label="Book value"
                  value={loading && !data ? <Loading className="h-5 w-20" /> : `${usd(equity)}`}
                  sub={`${data?.positions.length ?? 0} open position${data?.positions.length === 1 ? "" : "s"}`}
                />
                <Stat
                  label="Unrealised P&L"
                  tone={pnl >= 0 ? "up" : "down"}
                  value={loading && !data ? <Loading className="h-5 w-20" /> : `${pnl >= 0 ? "+" : ""}${usd(pnl)}`}
                  sub="USDG, marked to pool"
                />
                <Stat
                  label="Ticks run"
                  value={loading && !data ? <Loading className="h-5 w-12" /> : String(data?.ticks ?? 0)}
                  sub={ago(data?.lastTick)}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Signals"
                hint="Recomputed every tick from live pool prices"
                right={<Badge tone="flame">SMA {data?.policy.fastPeriod}/{data?.policy.slowPeriod}</Badge>}
              />
              {!data?.signals.length ? (
                <Empty>Run a tick to sample prices.</Empty>
              ) : (
                <div className="divide-y divide-ink-800">
                  {data.signals.map((s) => {
                    const series = data.samples[s.symbol] ?? [];
                    return (
                      <div key={s.symbol} className="flex items-center gap-4 px-4 py-3">
                        <div className="w-16 shrink-0">
                          <div className="text-[13px] font-medium text-ash-100">{s.symbol}</div>
                          <div className="tnum text-[10.5px] text-ash-400">{usd(s.price)}</div>
                        </div>
                        <Spark points={series} />
                        <div className="w-[52px] shrink-0 text-right">
                          <Badge
                            tone={s.action === "buy" ? "up" : s.action === "sell" ? "down" : "neutral"}
                          >
                            {s.action}
                          </Badge>
                        </div>
                        <div className="hidden min-w-0 flex-1 text-right text-[11px] text-ash-400 sm:block">
                          <span className="line-clamp-1">{s.reason}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Positions" hint="The agent's own ledger, marked to live prices" />
              {!data?.positions.length ? (
                <Empty>Flat. The strategy opens a position when momentum clears the band.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left">
                    <thead>
                      <tr className="border-b border-ink-700">
                        {["Ticker", "Qty", "Avg cost", "Mark", "Value", "P&L"].map((h, i) => (
                          <th key={h} className={`label px-4 py-2 font-normal ${i > 0 ? "text-right" : ""}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.positions.map((p) => (
                        <tr key={p.symbol} className="border-b border-ink-800 last:border-0">
                          <td className="px-4 py-2.5 text-[13px] font-medium text-ash-100">{p.symbol}</td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-200">{qty(p.qty)}</td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-300">{usd(p.avgCost)}</td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-200">{usd(p.price)}</td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ash-100">{usd(p.value)}</td>
                          <td
                            className={`tnum px-4 py-2.5 text-right text-[12.5px] ${
                              (p.pnl ?? 0) >= 0 ? "text-mint-500" : "text-rose-500"
                            }`}
                          >
                            {usd(p.pnl)} <span className="text-[10.5px]">({pct(p.pnlPct)})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Run log" hint="Newest first" />
              {!data?.log.length ? (
                <Empty>Nothing yet.</Empty>
              ) : (
                <div className="max-h-[320px] divide-y divide-ink-800 overflow-y-auto">
                  {data.log.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="tnum w-14 shrink-0 pt-0.5 text-[10.5px] text-ash-400">
                        {new Date(e.t).toLocaleTimeString("en-US", { hour12: false })}
                      </span>
                      <span className="w-12 shrink-0">
                        <Badge
                          tone={
                            e.action === "buy"
                              ? "up"
                              : e.action === "sell"
                                ? "down"
                                : e.action === "error"
                                  ? "down"
                                  : "neutral"
                          }
                        >
                          {e.action}
                        </Badge>
                      </span>
                      <span className="w-12 shrink-0 text-[12px] text-ash-100">{e.symbol}</span>
                      <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ash-400">
                        {e.reason}
                        {e.simulated ? <span className="ml-1.5 text-ash-500">· sim</span> : null}
                      </span>
                      {e.txHash ? <TxLink hash={e.txHash} /> : null}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Policy" hint="Bounds enforced server-side too" />
              <div className="space-y-3 p-4">
                {data ? (
                  <>
                    <Field
                      label="Order size (USDG)"
                      value={data.policy.orderSizeUsdg}
                      onCommit={(v) => patch({ orderSizeUsdg: v })}
                    />
                    <Field
                      label="Max exposure (USDG)"
                      value={data.policy.maxExposureUsdg}
                      onCommit={(v) => patch({ maxExposureUsdg: v })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        label="Fast SMA"
                        value={data.policy.fastPeriod}
                        onCommit={(v) => patch({ fastPeriod: v })}
                      />
                      <Field
                        label="Slow SMA"
                        value={data.policy.slowPeriod}
                        onCommit={(v) => patch({ slowPeriod: v })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        label="Take profit %"
                        value={data.policy.takeProfitPct}
                        onCommit={(v) => patch({ takeProfitPct: v })}
                      />
                      <Field
                        label="Stop loss %"
                        value={data.policy.stopLossPct}
                        onCommit={(v) => patch({ stopLossPct: v })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        label="Signal band (bps)"
                        value={data.policy.thresholdBps}
                        onCommit={(v) => patch({ thresholdBps: v })}
                      />
                      <Field
                        label="Max impact %"
                        value={data.policy.maxImpactPct}
                        onCommit={(v) => patch({ maxImpactPct: v })}
                      />
                    </div>

                    <div className="border-t border-ink-700 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] text-ash-100">Live execution</div>
                          <div className="mt-0.5 text-[10.5px] leading-snug text-ash-400">
                            {data.armed
                              ? "Broadcasts real swaps from the agent's signer."
                              : "Set TRADER_PRIVATE_KEY to arm."}
                          </div>
                        </div>
                        <button
                          disabled={!data.armed}
                          onClick={() => patch({ live: !data.policy.live })}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                            data.policy.live ? "bg-mint-500" : "bg-ink-600"
                          }`}
                          aria-label="Toggle live execution"
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink-950 transition-transform ${
                              data.policy.live ? "translate-x-[22px]" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <Loading className="h-40 w-full" />
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Watchlist" hint="Max 20 tickers" />
              <div className="p-4">
                <div className="flex flex-wrap gap-1.5">
                  {(data?.policy.watchlist ?? []).map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        patch({ watchlist: data!.policy.watchlist.filter((x) => x !== s) })
                      }
                      className="group inline-flex items-center gap-1 rounded-[2px] border border-ink-600 px-2 py-1 font-mono text-[11px] text-ash-200 hover:border-rose-500/50 hover:text-rose-500"
                      title="Remove"
                    >
                      {s}
                      <span className="text-ash-400 group-hover:text-rose-500">×</span>
                    </button>
                  ))}
                </div>
                <form
                  className="mt-3 flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = (e.currentTarget.elements.namedItem("t") as HTMLInputElement);
                    const t = input.value.trim().toUpperCase();
                    if (t && data) patch({ watchlist: [...data.policy.watchlist, t] });
                    input.value = "";
                  }}
                >
                  <Input name="t" placeholder="Add ticker" className="h-8 text-[11px]" />
                  <Button size="sm" variant="outline" type="submit">
                    Add
                  </Button>
                </form>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Reset" />
              <div className="p-4">
                <p className="text-[11px] leading-snug text-ash-400">
                  Clears price history, positions and the run log, and restores the default policy.
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={async () => {
                    await fetch("/api/trader", { method: "DELETE" });
                    refresh();
                  }}
                >
                  Reset agent state
                </Button>
              </div>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Field({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div>
      <label className="label mb-1.5 block">{label}</label>
      <Input
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n !== value) onCommit(n);
          else setDraft(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-8 text-[12px]"
      />
    </div>
  );
}

/**
 * Sparkline over the sampled price history.
 *
 * Scaled to the series' own min/max rather than an absolute axis — at these
 * sample counts the shape of the move is the only readable signal.
 */
function Spark({ points }: { points: Sample[] }) {
  if (points.length < 2) {
    return <div className="h-6 flex-1 text-[10.5px] leading-6 text-ash-500">warming up…</div>;
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const w = 100;
  const h = 24;
  const d = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const up = prices[prices.length - 1] >= prices[0];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 flex-1" aria-hidden>
      <path d={d} fill="none" stroke={up ? "#3ecf8e" : "#f2555a"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
