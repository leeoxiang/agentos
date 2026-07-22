"use client";

import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { AddrLink, Badge, Button, Dot, Empty, Input, Panel, PanelHeader, TxLink } from "@/components/ui";
import { fetchWithPayment, type FetchStep } from "@/lib/x402/client";
import type { SettleResult } from "@/lib/x402/types";
import { useApi } from "@/lib/useApi";
import { usd } from "@/lib/format";

type Services = {
  chainId: number;
  asset: { address: string; symbol: string; decimals: number; eip712Version: string };
  payTo: string;
  facilitator: { mode: string; address: string | null; note: string };
  services: Array<{ id: string; resource: string; priceUsdg: number; description: string }>;
};

const CALLS: Record<string, { method: "GET" | "POST"; url: (arg: string, who: string) => string; body?: (arg: string, who: string) => unknown; argLabel: string; argDefault: string }> = {
  "market.quote": {
    method: "GET",
    url: (s) => `/api/x402/quote?symbol=${encodeURIComponent(s)}`,
    argLabel: "Ticker",
    argDefault: "AAPL",
  },
  "market.screen": {
    method: "GET",
    url: () => "/api/x402/screen",
    argLabel: "—",
    argDefault: "",
  },
  "trade.buildOrder": {
    method: "POST",
    url: () => "/api/x402/trade",
    body: (s, who) => ({ symbol: s, side: "buy", amount: 25, trader: who }),
    argLabel: "Ticker (buys 25 USDG)",
    argDefault: "NVDA",
  },
  "research.brief": {
    method: "GET",
    url: (s) => `/api/x402/research?symbol=${encodeURIComponent(s)}`,
    argLabel: "Ticker",
    argDefault: "TSLA",
  },
};

