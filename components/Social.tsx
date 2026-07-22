"use client";

import { useState } from "react";
import { SOCIAL, TOKEN, hasContract } from "@/lib/brand";

/** X / GitHub / npm, as flat monochrome glyphs that don't compete with the brand orange. */
export function SocialRow({ compact = false }: { compact?: boolean }) {
  const links = [
    {
      href: SOCIAL.twitter,
      label: "X",
      icon: (
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
    },
    {
      href: SOCIAL.github,
      label: "GitHub",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
          <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
        </svg>
      ),
    },
    {
      href: SOCIAL.npm,
      label: "npm",
      icon: <span className="font-mono text-[10px] font-bold leading-none">npm</span>,
    },
  ];

  return (
    <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          aria-label={l.label}
          title={l.label}
          className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-ink-700 text-ash-400 transition-colors hover:border-ink-600 hover:text-ash-100"
        >
          {l.icon}
        </a>
      ))}
    </div>
  );
}

/**
 * $AGENT buy button plus the contract address.
 *
 * The address is always visible — not hidden behind a menu — because "where is
 * the contract" is the first question anyone asks, and burying it is how fake
 * addresses get circulated in its place. Before launch it reads SOON rather than
 * showing a placeholder that could be mistaken for real.
 */
export function TokenCard() {
  const [copied, setCopied] = useState(false);
  const live = hasContract();

  const copy = async () => {
    if (!live) return;
    try {
      await navigator.clipboard.writeText(TOKEN.contractAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the address is on screen and selectable anyway.
    }
  };

  return (
    <div className="rounded-[2px] border border-flame-500/30 bg-flame-500/[0.06] p-2.5">
      <a
        href={TOKEN.buyUrl}
        target="_blank"
        rel="noreferrer"
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[2px] bg-flame-500 text-[12px] font-semibold text-ink-950 transition-colors hover:bg-flame-400"
      >
        Buy {TOKEN.symbol}
        <span className="text-[10px] opacity-70">↗</span>
      </a>

      <div className="mt-2">
        <div className="label mb-1">Contract address</div>
        <button
          onClick={copy}
          disabled={!live}
          title={live ? "Click to copy" : "Not launched yet"}
          className={`flex w-full items-center justify-between gap-2 rounded-[2px] border border-ink-700 bg-ink-950 px-2 py-1.5 text-left transition-colors ${
            live ? "hover:border-flame-500/50" : "cursor-default"
          }`}
        >
          <span className="tnum truncate text-[10.5px] text-ash-200">
            {live ? TOKEN.contractAddress : "SOON"}
          </span>
          {live ? (
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-flame-500">
              {copied ? "copied" : "copy"}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
