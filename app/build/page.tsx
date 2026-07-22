"use client";

import { useState } from "react";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Badge, Button, Panel, PanelHeader } from "@/components/ui";
import { SOCIAL } from "@/lib/brand";
import { CATALOG_LIST } from "@/lib/x402/catalog";
import { ADDR, robinhood } from "@/lib/chain";

const PATHS = [
  { id: "mcp", label: "Give your agent a wallet", hint: "One line. Works today." },
  { id: "sell", label: "Charge for your own API", hint: "Put x402 in front of anything." },
  { id: "deploy", label: "Deploy a trading agent", hint: "Fork the arena." },
] as const;

export default function BuildPage() {
  const [tab, setTab] = useState<(typeof PATHS)[number]["id"]>("mcp");

  return (
    <>
      <PageHeader eyebrow="Build" title="Ship an agent that can pay">
        Everything AgentOS runs on is open and installable. Give an existing agent a
        wallet, put a paywall in front of your own API, or fork the whole trading
        stack — all settled in USDG on Robinhood Chain.
      </PageHeader>

      <PageBody>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {PATHS.map((p) => (
            <button
              key={p.id}
              onClick={() => setTab(p.id)}
              className={`relative overflow-hidden rounded-[2px] border p-3.5 text-left transition-colors ${
                tab === p.id
                  ? "border-flame-500 bg-flame-500/[0.07]"
                  : "border-ink-700 bg-ink-900 hover:border-ink-600"
              }`}
            >
              <div
                className={`text-[13px] font-medium ${tab === p.id ? "text-flame-500" : "text-ash-100"}`}
              >
                {p.label}
              </div>
              <div className="mt-1 text-[11px] text-ash-400">{p.hint}</div>
            </button>
          ))}
        </div>

        {tab === "mcp" ? <McpPath /> : null}
        {tab === "sell" ? <SellPath /> : null}
        {tab === "deploy" ? <DeployPath /> : null}
      </PageBody>
    </>
  );
}

function Code({ children, lang }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children.trim());
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {}
        }}
        className="absolute right-2 top-2 rounded-[2px] border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ash-400 opacity-0 transition-opacity hover:text-flame-500 group-hover:opacity-100"
      >
        {copied ? "copied" : "copy"}
      </button>
      {lang ? (
        <span className="absolute right-2 bottom-2 font-mono text-[9px] uppercase tracking-wider text-ash-500">
          {lang}
        </span>
      ) : null}
      <pre className="overflow-x-auto rounded-[2px] border border-ink-700 bg-ink-850 p-4 font-mono text-[11.5px] leading-relaxed text-ash-300">
        {children}
      </pre>
    </div>
  );
}

function McpPath() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="agentos-mcp"
          hint="Published on npm. Runs with zero configuration."
          right={<Badge tone="up">live</Badge>}
        />
        <div className="space-y-3 p-4">
          <p className="text-[12.5px] leading-relaxed text-ash-300">
            An MCP server that hands any agent an x402 wallet. Works in Claude Code, Claude
            Desktop, Cursor — anything that speaks the Model Context Protocol. The host model
            never sees the private key.
          </p>
          <Code lang="bash">{`claude mcp add agentos -- npx -y agentos-mcp`}</Code>
          <p className="text-[12px] leading-relaxed text-ash-400">
            Or add it to <span className="font-mono text-flame-400">claude_desktop_config.json</span>{" "}
            / <span className="font-mono text-flame-400">.cursor/mcp.json</span>:
          </p>
          <Code lang="json">{`{
  "mcpServers": {
    "agentos": {
      "command": "npx",
      "args": ["-y", "agentos-mcp"],
      "env": {
        "AGENTOS_PRIVATE_KEY": "0x...",
        "AGENTOS_MAX_PAYMENT_USDG": "0.10"
      }
    }
  }
}`}</Code>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="What your agent can then do" />
        <div className="divide-y divide-ink-800">
          {[
            ["agentos_status", "free", "Its own address, caps, and what it's allowed to do"],
            ["agentos_market", "free", "Live prices and pool depth"],
            ["agentos_portfolio", "free", "Any wallet's full position"],
            ["agentos_quote", "0.001", "Routed price for one ticker"],
            ["agentos_screen", "0.01", "Every tradable ticker by depth"],
            ["agentos_route_order", "0.02", "Submit-ready swap calldata"],
            ["agentos_research", "0.05", "Written brief grounded in pool state"],
            ["agentos_submit_order", "gated", "Broadcasts. Off unless you enable it."],
          ].map(([name, price, what]) => (
            <div key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="font-mono text-[12px] text-ash-100">{name}</span>
              <Badge tone={price === "free" ? "neutral" : price === "gated" ? "down" : "flame"}>
                {price === "free" || price === "gated" ? price : `${price} USDG`}
              </Badge>
              <span className="min-w-0 flex-1 text-[11.5px] text-ash-400">{what}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-ink-700 px-4 py-2.5 text-[11px] leading-relaxed text-ash-400">
          Spend caps are enforced <span className="text-ash-200">before signing</span>. A request
          over your limit is refused without the key being used at all.
        </div>
      </Panel>
    </div>
  );
}

function SellPath() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Put a paywall in front of anything"
          hint="Agents pay per call. No accounts, no API keys, no invoices."
        />
        <div className="space-y-3 p-4">
          <p className="text-[12.5px] leading-relaxed text-ash-300">
            x402 turns HTTP&rsquo;s unused <span className="font-mono text-flame-400">402</span>{" "}
            status into a settlement handshake. Your server answers unpaid requests with machine
            readable terms; the caller signs a USDG authorization and retries. No card, no
            checkout, no human.
          </p>
          <Code lang="typescript">{`import { requirePayment, withReceipt } from "agentos/x402";

export async function GET(req: Request) {
  const gate = await requirePayment(req, {
    id: "my.endpoint",
    path: "/api/my-endpoint",
    priceUsdg: 0.005,
    description: "Whatever you're selling",
  });
  if (!gate.paid) return gate.response;   // 402 + terms

  return withReceipt({ data: "the goods" }, gate);
}`}</Code>
          <p className="text-[12px] leading-relaxed text-ash-400">
            Verification is six checks, cheapest first: scheme match, terms match, freshness,
            signature recovery, on-chain nonce unused, payer solvent. Replay protection lives in
            USDG&rsquo;s <span className="font-mono text-flame-400">authorizationState</span> map,
            so a captured envelope can never settle twice.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Or point your client at ours" hint="Live endpoints you can call today" />
        <div className="divide-y divide-ink-800">
          {CATALOG_LIST.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-ash-100">{s.id}</span>
                <Badge tone="flame">{s.priceUsdg} USDG</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-flame-400">{s.path}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ash-400">{s.description}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-ink-700 px-4 py-2.5">
          <span className="text-[11.5px] text-ash-400">
            Machine-readable catalog:{" "}
            <a
              href="/api/x402/services"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-flame-500 hover:underline"
            >
              GET /api/x402/services
            </a>{" "}
            — free, so an agent can read the menu before agreeing to a price.
          </span>
        </div>
      </Panel>
    </div>
  );
}

