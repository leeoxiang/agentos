import Anthropic from "@anthropic-ai/sdk";
import { PAY_TO, robinhood } from "@/lib/chain";
import { TOOLS, runTool } from "@/lib/agent/tools";
import { CATALOG_LIST } from "@/lib/x402/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-opus-4-8";
const MAX_TURNS = 8;

const SYSTEM = `You are AgentOS — the operator console for an agent wallet on Robinhood Chain (chain id ${robinhood.id}), an Ethereum L2 where US equities trade as ERC-20 stock tokens 24/7.

What you can actually do here, all against live mainnet state:
- Read any wallet's ETH, USDG, vault position and stock book.
- Quote and screen the tokenized-stock market from Uniswap V3 pool state.
- Route buy/sell orders and return submit-ready calldata.
- Report the Steakhouse USDG ERC-4626 vault where idle cash earns yield.
- Explain the x402 endpoints AgentOS sells: ${CATALOG_LIST.map((s) => `${s.id} (${s.priceUsdg} USDG)`).join(", ")}.
- Report the autonomous trading agent's policy, positions and signals.

Settlement is USDG (Global Dollar, 6 decimals). It supports EIP-3009, which is what makes x402 work: a payer signs a TransferWithAuthorization off-chain and a facilitator broadcasts it, so a paying agent never needs gas.

How to behave:
- You never move funds. build_order returns unsigned calldata; say plainly that the user must sign it.
- Call tools rather than guessing numbers. Every price you state should come from a tool result this turn.
- Quote prices in USDG with 2 decimals, share counts with 4. Always surface price impact on a routed order.
- If a tool needs an address and you do not have one, ask for it rather than inventing one.
- Be concise and concrete. Lead with the answer, then the supporting numbers. No preamble, no filler.
- This is real money on a real chain. Flag thin depth, high impact, or an unfunded wallet when you see it.${
  PAY_TO === "0x0000000000000000000000000000000000000000"
    ? "\n- NOTE: no payment receiver is configured (NEXT_PUBLIC_PAY_TO is unset), so paid x402 endpoints will return 402 with a configuration error rather than settling. Say so if asked."
    : ""
}`;

type ClientMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set — the console agent is offline." },
      { status: 503 }
    );
  }

  let body: { messages: ClientMessage[]; account?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0)
    return Response.json({ error: "messages required" }, { status: 400 });

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = body.messages
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  // The connected wallet is injected as context rather than trusted from the
  // model — it can only ever read the address the browser actually connected.
  const system = body.account
    ? `${SYSTEM}\n\nThe user's connected wallet is ${body.account}. Use it when a tool needs an account and they haven't named a different one.`
    : SYSTEM;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = await client.messages.create({
            model: MODEL,
            max_tokens: 8000,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            system,
            tools: TOOLS as unknown as Anthropic.Tool[],
            messages,
          });

          for (const block of response.content) {
            if (block.type === "text" && block.text.trim()) send({ type: "text", text: block.text });
          }

          if (response.stop_reason !== "tool_use") {
            send({ type: "done" });
            controller.close();
            return;
          }

          messages.push({ role: "assistant", content: response.content });

          const calls = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          // Tools are independent reads — run them together and return every
          // result in a single user turn, which is what keeps the model willing
          // to batch its calls on later turns.
          const results = await Promise.all(
            calls.map(async (call) => {
              send({ type: "tool", name: call.name, input: call.input, status: "running" });
              try {
                const out = await runTool(call.name, call.input as Record<string, unknown>);
                send({ type: "tool", name: call.name, input: call.input, status: "ok", result: out });
                return {
                  type: "tool_result" as const,
                  tool_use_id: call.id,
                  content: JSON.stringify(out),
                };
              } catch (e) {
                const message = e instanceof Error ? e.message : "tool failed";
                send({ type: "tool", name: call.name, input: call.input, status: "error", error: message });
                return {
                  type: "tool_result" as const,
                  tool_use_id: call.id,
                  content: message,
                  is_error: true,
                };
              }
            })
          );

          messages.push({ role: "user", content: results });
        }

        send({ type: "text", text: "_Stopped after 8 tool rounds — ask again to continue._" });
        send({ type: "done" });
        controller.close();
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "agent failed" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
