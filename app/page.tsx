"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { CatHero, Cat } from "@/components/Cat";
import { Badge, Button, Dot } from "@/components/ui";

type Msg = { role: "user" | "assistant"; content: string };
type ToolTrace = {
  name: string;
  input: Record<string, unknown>;
  status: "running" | "ok" | "error";
  result?: unknown;
  error?: string;
};
type Turn = { msg: Msg; tools: ToolTrace[] };

const SUGGESTIONS = [
  { label: "Screen the market", prompt: "Screen the most liquid tokenized stocks and tell me what's actually tradable right now." },
  { label: "Quote NVDA", prompt: "What's NVDA trading at on-chain, and how deep is the pool?" },
  { label: "Route a $50 buy", prompt: "Route a 50 USDG buy of AAPL for my wallet and show me the price impact." },
  { label: "Where's the yield?", prompt: "What's the USDG vault paying, and how does it work?" },
  { label: "Explain x402", prompt: "Explain how x402 payments work here and what an agent can buy." },
  { label: "Check the trader", prompt: "What is the autonomous trading agent doing right now?" },
];

export default function Console() {
  const { address } = useAccount();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;

    setError(null);
    setInput("");
    setBusy(true);

    const history: Msg[] = [...turns.map((t) => t.msg), { role: "user", content: text }];
    setTurns((prev) => [...prev, { msg: { role: "user", content: text }, tools: [] }]);

    // The assistant turn is appended empty, then filled as the NDJSON stream
    // arrives — so tool calls appear the moment they start, not at the end.
    let cursor = -1;
    setTurns((prev) => {
      cursor = prev.length;
      return [...prev, { msg: { role: "assistant", content: "" }, tools: [] }];
    });

    const patch = (fn: (t: Turn) => Turn) =>
      setTurns((prev) => prev.map((t, i) => (i === cursor ? fn(t) : t)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, account: address }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: everything before the final newline is a complete event.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { type: "text"; text: string }
            | ({ type: "tool" } & ToolTrace)
            | { type: "error"; error: string }
            | { type: "done" };

          if (ev.type === "text") {
            patch((t) => ({
              ...t,
              msg: { ...t.msg, content: t.msg.content ? `${t.msg.content}\n\n${ev.text}` : ev.text },
            }));
          } else if (ev.type === "tool") {
            patch((t) => {
              const i = t.tools.findIndex(
                (x) => x.name === ev.name && JSON.stringify(x.input) === JSON.stringify(ev.input)
              );
              const entry: ToolTrace = {
                name: ev.name,
                input: ev.input,
                status: ev.status,
                result: ev.result,
                error: ev.error,
              };
              const tools = [...t.tools];
              if (i >= 0) tools[i] = entry;
              else tools.push(entry);
              return { ...t, tools };
            });
          } else if (ev.type === "error") {
            setError(ev.error);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The agent failed to respond.");
    } finally {
      setBusy(false);
      textarea.current?.focus();
    }
  }

  const empty = turns.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="flex-1 overflow-y-auto">
        {empty ? <Splash onPick={send} /> : null}

        <div className="mx-auto w-full max-w-[720px] px-5 pb-6">
          {turns.map((turn, i) => (
            <div key={i} className="animate-rise py-5">
              {turn.msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-[2px] border border-ink-600 bg-ink-800 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ash-100">
                    {turn.msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="mt-0.5 shrink-0">
                    <Cat size={24} muted={!turn.msg.content && turn.tools.length === 0} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {turn.tools.map((tool, j) => (
                      <ToolCard key={j} tool={tool} />
                    ))}
                    {turn.msg.content ? (
                      <Markdown text={turn.msg.content} />
                    ) : busy && i === turns.length - 1 && turn.tools.length === 0 ? (
                      <div className="flex items-center gap-2 py-1 text-[12px] text-ash-400">
                        <Dot tone="flame" pulse />
                        thinking
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ))}

          {error ? (
            <div className="mb-4 rounded-[2px] border border-rose-500/40 bg-rose-500/8 px-3.5 py-2.5 text-[12px] text-rose-500">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto w-full max-w-[720px] px-5 py-4">
          <div className="flex items-end gap-2 rounded-[2px] border border-ink-600 bg-ink-850 p-2 focus-within:border-flame-500">
            <textarea
              ref={textarea}
              rows={1}
              value={input}
              disabled={busy}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                address ? "Ask the agent to quote, route, or explain…" : "Connect a wallet, or just ask a question…"
              }
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed text-ash-100 placeholder:text-ash-400 focus:outline-none disabled:opacity-50"
            />
            <Button onClick={() => send(input)} disabled={busy || !input.trim()} className="mb-0.5">
              {busy ? "…" : "Send"}
            </Button>
          </div>
          <p className="mt-2 text-center text-[10.5px] text-ash-400">
            The agent reads live Robinhood Chain state and can route orders — it never signs. You approve every transaction.
          </p>
        </div>
      </div>
    </div>
  );
}

function Splash({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-2 pt-14 text-center">
      <CatHero size={84} />
      <h1 className="mt-6 text-[30px] font-semibold leading-tight tracking-tight text-ash-100">
        The wallet your agents<br />
        <span className="text-flame-500">actually operate.</span>
      </h1>
      <p className="mx-auto mt-3.5 max-w-[480px] text-[13.5px] leading-relaxed text-ash-300">
        x402 payments settled in USDG, tokenized-stock swaps, and DeFi yield — all
        on Robinhood Chain. Your agent gets wallet capabilities, never wallet ownership.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
        <Badge tone="flame">EIP-3009 settlement</Badge>
        <Badge>94 stock tokens</Badge>
        <Badge>Uniswap V3 routing</Badge>
        <Badge>ERC-4626 yield</Badge>
      </div>

      <div className="mt-8 grid gap-1.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onPick(s.prompt)}
            className="group rounded-[2px] border border-ink-700 bg-ink-900 px-3.5 py-3 text-left transition-colors hover:border-flame-500/50 hover:bg-ink-850"
          >
            <div className="text-[12.5px] font-medium text-ash-100 group-hover:text-flame-500">
              {s.label}
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-ash-400">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolTrace }) {
  const [open, setOpen] = useState(false);
  const tone = tool.status === "error" ? "down" : tool.status === "running" ? "flame" : "up";

  return (
    <div className="mb-2 rounded-[2px] border border-ink-700 bg-ink-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-850"
      >
        <Dot tone={tone} pulse={tool.status === "running"} />
        <span className="font-mono text-[11px] text-ash-200">{tool.name}</span>
        <span className="truncate font-mono text-[10.5px] text-ash-400">
          {summarize(tool.input)}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ash-400">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <pre className="max-h-64 overflow-auto border-t border-ink-700 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ash-300">
          {tool.error ?? JSON.stringify(tool.result ?? tool.input, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function summarize(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 14 ? `${v.slice(0, 8)}…` : v}`);
  return parts.length ? `· ${parts.join(" ")}` : "";
}

/**
 * Minimal markdown for the agent's replies.
 *
 * Deliberately not a full parser: the model is prompted for short, factual
 * answers, so bold, code, bullets and headings cover everything it emits —
 * and shipping a parser here would be more surface area than the feature needs.
 */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/`([^`]+)`/g, '<code class="rounded-[2px] bg-ink-800 px-1 py-0.5 font-mono text-[11.5px] text-flame-400">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-ash-100">$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em class="text-ash-200">$1</em>');

  const blocks = text.split("\n\n");

  return (
    <div className="space-y-3 text-[13.5px] leading-relaxed text-ash-200">
      {blocks.map((block, i) => {
        const lines = block.split("\n");

        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 bg-flame-500" />
                  <span dangerouslySetInnerHTML={{ __html: inline(l.replace(/^\s*[-*•]\s+/, "")) }} />
                </li>
              ))}
            </ul>
          );
        }

        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={i} className="space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span className="tnum shrink-0 text-flame-500">{j + 1}.</span>
                  <span dangerouslySetInnerHTML={{ __html: inline(l.replace(/^\s*\d+[.)]\s+/, "")) }} />
                </li>
              ))}
            </ol>
          );
        }

        if (/^#{1,4}\s/.test(block)) {
          return (
            <h3 key={i} className="text-[14px] font-semibold text-ash-100">
              <span dangerouslySetInnerHTML={{ __html: inline(block.replace(/^#{1,4}\s/, "")) }} />
            </h3>
          );
        }

        return (
          <p key={i} dangerouslySetInnerHTML={{ __html: inline(block).replace(/\n/g, "<br/>") }} />
        );
      })}
    </div>
  );
}