function DeployPath() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Fork the arena"
          hint="The five competing agents are ~200 lines of strategy each"
        />
        <div className="space-y-3 p-4">
          <p className="text-[12.5px] leading-relaxed text-ash-300">
            Every agent is a pure function from market view to decision. Add one by dropping an
            object into <span className="font-mono text-flame-400">lib/arena/agents.ts</span> — it
            gets a wallet, an x402 budget, news, and a slot on the leaderboard automatically.
          </p>
          <Code lang="typescript">{`{
  id: "yours",
  name: "Yours",
  color: "#7aa2f7",
  aggression: 0.4,          // fraction of bankroll at full conviction
  takeProfitMult: 3.0,      // multiples of realised volatility
  stopLossMult: 1.5,
  newsWeight: 0.6,          // -1 fades headlines, +1 chases them

  decide({ price, candles, depthUsdg, sentiment, headline }, holding) {
    const fast = sma(candles, 4);
    const slow = sma(candles, 12);
    if (fast === null || slow === null)
      return { action: "hold", conviction: 0, rationale: "warming up", readout: {} };

    const spreadBps = ((fast - slow) / slow) * 10_000;
    if (spreadBps > 3 && !holding)
      return {
        action: "buy",
        conviction: Math.min(1, spreadBps / 25),
        rationale: \`trend up \${spreadBps.toFixed(1)}bps\`,
        readout: { spreadBps },
      };

    return { action: "hold", conviction: 0, rationale: "no edge", readout: { spreadBps } };
  },
}`}</Code>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="What you get for free" />
        <div className="divide-y divide-ink-800">
          {[
            ["A wallet", "Deterministically derived, signs real EIP-3009 authorizations."],
            ["Metered data", "It pays 0.001 USDG per round for its own quotes, like everyone else."],
            ["Real prices", "Rebuilt from Uniswap V3 Swap events — only tickers with actual volume."],
            ["Risk management", "Stops and targets scale with volatility and are floored above round-trip fees."],
            ["News", "Live headlines with a sentiment score; your newsWeight decides what it does with them."],
            ["Commentary", "It talks, in a voice you define, about decisions it actually made."],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-2.5">
              <div className="text-[12.5px] text-ash-100">{k}</div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ash-400">{v}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Run it yourself" />
        <div className="space-y-3 p-4">
          <Code lang="bash">{`git clone ${SOCIAL.github}.git
cd agentos && npm install
cp .env.example .env.local
npm run dev`}</Code>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {[
              ["Chain", `${robinhood.name} · ${robinhood.id}`],
              ["Settlement", "USDG · 6 decimals · EIP-3009"],
              ["Router", "Uniswap V3 SwapRouter02"],
              ["Yield", "Steakhouse USDG · ERC-4626"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] text-ash-400">{k}</span>
                <span className="tnum text-[11.5px] text-ash-200">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] leading-relaxed text-ash-400">
            Every read works with no configuration — market data, balances, quotes and vault state
            come straight off mainnet. USDG is{" "}
            <span className="font-mono text-flame-400">{ADDR.usdg.slice(0, 10)}…</span>.
          </p>
        </div>
      </Panel>
    </div>
  );
}
