"use client";

import { useState } from "react";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { AddrLink, Badge, Panel, PanelHeader } from "@/components/ui";
import { ADDR, robinhood } from "@/lib/chain";
import { CATALOG_LIST } from "@/lib/x402/catalog";

const SECTIONS = [
  { id: "protocol", label: "The 402 handshake" },
  { id: "endpoints", label: "Endpoints" },
  { id: "quickstart", label: "Quickstart" },
  { id: "contracts", label: "Contracts" },
  { id: "env", label: "Configuration" },
] as const;

export default function DocsPage() {
  const [tab, setTab] = useState<(typeof SECTIONS)[number]["id"]>("protocol");

  return (
    <>
      <PageHeader eyebrow="Integrate" title="Build on AgentOS">
        Every endpoint here speaks the x402 wire format, so any x402-capable client can
        pay for them. Settlement is USDG on Robinhood Chain via EIP-3009.
      </PageHeader>

      <PageBody>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setTab(s.id)}
              className={`h-8 rounded-[2px] border px-3 text-[12px] transition-colors ${
                tab === s.id
                  ? "border-flame-500 bg-flame-500/10 text-flame-500"
                  : "border-ink-600 text-ash-400 hover:text-ash-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {tab === "protocol" ? <Protocol /> : null}
        {tab === "endpoints" ? <Endpoints /> : null}
        {tab === "quickstart" ? <Quickstart /> : null}
        {tab === "contracts" ? <Contracts /> : null}
        {tab === "env" ? <Config /> : null}
      </PageBody>
    </>
  );
}

function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <div className="relative">
      {lang ? (
        <span className="absolute right-3 top-2.5 font-mono text-[9px] uppercase tracking-wider text-ash-500">
          {lang}
        </span>
      ) : null}
      <pre className="overflow-x-auto rounded-[2px] border border-ink-700 bg-ink-850 p-4 font-mono text-[11.5px] leading-relaxed text-ash-300">
        {children}
      </pre>
    </div>
  );
}

function Protocol() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Four steps, one round trip"
          hint="Why HTTP 402 finally does something"
        />
        <ol className="divide-y divide-ink-800">
          {[
            [
              "Call unpaid",
              "The client requests the resource with no payment header. Free or already-entitled resources cost nothing — the payment path is never entered.",
            ],
            [
              "Receive terms",
              "The server answers 402 with a JSON body listing what it accepts: scheme, network, asset, price in atomic units, recipient, and the asset's EIP-712 domain.",
            ],
            [
              "Sign",
              "The agent signs a TransferWithAuthorization struct over USDG. This is a signature, not a transaction — no gas, no nonce, no broadcast.",
            ],
            [
              "Retry & settle",
              "The client retries with X-PAYMENT set to the base64 envelope. The server verifies the signature, checks the nonce is unused on-chain and the payer is solvent, then a facilitator broadcasts transferWithAuthorization. The receipt rides back on X-PAYMENT-RESPONSE.",
            ],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-4 px-4 py-4">
              <span className="tnum shrink-0 text-[13px] text-flame-500">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-[13px] font-medium text-ash-100">{t}</div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ash-400">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel>
        <PanelHeader title="The 402 body" hint="What an unpaid request gets back" />
        <div className="p-4">
          <Code lang="json">{`{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "robinhood-chain",
    "maxAmountRequired": "1000",
    "resource": "https://…/api/x402/quote",
    "description": "Live on-chain quote for one stock token",
    "mimeType": "application/json",
    "payTo": "0x…",
    "maxTimeoutSeconds": 120,
    "asset": "${ADDR.usdg}",
    "extra": {
      "name": "Global Dollar",
      "version": "1",
      "chainId": ${robinhood.id},
      "decimals": 6
    }
  }],
  "error": "X-PAYMENT header is required"
}`}</Code>
          <p className="mt-3 text-[12px] leading-relaxed text-ash-400">
            <span className="text-ash-200">maxAmountRequired</span> is in atomic units — USDG
            has 6 decimals, so <span className="tnum text-flame-500">1000</span> is 0.001 USDG.
            The <span className="text-ash-200">extra</span> block is the asset&rsquo;s EIP-712
            domain; a client needs it to reproduce the signature, and the version there was
            recovered by matching USDG&rsquo;s on-chain DOMAIN_SEPARATOR.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="The X-PAYMENT envelope" hint="base64 of this JSON" />
        <div className="p-4">
          <Code lang="json">{`{
  "x402Version": 1,
  "scheme": "exact",
  "network": "robinhood-chain",
  "payload": {
    "signature": "0x…",
    "authorization": {
      "from":        "0x…  the agent",
      "to":          "0x…  the receiver",
      "value":       "1000",
      "validAfter":  "1721600000",
      "validBefore": "1721600120",
      "nonce":       "0x…  32 random bytes"
    }
  }
}`}</Code>
          <p className="mt-3 text-[12px] leading-relaxed text-ash-400">
            Replay protection is on-chain: USDG records each nonce in{" "}
            <span className="font-mono text-flame-400">authorizationState</span>, so a captured
            envelope can never be settled twice.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Endpoints() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Metered endpoints" hint="Priced in USDG, settled per call" />
        <div className="divide-y divide-ink-800">
          {CATALOG_LIST.map((s) => (
            <div key={s.id} className="px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[12.5px] text-ash-100">{s.id}</span>
                <Badge tone="flame">{s.priceUsdg} USDG</Badge>
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-flame-400">{s.path}</div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ash-400">{s.description}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Free endpoints" hint="No payment required" />
        <div className="divide-y divide-ink-800">
          {[
            ["GET /api/x402/services", "Service discovery — the machine-readable menu, including full payment terms for each entry."],
            ["GET /api/market", "Live prices and depth for every stock token with a USDG pool."],
            ["GET /api/balances?account=0x…", "Full wallet position: gas, cash, vault, stock book."],
            ["GET /api/vault?account=0x…", "steakUSDG vault state and your position."],
            ["POST /api/order", "Order routing for the site's own swap UI. The metered twin is trade.buildOrder."],
            ["GET /api/trader · POST /api/trader/tick", "Trading agent state and one strategy pass."],
            ["GET /api/arena", "Arena leaderboard, equity curves, news and configuration."],
                        ["POST /api/arena/tick", "Run one competitive round: five agents pay, decide and trade."],
            ["/embed", "Embeddable live leaderboard. Drop it in an iframe: <iframe src=\"https://agentos-flax.vercel.app/embed\" width=\"440\" height=\"260\" frameborder=\"0\"></iframe>"],
          ].map(([path, note]) => (
            <div key={path} className="px-4 py-3">
              <div className="font-mono text-[11.5px] text-ash-100">{path}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ash-400">{note}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Quickstart() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Pay for a call" hint="viem — any EIP-712 signer works" />
        <div className="p-4">
          <Code lang="typescript">{`import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`);

// 1. Call unpaid — a free resource costs nothing.
let res = await fetch("https://agentos.app/api/x402/quote?symbol=NVDA");

if (res.status === 402) {
  const { accepts } = await res.json();
  const terms = accepts[0];

  // 2. Refuse anything over your cap BEFORE touching the key.
  const price = Number(terms.maxAmountRequired) / 10 ** terms.extra.decimals;
  if (price > 0.05) throw new Error("over budget");

  // 3. Sign the EIP-3009 authorization. No gas, no transaction.
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: terms.payTo,
    value: BigInt(terms.maxAmountRequired),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + terms.maxTimeoutSeconds),
    nonce: \`0x\${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")}\`,
  };

  const signature = await account.signTypedData({
    domain: {
      name: terms.extra.name,
      version: terms.extra.version,
      chainId: terms.extra.chainId,
      verifyingContract: terms.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  // 4. Retry with the envelope. The facilitator settles it.
  const envelope = Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: terms.network,
    payload: {
      signature,
      authorization: {
        ...authorization,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
      },
    },
  })).toString("base64");

  res = await fetch("https://agentos.app/api/x402/quote?symbol=NVDA", {
    headers: { "X-PAYMENT": envelope },
  });
}

console.log(await res.json());`}</Code>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Buy a stock" hint="Pay for routing, then submit it yourself" />
        <div className="p-4">
          <Code lang="typescript">{`// trade.buildOrder returns SwapRouter02 calldata — it never moves your funds.
const res = await fetch("https://agentos.app/api/x402/trade", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-PAYMENT": envelope },
  body: JSON.stringify({
    symbol: "AAPL",
    side: "buy",
    amount: 100,          // USDG to spend
    trader: account.address,
    slippageBps: 100,     // 1%
  }),
});

const { order } = await res.json();

// Allowance first, if the router doesn't have one.
if (order.approval) {
  await wallet.sendTransaction({ to: order.approval.to, data: order.approval.data });
}

const hash = await wallet.sendTransaction({ to: order.to, data: order.data });`}</Code>
          <p className="mt-3 text-[12px] leading-relaxed text-ash-400">
            Check <span className="font-mono text-flame-400">order.priceImpactPct</span> before
            submitting. <span className="font-mono text-flame-400">order.minOut</span> bounds
            the worst case even if the route is wrong.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Contracts() {
  return (
    <Panel>
      <PanelHeader title="Robinhood Chain mainnet" hint={`Chain id ${robinhood.id}`} />
      <div className="divide-y divide-ink-800">
        {[
          ["USDG — Global Dollar", ADDR.usdg, "Settlement asset. 6 decimals. Supports EIP-3009 and EIP-2612."],
          ["steakUSDG", ADDR.yieldVault, "ERC-4626 vault, asset = USDG. Where idle agent cash earns."],
          ["SwapRouter02", ADDR.swapRouter, "Uniswap V3 execution. exactInputSingle for every routed order."],
          ["UniswapV3Factory", ADDR.v3Factory, "Pool discovery across the 0.01% / 0.05% / 0.3% / 1% tiers."],
          ["WETH", ADDR.weth, "Canonical wrapped ether."],
        ].map(([label, addr, note]) => (
          <div key={addr} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[12.5px] text-ash-100">{label}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ash-400">{note}</p>
            </div>
            <AddrLink addr={addr} />
          </div>
        ))}
      </div>
      <div className="border-t border-ink-700 px-4 py-3">
        <p className="text-[11.5px] leading-relaxed text-ash-400">
          RPC <span className="font-mono text-ash-200">{robinhood.rpcUrls.default.http[0]}</span> ·
          Explorer{" "}
          <a
            href={robinhood.blockExplorers.default.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-flame-500 hover:underline"
          >
            {robinhood.blockExplorers.default.url.replace("https://", "")}
          </a>
        </p>
      </div>
    </Panel>
  );
}

function Config() {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Environment" hint="What each variable unlocks" />
        <div className="divide-y divide-ink-800">
          {[
            [
              "NEXT_PUBLIC_PAY_TO",
              "required for paid endpoints",
              "Address that receives x402 payments. Until it is set, every metered endpoint returns 402 with a configuration error instead of settling.",
            ],
            [
              "FACILITATOR_PRIVATE_KEY",
              "optional",
              "A funded key that broadcasts transferWithAuthorization. With it, payment is genuinely gasless for the paying agent. Without it, the 402 response hands back the exact calldata so the payer can self-submit — the signed authorization is identical either way.",
            ],
            [
              "TRADER_PRIVATE_KEY",
              "optional",
              "Arms the autonomous trader. Absent, the strategy can only ever propose; present, live mode can be switched on and it broadcasts real swaps.",
            ],
            [
              "ANTHROPIC_API_KEY",
              "optional",
              "Powers the Console agent, the research.brief endpoint, and the arena agents' commentary. Without it, all three report themselves offline rather than failing opaquely.",
            ],
            [
              "KV_REST_API_URL + KV_REST_API_TOKEN",
              "recommended on Vercel",
              "Upstash/Vercel KV credentials. The arena's books and feed live here; without them state is per-instance and resets whenever a serverless function cold-starts. UPSTASH_REDIS_REST_URL / _TOKEN work too.",
            ],
            [
              "CRON_SECRET",
              "required for the arena cron",
              "Vercel attaches this as a bearer token on scheduled requests. GET /api/arena/tick refuses any request without it — every round costs a model call, so the endpoint is closed by default rather than open by default.",
            ],
            [
              "ARENA_SEED",
              "optional",
              "Derives the five arena agents' wallets. The default seed is public, so those wallets are unfunded: they sign real authorizations that verify but cannot settle. Set your own seed and fund the addresses to make the agents pay for data for real.",
            ],
          ].map(([name, req, note]) => (
            <div key={name} className="px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-flame-400">{name}</span>
                <Badge tone={req.startsWith("required") ? "gold" : "neutral"}>{req}</Badge>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ash-400">{note}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Run it" />
        <div className="p-4">
          <Code lang="bash">{`npm install

cat > .env.local <<'EOF'
NEXT_PUBLIC_PAY_TO=0xYourReceiverAddress
# FACILITATOR_PRIVATE_KEY=0x…   # sponsors gas so agents pay gaslessly
# TRADER_PRIVATE_KEY=0x…        # arms the autonomous trader
ANTHROPIC_API_KEY=sk-ant-…
EOF

npm run dev`}</Code>
          <p className="mt-3 text-[12px] leading-relaxed text-ash-400">
            Every read works with no configuration at all — market data, balances, quotes and
            vault state come straight off mainnet.
          </p>
        </div>
      </Panel>
    </div>
  );
}
