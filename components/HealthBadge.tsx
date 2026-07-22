"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { Dot } from "./ui";

type Health = {
  healthy: boolean;
  status: string;
  failing: string[];
  checks: Record<string, { ok: boolean; detail: string }>;
};

/**
 * System status, in the nav.
 *
 * Green and quiet when everything is fine; expands to name what's broken when
 * it isn't. Shown to everyone rather than hidden behind an admin route — the
 * arena's whole claim is that it's really running, so being able to see when it
 * isn't is part of the claim being credible.
 */
export function HealthBadge() {
  const { data } = useApi<Health>("/api/health", 60_000);
  const [open, setOpen] = useState(false);

  if (!data) return null;

  return (
    <div className="px-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-[2px] border border-ink-700 bg-ink-850 px-2.5 py-2 text-left transition-colors hover:border-ink-600"
      >
        <Dot tone={data.healthy ? "up" : "down"} pulse={data.healthy} />
        <span className={`text-[11px] ${data.healthy ? "text-ash-300" : "text-rose-500"}`}>
          {data.healthy ? "All systems live" : `${data.failing.length} issue${data.failing.length === 1 ? "" : "s"}`}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ash-500">{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="mt-1 space-y-1 rounded-[2px] border border-ink-700 bg-ink-950 px-2.5 py-2">
          {Object.entries(data.checks).map(([name, c]) => (
            <div key={name} className="flex items-start gap-2">
              <span className="mt-1.5">
                <Dot tone={c.ok ? "up" : "down"} />
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ash-300">
                  {name}
                </div>
                <div className="text-[10.5px] leading-snug text-ash-500">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
