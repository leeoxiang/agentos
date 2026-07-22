# AgentOS

**The wallet your agents actually operate.** x402 payments settled in USDG,
tokenized-stock swaps, DeFi yield, and an autonomous trading agent — all on
Robinhood Chain.

The security model, borrowed from the Agent-Layer thesis: *the agent gets wallet
capabilities, not wallet ownership.* AgentOS never custodies funds. It routes,
quotes, prices and proposes; the signature always comes from a key the user
controls.

---

## What's real

Everything below runs against Robinhood Chain mainnet (chain id **4663**). No
mocks, no fixtures.

| Capability | How |
|---|---|
| **x402 payments** | Spec-compliant `402` challenges. Payers sign an **EIP-3009** `TransferWithAuthorization` over USDG; a facilitator broadcasts it, so the paying agent never needs gas. |
| **Stablecoin settlement** | USDG (Global Dollar), `0x5fc5…d168`, 6 decimals. EIP-712 domain version `"1"`, recovered by matching the on-chain `DOMAIN_SEPARATOR`. |
| **Swap assets** | Uniswap V3 on 4663. Pool discovery across all four fee tiers, spot pricing from `slot0`, execution via `SwapRouter02.exactInputSingle` with a slippage-bounded `amountOutMinimum`. |
| **Earn yield** | Steakhouse USDG, `0xBeEf…09dd` — a real ERC-4626 vault holding ~170M USDG. Deposit/redeem are plain 4626 calls, so an agent can park cash between trades. |
| **Buy stocks** | 94 verified Robinhood stock tokens. `trade.buildOrder` sells *routing*, not custody: pay 0.02 USDG over x402, get back submit-ready calldata. |
| **Trading agent** | Dual-SMA momentum with stop-loss, take-profit, exposure cap and a price-impact guard. Dry-run by default; arms with a signer and broadcasts real swaps. |
| **Agent arena** | Five agents with incompatible theses competing on one 1,000 USDG book each. Every round, each signs a real EIP-3009 authorization to pay for its market data before it may act. |
| **Price history** | Read from each pool's Uniswap V3 TWAP oracle (`observe()`), not accumulated in a database — so a cold serverless invocation has full history immediately. |
| **Console** | Claude Opus 4.8 with tool use over live chain state. Reads anything; proposes trades; signs nothing. |

## Verified on-chain

```
USDG          0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168   6 dec, EIP-3009 ✓
steakUSDG     0xBeEff033F34C046626B8D0A041844C5d1A5409dd   ERC-4626, ~170M USDG TVL
V3 Factory    0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
SwapRouter02  0xCaf681a66D020601342297493863E78C959E5cb2
```

Live sample from `/api/market`: NVDA **205.14** USDG (8.0M depth, 0.3% tier),
AAPL **326.78**, TSLA **377.95**, MSFT **401.43**. 73 of 94 stock tokens have a
live USDG pool; 66 carry more than 15K USDG of depth.

---

## The arena, and a word about the tape

Five agents — Momo (trend), Vega (mean reversion), Byte (breakout), Nova
(liquidity), Zen (volatility) — each read a *different* signal out of the same
market, so they genuinely disagree and take opposite sides.

Each round: a ticker universe is ranked by real depth, every agent signs an
EIP-3009 authorization for the 0.001 USDG quote fee, the signature is verified
against USDG's on-chain `authorizationState`, and only then does the agent get to
act. Risk exits scale with each ticker's realised volatility and are floored above
the pool's round-trip fee — a 1% tier costs 200bps to round-trip, so a 20bps
target there is unwinnable by construction.

**Robinhood Chain pools are frequently dormant.** At the time of writing, every
pool in the universe showed 0.0000% volatility over 56 minutes — no swaps were
landing at all. On the live tape, honest strategies correctly do nothing, and the
arena says so rather than looking broken.

So the arena has two tapes, and the mode is labelled on the page, on every feed
row, and on every stored record:

- **live** — pool state and the TWAP oracle. Every number real. Often flat.
- **sim** — a price path generated around the real spot, so the agents have
  something to disagree about when the chain is quiet. Depth, fee tiers, routing
  and all x402 payments stay real; only the price path is synthetic.

Switching tapes flattens open positions first — a position entered on one tape and
marked on the other reports the mode change, not a decision.

---

## Run it

```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_PAY_TO
npm run dev
```

Every **read** works with no configuration at all — market data, balances,
quotes and vault state come straight off mainnet. See `/docs` in the app for the
full configuration matrix.

## The 402 handshake

```
GET /api/x402/quote?symbol=NVDA
  → 402  { accepts: [{ scheme:"exact", asset:USDG, maxAmountRequired:"1000",
                       payTo:…, extra:{ name, version, chainId, decimals } }] }

  agent signs TransferWithAuthorization  (a signature — no gas, no broadcast)

GET /api/x402/quote?symbol=NVDA   X-PAYMENT: base64(envelope)
  → 200  { …quote… }              X-PAYMENT-RESPONSE: base64(receipt)
```

Verification is six checks, cheapest first: scheme/network match, terms match,
freshness, signature recovery, on-chain nonce unused, payer solvent. Replay
protection lives on-chain in USDG's `authorizationState` map, so a captured
envelope can never settle twice.

### Endpoints

| Metered | Price | Returns |
|---|---|---|
| `GET /api/x402/quote` | 0.001 USDG | Live spot price, pool, fee tier, depth |
| `GET /api/x402/screen` | 0.01 USDG | All 94 tickers ranked by tradable depth |
| `POST /api/x402/trade` | 0.02 USDG | Routed order + SwapRouter02 calldata |
| `GET /api/x402/research` | 0.05 USDG | Model-written brief grounded in pool state |

Discovery at `GET /api/x402/services` is free — an agent has to read the menu
before it can agree to a price.

---

## Layout

```
app/
  page.tsx              Console — the LLM-style agent surface
  arena/                Five agents competing, live
  wallet/ pay/ swap/    Balances · x402 · Uniswap V3
  earn/ trader/ docs/   ERC-4626 · autonomous agent · integration
  api/x402/             402-gated endpoints + service discovery
  api/arena/            Leaderboard, tape switch, one round per POST
lib/
  chain.ts market.ts    Chain config, pool discovery, V3 price math
  twap.ts               Price history from the pool's own oracle
  order.ts              Routing + calldata construction
  kv.ts                 Durable KV with an in-memory fallback
  x402/                 types · server (paywall) · facilitator · client
  trader/               store · strategy · engine
  arena/                agents · wallets · tape · engine · store
components/
  Cat.tsx               The mascot, as a 16×16 pixel map
```

## Notes

- **Addresses are EIP-55 checksummed.** viem rejects a bad checksum at call
  time, which surfaces as an empty result rather than an error — two
  hand-written checksums cost a debugging cycle here.
- **API validation is checksum-lenient** (`lib/addr.ts`). Agents routinely send
  lowercase addresses; strict validation would 400 a perfectly valid request.
- **Arena state persists to Upstash/Vercel KV** when `KV_REST_API_URL` and
  `KV_REST_API_TOKEN` are set, and falls back to an in-process Map otherwise. The
  UI shows which mode is active rather than letting you assume persistence you
  don't have.
- **Arena wallets are derived from `ARENA_SEED`.** The default seed is public, so
  those five wallets are unfunded: they sign authorizations that verify on-chain
  but stop at `insufficient_funds`. That state is reported as `unfunded` and kept
  distinct from `rejected` — a forged or replayed authorization still blocks the
  agent outright.
