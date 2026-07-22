"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cat, paletteFrom } from "./Cat";
import { Button } from "./ui";

/**
 * First-run walkthrough.
 *
 * Five cards a visitor clicks through on their first landing. It answers the
 * only question a cold visitor actually has — *what is this and why should I
 * care* — before they're dropped into a console full of jargon.
 *
 * Shown once, remembered in localStorage, dismissible at every step, and
 * reachable again from the nav. An onboarding flow you can't skip is an
 * obstacle, not an introduction.
 */

const SEEN_KEY = "agentos:walkthrough:v1";

type Slide = {
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  visual: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    eyebrow: "The problem",
    title: "AI agents can't pay for anything",
    body: "They can reason, write code, and call APIs. But the moment something costs money, they stop and wait for a human with a credit card. The web's payment layer was built for people, not programs.",
    accent: "#ff6a1f",
    visual: (
      <div className="flex items-center justify-center gap-3 font-mono text-[13px]">
        <span className="text-ash-300">agent.pay()</span>
        <span className="text-ash-500">→</span>
        <span className="rounded-[2px] border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-500">
          blocked
        </span>
      </div>
    ),
  },
  {
    eyebrow: "The protocol",
    title: "x402 turns HTTP into a payment rail",
    body: "A server answers an unpaid request with 402 and machine-readable terms. The agent signs a stablecoin authorization, retries, and gets the data. One round trip, no card, no checkout, no human.",
    accent: "#d97757",
    visual: (
      <div className="space-y-1.5 font-mono text-[11.5px]">
        <div className="text-ash-400">GET /api/x402/quote?symbol=NVDA</div>
        <div className="text-gold-500">← 402 Payment Required</div>
        <div className="text-ash-400">→ X-PAYMENT: signed authorization</div>
        <div className="text-mint-500">← 200 OK · NVDA 213.47 USDG</div>
      </div>
    ),
  },
  {
    eyebrow: "The chain",
    title: "Real stocks, on-chain, around the clock",
    body: "AgentOS runs on Robinhood Chain, where US equities trade as ERC-20 tokens against USDG. Your agent can quote NVDA, route an order through Uniswap, and park idle cash in a yield vault — at 3am, on a Sunday.",
    accent: "#3ecf8e",
    visual: (
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["94", "stock tokens"],
          ["USDG", "settlement"],
          ["24/7", "market hours"],
        ].map(([a, b]) => (
          <div key={b} className="rounded-[2px] border border-ink-700 bg-ink-850 px-2 py-2.5">
            <div className="tnum text-[15px] text-ash-100">{a}</div>
            <div className="mt-0.5 text-[10px] text-ash-400">{b}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: "The proof",
    title: "Five agents are competing right now",
    body: "Each one pays for its own market data before it's allowed to trade, then reads the same order book through a different lens — trend, mean reversion, breakout, liquidity, volatility. They disagree, and you can watch them argue about it.",
    accent: "#bb9af7",
    visual: (
      <div className="flex items-center justify-center gap-2">
        {["#ff6a1f", "#3ecf8e", "#e5b567", "#7aa2f7", "#bb9af7"].map((c, i) => (
          <Cat key={c} size={30} palette={paletteFrom(c)} className={i % 2 ? "animate-bob" : ""} />
        ))}
      </div>
    ),
  },
  {
    eyebrow: "The rule",
    title: "Capabilities, not custody",
    body: "AgentOS never holds your funds. It quotes, routes, and returns unsigned calldata — you sign every transaction. Give an agent a spend cap and it physically cannot exceed it: the limit is checked before the key is ever used.",
    accent: "#e5b567",
    visual: (
      <div className="space-y-1.5 font-mono text-[11.5px]">
        <div className="text-ash-400">max_payment: 0.10 USDG</div>
        <div className="text-rose-500">✕ refusing to sign: asks 0.50 USDG</div>
        <div className="text-ash-500">key never used</div>
      </div>
    ),
  },
];

export function Walkthrough({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);

  // Escape closes, arrows navigate — a modal that traps you is a dark pattern.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((n) => Math.min(SLIDES.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close walkthrough"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/85 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to AgentOS"
        className="animate-rise relative w-full max-w-[480px] overflow-hidden rounded-[2px] border border-ink-600 bg-ink-900"
      >
        <div className="h-[2px] w-full" style={{ background: slide.accent }} />

        <div className="flex items-center justify-between px-5 pt-4">
          <span className="label" style={{ color: slide.accent }}>
            {slide.eyebrow}
          </span>
          <button
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-wider text-ash-400 hover:text-ash-100"
          >
            skip
          </button>
        </div>

        <div className="px-5 pb-5 pt-3">
          <h2 className="text-[19px] font-semibold leading-tight tracking-tight text-ash-100">
            {slide.title}
          </h2>
          <p className="mt-2.5 text-[13px] leading-relaxed text-ash-300">{slide.body}</p>

          <div className="mt-4 flex min-h-[86px] items-center justify-center rounded-[2px] border border-ink-700 bg-ink-950 px-4 py-4">
            {slide.visual}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-700 px-5 py-3.5">
          <div className="flex gap-1.5">
            {SLIDES.map((s, n) => (
              <button
                key={s.title}
                onClick={() => setI(n)}
                aria-label={`Step ${n + 1}`}
                className="h-1.5 rounded-[1px] transition-all"
                style={{
                  width: n === i ? 18 : 6,
                  background: n === i ? slide.accent : "#2a2a31",
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {i > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>
                Back
              </Button>
            ) : null}
            {last ? (
              <Link href="/" onClick={onClose}>
                <Button size="sm">Watch them trade →</Button>
              </Link>
            ) : (
              <Button size="sm" onClick={() => setI(i + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Owns "has this visitor seen it" so the modal itself stays a pure component.
 * Reads localStorage in an effect rather than during render — on the server
 * there is no localStorage, and touching it during render would break hydration.
 */
export function useWalkthrough() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      // Private browsing or storage disabled — just don't show it.
    }
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  };

  return { open, close, reopen: () => setOpen(true) };
}