export default function PayPage() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: dir } = useApi<Services>("/api/x402/services", 0);

  const [selected, setSelected] = useState<string>("market.quote");
  const [arg, setArg] = useState("AAPL");
  const [steps, setSteps] = useState<FetchStep[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [settlement, setSettlement] = useState<SettleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cap, setCap] = useState("0.10");

  const service = dir?.services.find((s) => s.id === selected);
  const spec = CALLS[selected];

  async function run() {
    if (!address || !spec) return;
    setBusy(true);
    setSteps([]);
    setResult(null);
    setSettlement(null);
    setErr(null);

    const init: RequestInit =
      spec.method === "POST"
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(spec.body?.(arg, address) ?? {}),
          }
        : { method: "GET" };

    const out = await fetchWithPayment(
      spec.url(arg, address),
      init,
      address,
      // wagmi's signTypedData matches the x402 client's signer contract exactly,
      // so the browser wallet is the agent's key without any adapter shim.
      (args) => signTypedDataAsync(args as never),
      {
        maxValueUsdg: Number(cap) || undefined,
        onStep: (s) => setSteps((prev) => [...prev, s]),
      }
    );

    setResult(out.data);
    setSettlement(out.settlement);
    if (out.error) setErr(out.error);
    setBusy(false);
  }

  return (
    <>
      <PageHeader
        eyebrow="x402 protocol"
        title="Pay-per-call, settled on-chain"
        right={
          dir ? (
            <div className="text-right">
              <div className="label">Facilitator</div>
              <div className="mt-1.5 flex items-center justify-end gap-1.5">
                <Dot tone={dir.facilitator.mode === "sponsored" ? "up" : "idle"} />
                <span className="font-mono text-[11px] text-ash-200">{dir.facilitator.mode}</span>
              </div>
            </div>
          ) : null
        }
      >
        A server answers an unpaid request with <span className="text-flame-500">402</span> and
        machine-readable terms. Your wallet signs an EIP-3009 authorization over USDG, the
        facilitator broadcasts it, and the request is retried — all in one round trip.
      </PageHeader>

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Service catalog" hint="GET /api/x402/services — free, by design" />
              <div className="divide-y divide-ink-800">
                {(dir?.services ?? []).map((s) => {
                  const active = s.id === selected;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelected(s.id);
                        setArg(CALLS[s.id]?.argDefault ?? "");
                        setSteps([]);
                        setResult(null);
                        setErr(null);
                      }}
                      className={`relative flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                        active ? "bg-ink-850" : "hover:bg-ink-850"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-0 h-full w-[2px] ${
                          active ? "bg-flame-500" : "bg-transparent"
                        }`}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[12px] text-ash-100">{s.id}</span>
                        <span className="tnum text-[12px] text-flame-500">{s.priceUsdg} USDG</span>
                      </div>
                      <span className="text-[11px] leading-snug text-ash-400">{s.description}</span>
                    </button>
                  );
                })}
                {!dir ? <Empty>Loading catalog…</Empty> : null}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Call it" hint="Your wallet is the paying agent" />
              <div className="space-y-3 p-4">
                {spec && spec.argLabel !== "—" ? (
                  <div>
                    <label className="label mb-1.5 block">{spec.argLabel}</label>
                    <Input
                      value={arg}
                      onChange={(e) => setArg(e.target.value.toUpperCase())}
                      placeholder="AAPL"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="label mb-1.5 block">Spend cap per call (USDG)</label>
                  <Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" />
                  <p className="mt-1.5 text-[10.5px] leading-snug text-ash-400">
                    Enforced client-side before signing. A 402 asking for more than this is
                    refused without touching your key.
                  </p>
                </div>

                <Button className="w-full" disabled={!isConnected || busy} onClick={run}>
                  {busy
                    ? "Settling…"
                    : !isConnected
                      ? "Connect a wallet"
                      : `Pay ${service?.priceUsdg ?? "—"} USDG & call`}
                </Button>

                {dir && dir.payTo === "0x0000000000000000000000000000000000000000" ? (
                  <p className="rounded-[2px] border border-gold-500/40 bg-gold-500/8 px-2.5 py-2 text-[10.5px] leading-snug text-gold-500">
                    No receiver configured. Set <code className="font-mono">NEXT_PUBLIC_PAY_TO</code> to
                    an address you control and the 402 flow settles for real.
                  </p>
                ) : null}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel>
              <PanelHeader
                title="Handshake"
                hint="Every step of the 402 exchange, as it happens"
                right={settlement?.transaction ? <TxLink hash={settlement.transaction} /> : null}
              />
              {!steps.length ? (
                <Empty>Run a call to watch the challenge → sign → settle sequence.</Empty>
              ) : (
                <ol className="divide-y divide-ink-800">
                  {steps.map((s, i) => (
                    <li key={i} className="animate-rise flex gap-3 px-4 py-3">
                      <div className="mt-1.5">
                        <Dot
                          tone={s.stage === "error" ? "down" : s.stage === "done" ? "up" : "flame"}
                          pulse={s.stage === "settle"}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-ash-400">
                          {s.stage}
                        </div>
                        <div
                          className={`mt-0.5 text-[12.5px] leading-snug ${
                            s.stage === "error" ? "text-rose-500" : "text-ash-200"
                          }`}
                        >
                          {s.detail}
                        </div>
                        {s.requirements ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge tone="flame">{s.requirements.scheme}</Badge>
                            <Badge>{s.requirements.network}</Badge>
                            <Badge>
                              {usd(
                                Number(s.requirements.maxAmountRequired) /
                                  10 ** s.requirements.extra.decimals,
                                3
                              )}{" "}
                              USDG
                            </Badge>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            {settlement?.errorReason === "facilitator_unfunded" && settlement.selfSubmit ? (
              <Panel className="border-gold-500/30">
                <PanelHeader
                  title="Self-submit mode"
                  hint="No facilitator key configured — you can broadcast the authorization yourself"
                />
                <div className="p-4">
                  <p className="text-[12px] leading-relaxed text-ash-300">
                    The signature is valid; nobody is sponsoring the gas. The exact calldata
                    below calls <code className="font-mono text-flame-400">transferWithAuthorization</code>{" "}
                    on USDG and is identical to what a facilitator would have sent.
                  </p>
                  <pre className="mt-3 max-h-40 overflow-auto rounded-[2px] border border-ink-700 bg-ink-850 p-3 font-mono text-[10.5px] leading-relaxed text-ash-300">
                    to: {settlement.selfSubmit.to}
                    {"\n"}data: {settlement.selfSubmit.data}
                  </pre>
                </div>
              </Panel>
            ) : null}

            <Panel>
              <PanelHeader
                title="Response"
                hint={err ? "Request did not complete" : "The paid resource"}
                right={
                  settlement?.payer ? <AddrLink addr={settlement.payer} label="payer" /> : null
                }
              />
              {err ? (
                <div className="px-4 py-3 text-[12px] text-rose-500">{err}</div>
              ) : result ? (
                <pre className="max-h-[380px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-ash-300">
                  {JSON.stringify(result, null, 2)}
                </pre>
              ) : (
                <Empty>Nothing yet.</Empty>
              )}
            </Panel>

            {dir ? (
              <Panel>
                <PanelHeader title="Settlement asset" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
                  {[
                    ["Token", dir.asset.symbol],
                    ["Decimals", String(dir.asset.decimals)],
                    ["EIP-712 version", dir.asset.eip712Version],
                    ["Chain", String(dir.chainId)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="label">{k}</div>
                      <div className="tnum mt-1 text-[13px] text-ash-100">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-ink-700 px-4 py-2.5 text-[11px] leading-snug text-ash-400">
                  {dir.facilitator.note}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
