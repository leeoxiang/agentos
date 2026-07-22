"use client";

import { useState } from "react";
import { usd } from "@/lib/format";

export type EquityPoint = { t: number; round: number; equity: Record<string, number> };
export type CurveAgent = { id: string; name: string; color: string };

/**
 * Five equity curves on one axis.
 *
 * Hand-drawn SVG rather than a charting library: the whole chart is five
 * polylines and a baseline, and pulling in a library for that would outweigh the
 * feature. Scaled to the *combined* range of every series so the agents are
 * directly comparable — per-series scaling would make a flat agent look as
 * dramatic as a volatile one.
 */
export function EquityCurve({
  curve,
  agents,
  starting,
  height = 200,
  highlight,
}: {
  curve: EquityPoint[];
  agents: CurveAgent[];
  starting: number;
  height?: number;
  highlight?: string | null;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (curve.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[12px] text-ash-400"
        style={{ height }}
      >
        Run a couple of rounds and the curves appear here.
      </div>
    );
  }

  const W = 1000;
  const H = height;
  const PAD = { top: 10, right: 8, bottom: 6, left: 8 };

  const values = curve.flatMap((p) => agents.map((a) => p.equity[a.id] ?? starting));
  // Always include the starting bankroll so the baseline is on-screen even when
  // every agent is underwater.
  const lo = Math.min(...values, starting);
  const hi = Math.max(...values, starting);
  const span = hi - lo || 1;
  // A little headroom so a line riding the extreme isn't clipped to the frame.
  const pad = span * 0.08;

  const x = (i: number) =>
    PAD.left + (i / (curve.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - (lo - pad)) / (span + pad * 2)) * (H - PAD.top - PAD.bottom);

  const baselineY = y(starting);
  const hovered = hover !== null ? curve[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: H }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const i = Math.round(ratio * (curve.length - 1));
          setHover(Math.max(0, Math.min(curve.length - 1, i)));
        }}
      >
        {/* Break-even: the only reference line that means anything here. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={baselineY}
          y2={baselineY}
          stroke="#3a3a44"
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />

        {agents.map((a) => {
          const d = curve
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.equity[a.id] ?? starting).toFixed(2)}`)
            .join(" ");
          const dim = highlight && highlight !== a.id;
          return (
            <path
              key={a.id}
              d={d}
              fill="none"
              stroke={a.color}
              strokeWidth={highlight === a.id ? 2.5 : 1.75}
              strokeOpacity={dim ? 0.18 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {hovered ? (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="#6b6b78"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      {/* Read-out sits outside the SVG so text isn't stretched by preserveAspectRatio=none. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        <span className="label">
          {hovered ? `round ${hovered.round}` : `rounds 1–${curve[curve.length - 1].round}`}
        </span>
        {agents.map((a) => {
          const v = (hovered ?? curve[curve.length - 1]).equity[a.id] ?? starting;
          const delta = v - starting;
          return (
            <span key={a.id} className="flex items-center gap-1.5">
              <span className="h-[2px] w-3" style={{ background: a.color }} />
              <span className="text-[11px] text-ash-300">{a.name}</span>
              <span
                className={`tnum text-[11px] ${delta >= 0 ? "text-mint-500" : "text-rose-500"}`}
              >
                {usd(v)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
