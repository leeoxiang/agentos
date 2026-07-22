# @agentos/mcp

An **x402 wallet for any MCP host.** Gives an agent running in Claude Code,
Claude Desktop, Cursor — or anything else that speaks the Model Context
Protocol — the ability to read the tokenized-stock market on Robinhood Chain,
pay for metered data in USDG, and route trades. No browser, and the host model
never sees a private key.

Robinhood Chain (id 4663) is an Ethereum L2 where US equities trade as ERC-20
tokens against USDG, 24/7.

---

## Install

```json
{
  "mcpServers": {
    "agentos": {
      "command": "npx",
      "args": ["-y", "@agentos/mcp"],
      "env": {
        "AGENTOS_PRIVATE_KEY": "0x...",
        "AGENTOS_MAX_PAYMENT_USDG": "0.10"
      }
    }
  }
}
```

- **Claude Code** — `claude mcp add agentos -- npx -y @agentos/mcp`
- **Claude Desktop** — add the block above to `claude_desktop_config.json`
- **Cursor** — add it to `.cursor/mcp.json`

It runs with **no configuration at all** — every free tool works immediately
against the public deployment. A private key is only needed for the paid tools.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `AGENTOS_URL` | `https://agentos-flax.vercel.app` | Which AgentOS deployment to talk to |
| `AGENTOS_PRIVATE_KEY` | — | The agent's wallet. Without it, only free tools work. |
| `AGENTOS_MAX_PAYMENT_USDG` | `0.10` | Hard ceiling on a single x402 payment |
| `AGENTOS_ALLOW_SUBMIT` | `false` | Whether the agent may broadcast a trade at all |
| `AGENTOS_MAX_TRADE_USDG` | `25` | Ceiling on a single submitted trade, in USDG notional |

## Tools

**Free**

| Tool | Returns |
|---|---|
| `agentos_status` | This wallet's address, endpoint, caps, and what it's allowed to do |
| `agentos_services` | The x402 catalog with live prices and full payment terms |
| `agentos_market` | Live prices and pool depth for tokenized stocks |
| `agentos_portfolio` | ETH, USDG, vault position and stock book for any address |
| `agentos_vault` | Steakhouse USDG ERC-4626 vault state |

**Paid — settled in USDG over x402**

| Tool | Price | Returns |
|---|---|---|
| `agentos_quote` | 0.001 | Spot price, routed pool, fee tier, depth for one ticker |
| `agentos_screen` | 0.01 | Every tradable ticker ranked by depth |
| `agentos_route_order` | 0.02 | SwapRouter02 calldata with a slippage-guarded minimum out |
| `agentos_research` | 0.05 | Written brief grounded in live pool state |

**Gated**

| Tool | Returns |
|---|---|
| `agentos_submit_order` | Broadcasts a routed order. Requires `AGENTOS_ALLOW_SUBMIT`. |

Every paid tool attaches an `_x402` receipt to its result — price, recipient,
nonce and settlement status — so an agent's spend is always visible in the
transcript rather than hidden in a log.

---

## Security model

*The agent gets wallet capabilities, not wallet ownership.*

- **The key never leaves this process.** No tool returns it, and it is never
  placed in a tool result the host model can read.
- **Spend caps are enforced before signing, not after.** A cap checked on the
  response is not a cap. A request over `AGENTOS_MAX_PAYMENT_USDG` is refused
  without the key being used at all.
- **Payment is retried exactly once.** A second `402` means the terms changed or
  settlement failed; silently re-signing there is how an agent drains its own
  wallet.
- **Routing and submitting are different tools.** `agentos_route_order` is
  read-only — it returns unsigned calldata. Broadcasting is a separate tool that
  is disabled by default, marked `destructiveHint`, and capped independently. A
  sell is priced before the cap is applied so both sides are bounded the same
  way.

Fund the wallet with only what the agent should be able to lose.

## How x402 works here

```
GET /api/x402/quote?symbol=NVDA
  → 402  { accepts: [{ scheme:"exact", asset:USDG, maxAmountRequired:"1000",
                       payTo:…, extra:{ name, version, chainId, decimals } }] }

  agent signs TransferWithAuthorization   (EIP-3009 — a signature, no gas)

GET /api/x402/quote?symbol=NVDA   X-PAYMENT: base64(envelope)
  → 200  { …quote… }              X-PAYMENT-RESPONSE: base64(receipt)
```

USDG supports EIP-3009, so the payer signs an authorization off-chain and a
facilitator broadcasts it — the paying agent never needs gas on the chain it is
paying on. Replay protection is on-chain in USDG's `authorizationState` map, so
a captured envelope can never settle twice.

## Build from source

```bash
cd packages/mcp
npm install
npm run build
node dist/index.js        # speaks MCP over stdio
```

Diagnostics go to **stderr** — stdout is the protocol transport, and anything
written there corrupts the stream.

## Licence

MIT
