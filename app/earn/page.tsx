"use client";

import { useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { AddrLink, Badge, Button, Empty, Input, Loading, Panel, PanelHeader, Stat, TxLink } from "@/components/ui";
import { compact, pct, qty, usd } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { ADDR, USDG_DECIMALS, VAULT_DECIMALS } from "@/lib/chain";
import { erc20Abi, erc4626Abi } from "@/lib/abi";

type Vault = {
  vault: string;
  symbol: string;
  tvl: number;
  totalShares: number;
  sharePrice: number;
  cumulativeYieldPct: number;
  position: { shares: string; sharesHuman: number; assets: number } | null;
};

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const { data, loading, refresh } = useApi<Vault>(
    address ? `/api/vault?account=${address}` : "/api/vault",
    20_000
  );

  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("100");
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  const { sendTransactionAsync, isPending } = useSendTransaction();
  const receipt = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  // Approvals are read on demand rather than polled — the value only matters at
  // the moment of deposit, and an extra poll per 20s buys nothing.
  const [needsApproval, setNeedsApproval] = useState(false);

  async function checkAllowance(assets: bigint): Promise<boolean> {
    if (!address) return false;
    const res = await fetch(`/api/allowance?owner=${address}&spender=${ADDR.yieldVault}&token=${ADDR.usdg}`);
    if (!res.ok) return true; // unreadable → surface approve defensively
    const body = (await res.json()) as { allowance: string };
    return BigInt(body.allowance) < assets;
  }

  async function submit() {
    if (!address) return;
    setErr(null);
    const n = Number(amount);
    if (!(n > 0)) return setErr("Enter an amount above zero.");

    try {
      if (mode === "deposit") {
        const assets = parseUnits(amount, USDG_DECIMALS);
        if (await checkAllowance(assets)) {
          setNeedsApproval(true);
          const h = await sendTransactionAsync({
            to: ADDR.usdg,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [ADDR.yieldVault, assets * 4n],
            }),
          });
          setHash(h);
          return;
        }
        setNeedsApproval(false);
        const h = await sendTransactionAsync({
          to: ADDR.yieldVault,
          data: encodeFunctionData({
            abi: erc4626Abi,
            functionName: "deposit",
            args: [assets, address],
          }),
        });
        setHash(h);
      } else {
        const shares = parseUnits(amount, VAULT_DECIMALS);
        const h = await sendTransactionAsync({
          to: ADDR.yieldVault,
          data: encodeFunctionData({
            abi: erc4626Abi,
            functionName: "redeem",
            args: [shares, address, address],
          }),
        });
        setHash(h);
      }
      setTimeout(refresh, 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "transaction rejected");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="ERC-4626 · Steakhouse USDG"
        title="Idle cash should earn"
        right={
          data ? (
            <div className="text-right">
              <div className="label">Share price</div>
              <div className="tnum mt-1 text-[24px] leading-none text-flame-500">
                {data.sharePrice.toFixed(6)}
              </div>
            </div>
          ) : null
        }
      >
        A tokenized-vault position your agent can enter and exit programmatically.
        Deposit USDG, receive steakUSDG shares; the share price rises as yield accrues,
        so there is nothing to claim.
      </PageHeader>

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <div className="space-y-4">
            <Panel>
              <div className="grid divide-y divide-ink-700 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Stat
                  label="Total value locked"
                  tone="flame"
                  value={loading && !data ? <Loading className="h-5 w-24" /> : `${compact(data?.tvl)} USDG`}
                  sub="Assets held by the vault"
                />
                <Stat
                  label="Realised yield"
                  tone="up"
                  value={
                    loading && !data ? <Loading className="h-5 w-20" /> : pct(data?.cumulativeYieldPct)
                  }
                  sub="Since share price left 1.000000"
                />
                <Stat
                  label="Shares outstanding"
                  value={loading && !data ? <Loading className="h-5 w-24" /> : compact(data?.totalShares)}
                  sub="steakUSDG supply"
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Your position" hint="Redeemable at the live share price" />
              {!isConnected ? (
                <Empty>Connect a wallet to see your vault position.</Empty>
              ) : !data?.position || data.position.sharesHuman === 0 ? (
                <Empty>No position yet. Deposit USDG to start earning.</Empty>
              ) : (
                <div className="grid divide-y divide-ink-700 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  <Stat label="Shares" value={qty(data.position.sharesHuman)} sub="steakUSDG" />
                  <Stat
                    label="Redeemable"
                    tone="flame"
                    value={usd(data.position.assets)}
                    sub="USDG at current share price"
                  />
                  <Stat
                    label="Share of vault"
                    value={`${((data.position.sharesHuman / data.totalShares) * 100).toFixed(6)}%`}
                    sub="of total supply"
                  />
                </div>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="How it works" />
              <ol className="divide-y divide-ink-800">
                {[
                  ["Deposit", "You send USDG and the vault mints steakUSDG shares at the current share price."],
                  ["Accrue", "The vault deploys the USDG. As it earns, totalAssets rises while share supply does not — so each share is worth more."],
                  ["Redeem", "Burn shares for USDG at the new, higher share price. There is no claim step and no reward token."],
                  ["Agent-native", "deposit() and redeem() are plain ERC-4626 calls, so an autonomous agent can park and retrieve cash between trades without a custom integration."],
                ].map(([title, body], i) => (
                  <li key={title} className="flex gap-3 px-4 py-3">
                    <span className="tnum mt-0.5 text-[11px] text-flame-500">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <div className="text-[12.5px] font-medium text-ash-100">{title}</div>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ash-400">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title={mode === "deposit" ? "Deposit USDG" : "Redeem shares"} />
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-1.5">
                  {(["deposit", "withdraw"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setErr(null);
                        setAmount(m === "deposit" ? "100" : "1");
                      }}
                      className={`h-9 rounded-[2px] border text-[12px] font-medium capitalize transition-colors ${
                        mode === m
                          ? "border-flame-500 bg-flame-500/10 text-flame-500"
                          : "border-ink-600 text-ash-400 hover:text-ash-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="label mb-1.5 block">
                    {mode === "deposit" ? "USDG amount" : "steakUSDG shares"}
                  </label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                  {mode === "withdraw" && data?.position ? (
                    <button
                      onClick={() => setAmount(String(data.position!.sharesHuman))}
                      className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-flame-500 hover:underline"
                    >
                      max {qty(data.position.sharesHuman)}
                    </button>
                  ) : null}
                </div>

                {data && Number(amount) > 0 ? (
                  <div className="rounded-[2px] border border-ink-700 bg-ink-850 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11.5px] text-ash-400">
                        {mode === "deposit" ? "Shares minted" : "USDG returned"}
                      </span>
                      <span className="tnum text-[13px] text-flame-500">
                        {mode === "deposit"
                          ? qty(Number(amount) / data.sharePrice)
                          : usd(Number(amount) * data.sharePrice)}
                      </span>
                    </div>
                  </div>
                ) : null}

                <Button className="w-full" disabled={!isConnected || isPending} onClick={submit}>
                  {!isConnected
                    ? "Connect a wallet"
                    : isPending
                      ? "Confirm in wallet…"
                      : needsApproval && mode === "deposit"
                        ? "Approve USDG"
                        : mode === "deposit"
                          ? "Deposit"
                          : "Redeem"}
                </Button>

                {err ? <p className="text-[11px] text-rose-500">{err}</p> : null}

                {hash ? (
                  <div className="flex items-center justify-between gap-2 rounded-[2px] border border-ink-700 bg-ink-850 px-3 py-2.5">
                    <span className="text-[11px] text-ash-400">
                      {receipt.isLoading
                        ? "Confirming…"
                        : receipt.data?.status === "success"
                          ? "Confirmed"
                          : receipt.data
                            ? "Reverted"
                            : "Submitted"}
                    </span>
                    <TxLink hash={hash} />
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Vault contract" />
              <div className="space-y-2 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11.5px] text-ash-400">Vault</span>
                  <AddrLink addr={ADDR.yieldVault} />
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11.5px] text-ash-400">Underlying</span>
                  <AddrLink addr={ADDR.usdg} label="USDG" />
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11.5px] text-ash-400">Standard</span>
                  <Badge tone="flame">ERC-4626</Badge>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
