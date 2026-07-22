"use client";

import { useEffect, useState } from "react";

/**
 * "thinking... .. ." — the dots count down 3 → 2 → 1 and repeat.
 *
 * Deliberately not a spinner. A spinner says "busy"; a countdown that visibly
 * loops says "still working, and this is normal" — which is what a model that
 * may think for several seconds before its first token actually needs to
 * communicate.
 */
export function Thinking({
  label = "thinking",
  color = "#d97757",
}: {
  label?: string;
  color?: string;
}) {
  const [n, setN] = useState(3);

  useEffect(() => {
    const t = setInterval(() => setN((v) => (v === 1 ? 3 : v - 1)), 420);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="inline-flex items-baseline gap-1.5 text-[12.5px] text-ash-400">
      <span style={{ color }}>{label}</span>
      {/* Fixed width so the line doesn't reflow as the count changes. */}
      <span className="tnum inline-block w-[26px] text-left tracking-[0.18em]" style={{ color }}>
        {".".repeat(n)}
      </span>
    </span>
  );
}

/**
 * Blinking block cursor shown at the tail of streaming text.
 * Disappears the moment the stream ends, so a finished answer looks finished.
 */
export function Caret({ color = "#d97757" }: { color?: string }) {
  return (
    <span
      className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[1px] animate-pulse-dot"
      style={{ background: color }}
      aria-hidden
    />
  );
}
