"use client";

import { explorerAddr, explorerTx } from "@/lib/chain";

/** Flat panel. The 1px border is the only chrome — no shadows, no gradients. */
export function Panel({
  children,
  className = "",
  as: As = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "aside";
}) {
  return (
    <As className={`border border-ink-700 bg-ink-900 rounded-[2px] ${className}`}>{children}</As>
  );
}

export function PanelHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-700 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-ash-100">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] text-ash-400">{hint}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "flame" | "up" | "down";
}) {
  const tones = {
    default: "text-ash-100",
    flame: "text-flame-500",
    up: "text-mint-500",
    down: "text-rose-500",
  } as const;
  return (
    <div className="px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1.5 tnum text-[19px] leading-none ${tones[tone]}`}>{value}</div>
      {sub ? <div className="mt-1.5 text-[11px] text-ash-400">{sub}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
}) {
  const variants = {
    primary:
      "bg-flame-500 text-ink-950 font-semibold hover:bg-flame-400 disabled:bg-ink-700 disabled:text-ash-400",
    outline:
      "border border-ink-600 text-ash-100 hover:border-flame-500 hover:text-flame-500 disabled:opacity-40",
    ghost: "text-ash-300 hover:text-ash-100 hover:bg-ink-800 disabled:opacity-40",
    danger: "border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 disabled:opacity-40",
  } as const;
  const sizes = { sm: "h-7 px-2.5 text-[11px]", md: "h-9 px-3.5 text-[12px]" } as const;

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-[2px] transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-9 w-full rounded-[2px] border border-ink-600 bg-ink-850 px-3 text-[13px] tnum text-ash-100 placeholder:text-ash-400 placeholder:font-sans focus:border-flame-500 ${className}`}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "flame" | "up" | "down" | "gold";
}) {
  const tones = {
    neutral: "border-ink-600 text-ash-300",
    flame: "border-flame-500/40 text-flame-500 bg-flame-500/8",
    up: "border-mint-500/40 text-mint-500 bg-mint-500/8",
    down: "border-rose-500/40 text-rose-500 bg-rose-500/8",
    gold: "border-gold-500/40 text-gold-500 bg-gold-500/8",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Live/idle indicator. A steady dot means armed; a pulsing one means running. */
export function Dot({ tone = "up", pulse = false }: { tone?: "up" | "down" | "idle" | "flame"; pulse?: boolean }) {
  const tones = {
    up: "bg-mint-500",
    down: "bg-rose-500",
    idle: "bg-ash-400",
    flame: "bg-flame-500",
  } as const;
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${tones[tone]} ${pulse ? "animate-pulse-dot" : ""}`}
    />
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="tnum text-[11px] text-flame-500 underline decoration-flame-500/30 underline-offset-2 hover:decoration-flame-500"
    >
      {label ?? `${hash.slice(0, 10)}…`}
    </a>
  );
}

export function AddrLink({ addr, label }: { addr: string; label?: string }) {
  return (
    <a
      href={explorerAddr(addr)}
      target="_blank"
      rel="noreferrer"
      className="tnum text-[11px] text-ash-300 underline decoration-ink-500 underline-offset-2 hover:text-flame-500 hover:decoration-flame-500"
    >
      {label ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`}
    </a>
  );
}

/** Skeleton bar with a single sweep — used while on-chain reads are in flight. */
export function Loading({ className = "h-4 w-24" }: { className?: string }) {
  return (
    <span className={`relative inline-block overflow-hidden rounded-[2px] bg-ink-800 ${className}`}>
      <span className="absolute inset-y-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-ink-600 to-transparent" />
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-[12px] text-ash-400">{children}</div>
  );
}
