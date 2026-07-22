"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ADDR, robinhood } from "@/lib/chain";
import { short, usd } from "@/lib/format";
import { Cat } from "./Cat";
import { Button, Dot } from "./ui";
import { Walkthrough, useWalkthrough } from "./Walkthrough";
import { Ticker } from "./Ticker";
import { HealthBadge } from "./HealthBadge";
import { SocialRow, TokenCard } from "./Social";

const NAV = [
  { href: "/", label: "Arena", glyph: "◆", hint: "5 agents competing live" },
  { href: "/console", label: "Console", glyph: "▸", hint: "Talk to the agent" },
  { href: "/wallet", label: "Wallet", glyph: "◧", hint: "Balances & positions" },
  { href: "/pay", label: "x402 Pay", glyph: "◈", hint: "Metered payments" },
  { href: "/swap", label: "Swap", glyph: "⇄", hint: "USDG ↔ stocks" },
  { href: "/earn", label: "Earn", glyph: "◎", hint: "Vault yield" },
  { href: "/trader", label: "Trader", glyph: "◔", hint: "Autonomous agent" },
  { href: "/build", label: "Build", glyph: "⌘", hint: "Ship your own agent" },
  { href: "/docs", label: "Docs", glyph: "≡", hint: "Integrate AgentOS" },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const walkthrough = useWalkthrough();

  useEffect(() => setNavOpen(false), [pathname]);

  // The embed route renders bare so it can live inside someone else's iframe.
  // A nested layout wouldn't work here — layouts compose in Next, so the shell
  // would still wrap it; the shell has to bow out itself.
  if (pathname?.startsWith("/embed")) return <>{children}</>;

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950">
      <Walkthrough open={walkthrough.open} onClose={walkthrough.close} />
      {/* Scrim for the mobile drawer. */}
      {navOpen ? (
        <button
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/70 lg:hidden"
        />
      ) : null}

      <nav
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border-r border-ink-700 bg-ink-900 transition-transform lg:static lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-4 hover:bg-ink-850"
        >
          <Cat size={30} title="AgentOS" />
          <div className="leading-none">
            <div className="text-[15px] font-semibold tracking-tight text-ash-100">
              Agent<span className="text-flame-500">OS</span>
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-ash-400">
              Wallet for agents
            </div>
          </div>
        </Link>

        <div className="flex-1 overflow-y-auto p-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative mb-0.5 flex items-center gap-3 rounded-[2px] px-3 py-2 transition-colors ${
                  active ? "bg-ink-800 text-ash-100" : "text-ash-300 hover:bg-ink-850 hover:text-ash-100"
                }`}
              >
                {/* The active marker is a hard 2px bar — no rounded pill. */}
                <span
                  className={`absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 ${
                    active ? "bg-flame-500" : "bg-transparent"
                  }`}
                />
                <span
                  className={`w-4 text-center font-mono text-[13px] ${
                    active ? "text-flame-500" : "text-ash-400 group-hover:text-ash-300"
                  }`}
                >
                  {item.glyph}
                </span>
                <span className="flex-1 text-[13px]">{item.label}</span>
              </Link>
            );
          })}

          <button
            onClick={walkthrough.reopen}
            className="mt-1 flex w-full items-center gap-3 rounded-[2px] px-3 py-2 text-ash-400 transition-colors hover:bg-ink-850 hover:text-ash-200"
          >
            <span className="w-4 text-center font-mono text-[13px]">?</span>
            <span className="flex-1 text-left text-[13px]">How it works</span>
          </button>

          <div className="mt-5 px-3">
            <div className="label mb-2">Network</div>
            <NetworkCard />
          </div>

          <div className="mt-3">
            <div className="label mb-2 px-3">System</div>
            <HealthBadge />
          </div>
        </div>

        <div className="space-y-2.5 border-t border-ink-700 p-3">
          <TokenCard />
          <WalletButton />
          <SocialRow />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900/80 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            className="font-mono text-[16px] text-ash-300 hover:text-flame-500"
            aria-label="Open navigation"
          >
            ☰
          </button>
          <Cat size={22} />
          <span className="text-[14px] font-semibold">
            Agent<span className="text-flame-500">OS</span>
          </span>
        </header>

        <Ticker />
        <main className="grid-substrate min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function NetworkCard() {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== robinhood.id;

  return (
    <div className="rounded-[2px] border border-ink-700 bg-ink-850 p-2.5">
      <div className="flex items-center gap-2">
        <Dot tone={wrongChain ? "down" : "up"} pulse={!wrongChain} />
        <span className="text-[11px] text-ash-200">Robinhood Chain</span>
      </div>
      <div className="mt-1.5 tnum text-[10px] text-ash-400">id {robinhood.id} · USDG</div>
      {wrongChain ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => switchChain({ chainId: robinhood.id })}
        >
          Switch network
        </Button>
      ) : null}
    </div>
  );
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: usdg } = useBalance({
    address,
    token: ADDR.usdg,
    chainId: robinhood.id,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <Button
        className="w-full"
        disabled={!injected || isPending}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? "Connecting…" : injected ? "Connect wallet" : "No wallet found"}
      </Button>
    );
  }

  return (
    <div className="rounded-[2px] border border-ink-700 bg-ink-850 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="tnum text-[11px] text-ash-200">{short(address)}</span>
        <button
          onClick={() => disconnect()}
          className="font-mono text-[10px] uppercase tracking-wider text-ash-400 hover:text-rose-500"
        >
          exit
        </button>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum text-[15px] text-ash-100">
          {usdg ? usd(Number(usdg.formatted)) : "—"}
        </span>
        <span className="font-mono text-[10px] text-flame-500">USDG</span>
      </div>
    </div>
  );
}
