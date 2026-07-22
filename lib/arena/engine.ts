import Anthropic from "@anthropic-ai/sdk";
import { PAY_TO, USDG_DECIMALS, USDG_DOMAIN } from "../chain";
import { findPool, loadMarket, poolDepthUsdg, priceFromSqrt, type Pool } from "../market";
import {
  MIN_VOLUME_USDG,
  PRICE_LOOKBACK_BLOCKS,
  VOLUME_LOOKBACK_BLOCKS,
  scanSwaps,
  toCandles,
} from "../volume";
import { changePct, volatilityPct, type Candle } from "../twap";
import { resolveStock } from "../order";
import { CATALOG } from "../x402/catalog";
import { buildRequirements } from "../x402/server";
import { facilitatorAccount, settlePayment, verifyPayment } from "../x402/facilitator";
import { TRANSFER_WITH_AUTHORIZATION_TYPES, X402_VERSION, type PaymentPayload } from "../x402/types";
import { AGENTS, type Decision, type MarketView } from "./agents";
import { agentAccount } from "./wallets";
import { getNews, headlineFor, sentimentFor, type NewsSnapshot } from "./news";
import {
  equity,
  loadState,
  saveState,
  type ArenaState,
  type FeedEntry,
  type X402Receipt,
} from "./store";

/** Minimum notional worth executing; below this, fees dominate the thesis. */
const MIN_TRADE_USDG = 5;

/** How many of the deepest tickers the agents get to choose between each round. */
const UNIVERSE_SIZE = 12;

/**
 * The competition universe, ranked by *traded volume* rather than depth.
 *
 * Depth and volume are not the same thing, and on this chain they are almost
 * inversely related: AAPL and TSLA hold liquidity and never trade, while NVDA
 * and SPCX carry hundreds of fills an hour. An agent needs a counterparty, not a
 * balance sheet — so a ticker only enters the arena if real money has moved
 * through it recently.
 *
 * Cached because ranking means scanning every stock pool's Swap events, which is
 * far too expensive to repeat every round.
 */
const UNIVERSE_TTL_MS = 3 * 60_000;
const g = globalThis as unknown as {
  __arenaUniverse?: { at: number; symbols: string[]; volumes: Record<string, number> };
};

async function rankByVolume(): Promise<{ symbols: string[]; volumes: Record<string, number> }> {
  const rows = (await loadMarket()).filter((r) => r.price !== null && r.pool);

  const pools = (
    await Promise.all(rows.map((r) => findPool(r.address).catch(() => null)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  const activity = await scanSwaps(pools, VOLUME_LOOKBACK_BLOCKS);

  const scored = rows
    .map((row) => {
      const pool = pools.find((p) => p.address === row.pool);
      const act = pool ? activity.get(pool.address.toLowerCase()) : undefined;
      return { symbol: row.symbol, volumeUsdg: act?.volumeUsdg ?? 0, swaps: act?.swaps ?? 0 };
    })
    .filter((s) => s.volumeUsdg >= MIN_VOLUME_USDG)
    .sort((a, b) => b.volumeUsdg - a.volumeUsdg)
    .slice(0, UNIVERSE_SIZE);

  return {
    symbols: scored.map((s) => s.symbol),
    volumes: Object.fromEntries(scored.map((s) => [s.symbol, s.volumeUsdg])),
  };
}

export async function resolveUniverse(): Promise<string[]> {
  const cached = g.__arenaUniverse;
  if (cached && Date.now() - cached.at < UNIVERSE_TTL_MS) return cached.symbols;

  const ranked = await rankByVolume();
  if (ranked.symbols.length) g.__arenaUniverse = { at: Date.now(), ...ranked };
  return ranked.symbols;
}

/** Traded volume per universe ticker, for the UI. */
export function universeVolumes(): Record<string, number> {
  return g.__arenaUniverse?.volumes ?? {};
}

type Snapshot = MarketView & { fee: number; volumeUsdg: number; swaps: number };

/**
 * Pull one round's market data: spot, depth, and a price series rebuilt from
 * actual fills. Tickers without a pool are dropped rather than faked.
 */
async function snapshotMarket(symbols: string[], news: NewsSnapshot): Promise<Snapshot[]> {
  const resolved = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const stock = resolveStock(symbol);
        const pool = await findPool(stock.address);
        return pool ? { symbol, pool } : null;
      } catch {
        return null;
      }
    })
  );
  const live = resolved.filter((r): r is { symbol: string; pool: Pool } => r !== null);
  if (!live.length) return [];

  const activity = await scanSwaps(live.map((l) => l.pool), PRICE_LOOKBACK_BLOCKS);

  return live.map(({ symbol, pool }) => {
    const act = activity.get(pool.address.toLowerCase());
    // Swap events are the primary source; the oracle is only a fallback for a
    // pool that happens to have cardinality but no recent fills.
    const candles: Candle[] = act ? toCandles(act) : [];
    return {
      symbol,
      price: priceFromSqrt(pool.sqrtPriceX96, pool.usdgIsToken0),
      depthUsdg: poolDepthUsdg(pool),
      candles,
      fee: pool.fee,
      volumeUsdg: act?.volumeUsdg ?? 0,
      swaps: act?.swaps ?? 0,
      sentiment: sentimentFor(news, symbol),
      headline: headlineFor(news, symbol)?.headline ?? null,
    } satisfies Snapshot;
  });
}

function randomNonce(): `0x${string}` {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

/**
 * Charge an agent for its market data over x402.
 *
 * This is the real protocol path, not a narration of it: the agent's own key
 * signs a TransferWithAuthorization, and the facilitator verifies the signature,
 * checks the nonce against USDG's on-chain `authorizationState`, and checks the
 * payer's balance. With a funded facilitator it also broadcasts. An unfunded
 * agent gets a truthful `rejected / insufficient_funds` — the signature was
 * still real, and the arena records that it could not pay.
 */
async function chargeForData(agentId: string, origin: string): Promise<X402Receipt> {
  const route = CATALOG.quote;
  const requirements = buildRequirements(route, origin);
  const account = agentAccount(agentId);
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();

  const authorization = {
    from: account.address,
    to: requirements.payTo,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + requirements.maxTimeoutSeconds),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: USDG_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: requirements.network,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce,
      },
    },
  };

  const base = { priceUsdg: route.priceUsdg, nonce, payer: account.address };

  if (PAY_TO === "0x0000000000000000000000000000000000000000")
    return { ...base, status: "rejected", reason: "receiver_not_configured" };

  const verification = await verifyPayment(payload, requirements);
  if (!verification.isValid) {
    // An empty wallet is not a broken payment. The signature recovered, the
    // nonce was checked on-chain and is unused — the agent simply has no USDG.
    // Distinguishing this from a forged or replayed authorization is what lets
    // the arena run on unfunded demo wallets without pretending the crypto
    // succeeded when it didn't.
    if (verification.invalidReason === "insufficient_funds")
      return { ...base, status: "unfunded", reason: "signature valid, wallet holds no USDG" };
    return { ...base, status: "rejected", reason: verification.invalidReason };
  }

  // Only broadcast when a facilitator is actually armed; otherwise the payment
  // is verified-but-unsettled, which is a real x402 state, not a failure.
  if (!facilitatorAccount()) return { ...base, status: "verified" };

  const settlement = await settlePayment(payload, requirements);
  return settlement.success
    ? { ...base, status: "settled", txHash: settlement.transaction ?? undefined }
    : { ...base, status: "verified", reason: settlement.errorReason };
}

/**
 * Resolve an agent's risk bands for a specific ticker.
 *
 * Two constraints have to hold at once. The bands must be wide enough to sit
 * outside one round's noise, or every position stops out the moment it opens;
 * and the take-profit must clear the pool's round-trip fee, or the trade is a
 * guaranteed loss no matter how well the strategy read the market. A 1% tier
 * costs 200bps to enter and exit — a 20bps target there is unwinnable by
 * construction, which is exactly the trap fixed bands fall into.
 */
function riskBands(def: (typeof AGENTS)[number], snap: Snapshot) {
  const volBps = volatilityPct(snap.candles) * 100;
  const roundTripBps = (snap.fee / 1_000_000) * 2 * 10_000;

  return {
    takeProfitBps: Math.max(def.takeProfitMult * volBps, roundTripBps * 1.5),
    stopLossBps: Math.max(def.stopLossMult * volBps, roundTripBps * 0.9),
  };
}

/**
 * Fold the news into a price-derived decision.
 *
 * The strategies stay pure — they read price, depth and volatility, and nothing
 * else. News is applied here, uniformly, so every agent sees the same headline
 * and only their `newsWeight` differs. That keeps the disagreement interpretive
 * rather than mechanical: Momo leans into a catalyst at +0.8 while Vega fades
 * the same story at -0.6.
 *
 * A strong enough contradiction blocks the trade outright. Sizing up on a signal
 * the news actively argues against is the failure mode worth designing out.
 */
function applyNews(
  decision: Decision,
  snap: Snapshot,
  def: (typeof AGENTS)[number]
): Decision {
  if (decision.action === "hold" || !snap.headline || snap.sentiment === 0) return decision;

  // Positive when the news agrees with what this agent wants to do.
  const agreement =
    decision.action === "buy" ? snap.sentiment * def.newsWeight : -snap.sentiment * def.newsWeight;

  if (agreement < -0.45)
    return {
      action: "hold",
      conviction: 0,
      rationale: `${decision.rationale} — but the news says otherwise, standing down`,
      readout: { ...decision.readout, sentiment: snap.sentiment, agreement },
    };

  const scaled = Math.max(0.05, Math.min(1, decision.conviction * (1 + agreement * 0.6)));
  return {
    ...decision,
    conviction: scaled,
    rationale:
      Math.abs(agreement) > 0.15
        ? `${decision.rationale} — news ${agreement > 0 ? "backs it" : "cuts against it"}`
        : decision.rationale,
    readout: { ...decision.readout, sentiment: snap.sentiment, agreement },
  };
}

/** Apply a decision to the agent's paper book, priced off the real pool. */
function execute(
  book: ArenaState["books"][string],
  decision: Decision,
  snap: Snapshot,
  aggression: number
): { qty: number; notional: number; realized: number } {
  const feeMul = snap.fee / 1_000_000;

  if (decision.action === "buy") {
    const notional = Math.min(book.cashUsdg, book.cashUsdg * aggression * decision.conviction);
    if (notional < MIN_TRADE_USDG) return { qty: 0, notional: 0, realized: 0 };
    const qty = (notional * (1 - feeMul)) / snap.price;
    const prev = book.position;
    const newQty = (prev?.qty ?? 0) + qty;
    book.position = {
      symbol: snap.symbol,
      qty: newQty,
      avgCost: ((prev?.qty ?? 0) * (prev?.avgCost ?? 0) + notional) / newQty,
      entryPrice:
        ((prev?.qty ?? 0) * (prev?.entryPrice ?? 0) + qty * snap.price) / newQty,
    };
    book.cashUsdg -= notional;
    book.trades += 1;
    return { qty, notional, realized: 0 };
  }

  if (decision.action === "sell" && book.position) {
    const { qty, avgCost } = book.position;
    const proceeds = qty * snap.price * (1 - feeMul);
    const realized = proceeds - qty * avgCost;
    book.cashUsdg += proceeds;
    book.realizedPnl += realized;
    book.position = null;
    book.trades += 1;
    if (realized >= 0) book.wins += 1;
    else book.losses += 1;
    return { qty, notional: proceeds, realized };
  }

  return { qty: 0, notional: 0, realized: 0 };
}

const THOUGHT_SCHEMA = {
  type: "object",
  properties: {
    thoughts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          thought: { type: "string" },
        },
        required: ["agentId", "thought"],
        additionalProperties: false,
      },
    },
  },
  required: ["thoughts"],
  additionalProperties: false,
} as const;

/**
 * Generate all five agents' commentary in one call.
 *
 * Batching is not just cheaper — it lets the model see what the others decided,
 * so the agents can actually needle each other when they take opposite sides.
 * The strategies decide; the model only narrates what already happened.
 */
async function generateThoughts(
  rows: Array<{ agentId: string; symbol: string; decision: Decision; price: number; paid: X402Receipt }>,
  news: NewsSnapshot
): Promise<Record<string, string>> {
  if (!process.env.ANTHROPIC_API_KEY || !rows.length) return {};

  const roster = rows
    .map((r) => {
      const def = AGENTS.find((a) => a.id === r.agentId)!;
      return `- ${def.name} (${def.id}) — ${def.style}. Voice: ${def.voice}
  Decision on ${r.symbol} @ ${r.price.toFixed(2)} USDG: ${r.decision.action.toUpperCase()} (conviction ${(r.decision.conviction * 100).toFixed(0)}%)
  Signal: ${r.decision.rationale}
  Paid ${r.paid.priceUsdg} USDG for the quote — ${r.paid.status}${r.paid.reason ? ` (${r.paid.reason})` : ""}`;
    })
    .join("\n");

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: THOUGHT_SCHEMA },
      },
      system:
        "You voice five trading agents competing on Robinhood Chain, where US equities trade as ERC-20 tokens against USDG. " +
        "Write each agent's inner monologue for this round: one or two short sentences, first person, in that agent's stated voice. " +
        "Ground it in the signal and decision given — never invent numbers that weren't provided. " +
        "Positions are all-or-nothing: a BUY opens one position and a SELL closes it entirely. " +
        "Never describe trimming, scaling, adding or partial exits — the engine cannot do those, " +
        "and commentary must not describe an action that did not happen. " +
        "These pools are thin and barely move, so a 'hold' is the common case: make holds interesting rather than repetitive. " +
        "Agents may reference each other by name when they disagree. No hashtags, no emoji, no financial-advice disclaimers.",
      messages: [
        {
          role: "user",
          content: `Round decisions:\n${roster}\n\nReturn one thought per agent, keyed by agentId.`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text) as { thoughts: Array<{ agentId: string; thought: string }> };
    return Object.fromEntries(parsed.thoughts.map((t) => [t.agentId, t.thought]));
  } catch {
    // Commentary is decoration; a model outage must not stop the competition.
    return {};
  }
}

export type TickResult = {
  round: number;
  t: number;
  entries: FeedEntry[];
  marks: Record<string, number>;
  /** True when no pool moved at all this round. */
  flat: boolean;
};

/**
 * One competitive round.
 *
 * Every agent looks at the same ticker so their disagreement is legible, the
 * ticker rotates each round so no single strategy is permanently favoured, and
 * each agent pays for its own data before it is allowed to act.
 */
export async function tick(origin: string): Promise<TickResult> {
  const state = await loadState();
  state.round += 1;

  const universe = await resolveUniverse();
  // One fetch per round, shared by every agent and heavily cached — the whole
  // point is that they all react to the *same* headlines.
  const news = await getNews(universe);
  const live = await snapshotMarket(universe, news);

  if (!live.length) {
    state.lastTickAt = Date.now();
    await saveState(state);
    return { round: state.round, t: state.lastTickAt, entries: [], marks: {}, flat: false };
  }

  // Detect a dormant chain so the UI can say so instead of looking broken.
  // These pools frequently go long stretches with no swaps at all, in which
  // case the live tape is genuinely flat and every honest strategy holds.
  const anyMovement = live.some(
    (s) => volatilityPct(s.candles) > 0 || Math.abs(changePct(s.candles)) > 0
  );
  state.flatRounds = anyMovement ? 0 : state.flatRounds + 1;

  const snaps = live;

  const bySymbol = Object.fromEntries(snaps.map((s) => [s.symbol, s]));
  const marks: Record<string, number> = Object.fromEntries(snaps.map((s) => [s.symbol, s.price]));

  const staged = await Promise.all(
    AGENTS.map(async (def) => {
      const book = state.books[def.id];
      const paid = await chargeForData(def.id, origin);

      // An invalid payment locks the agent out of the round — metering has to be
      // enforceable, not advisory. `unfunded` is not invalid: the authorization
      // verified, so the agent trades and the fee lands on its paper book.
      if (paid.status === "rejected") {
        return {
          def,
          paid,
          snap: snaps[0],
          decision: {
            action: "hold" as const,
            conviction: 0,
            rationale: `could not pay for the quote (${paid.reason ?? "rejected"})`,
            readout: {},
          },
          fill: { qty: 0, notional: 0, realized: 0 },
        };
      }

      book.x402SpentUsdg += paid.priceUsdg;
      book.x402Calls += 1;
      // The data fee comes out of the bankroll — being wrong is not free here.
      book.cashUsdg -= paid.priceUsdg;

      // An agent holding a position must always re-examine it, even if some
      // other ticker looks more attractive — otherwise nothing ever gets sold.
      const held = book.position ? bySymbol[book.position.symbol] : undefined;
      if (held && book.position) {
        // Risk exits run before the strategy's own opinion and short-circuit it.
        // A stop has to be able to fire while the entry signal still reads bullish
        // — that is precisely the case where leaving a strategy unsupervised does
        // the most damage.
        // Measured against the raw entry price. Fees are still charged on both
        // legs and land in realized P&L — they just don't pretend to be an
        // instant adverse price move the moment the position opens.
        const pnlBps =
          ((held.price - book.position.entryPrice) / book.position.entryPrice) * 10_000;
        const { takeProfitBps, stopLossBps } = riskBands(def, held);

        if (pnlBps >= takeProfitBps || pnlBps <= -stopLossBps) {
          const hit = pnlBps >= takeProfitBps;
          const exit: Decision = {
            action: "sell",
            conviction: 1,
            rationale: hit
              ? `take profit: +${pnlBps.toFixed(0)}bps through the ${takeProfitBps.toFixed(0)}bps target`
              : `stop loss: ${pnlBps.toFixed(0)}bps through the -${stopLossBps.toFixed(0)}bps limit`,
            readout: { pnlBps, entry: book.position.entryPrice, takeProfitBps, stopLossBps },
          };
          const fill = execute(book, exit, held, def.aggression);
          return { def, paid, snap: held, decision: exit, fill };
        }

        const exit = applyNews(def.decide(held, true), held, def);
        if (exit.action === "sell") {
          const fill = execute(book, exit, held, def.aggression);
          return { def, paid, snap: held, decision: exit, fill };
        }
      }

      // Otherwise scan the whole universe and take the strongest conviction.
      // Five agents reading five different signals across twelve names is where
      // the disagreement — and the competition — actually comes from.
      let best: { snap: Snapshot; decision: Decision } | null = null;
      for (const snap of snaps) {
        const holding = book.position?.symbol === snap.symbol;
        const decision = applyNews(def.decide(snap, holding), snap, def);
        if (decision.action === "hold") continue;
        if (decision.action === "buy" && book.position) continue; // one position at a time
        if (!best || decision.conviction > best.decision.conviction) best = { snap, decision };
      }

      if (!best) {
        // Report the flat verdict against the agent's own held name if it has
        // one, so the feed shows what it is actually watching.
        const focus = held ?? snaps[0];
        return {
          def,
          paid,
          snap: focus,
          decision: applyNews(
            def.decide(focus, book.position?.symbol === focus.symbol),
            focus,
            def
          ),
          fill: { qty: 0, notional: 0, realized: 0 },
        };
      }

      const fill = execute(book, best.decision, best.snap, def.aggression);
      return { def, paid, snap: best.snap, decision: best.decision, fill };
    })
  );

  // Commentary is the most expensive part of a round. Rounds where nobody
  // traded and the headlines haven't changed produce near-identical text, so
  // skip the model unless something actually happened or it's a periodic
  // refresh — at one round a minute the cost difference is the whole bill.
  const somethingHappened = staged.some((s) => s.decision.action !== "hold");
  const periodicRefresh = state.round % 5 === 0;

  const thoughts = somethingHappened || periodicRefresh
    ? await generateThoughts(
        staged.map((s) => ({
      agentId: s.def.id,
      symbol: s.snap.symbol,
      decision: s.decision,
      price: s.snap.price,
          paid: s.paid,
        })),
        news
      )
    : {};

  const t = Date.now();
  const entries: FeedEntry[] = staged.map((s, i) => ({
    id: `${state.round}-${s.def.id}`,
    t: t + i, // keeps the feed stably ordered within a round
    round: state.round,
    agentId: s.def.id,
    symbol: s.snap.symbol,
    action: s.decision.action,
    conviction: s.decision.conviction,
    rationale: s.decision.rationale,
    thought: thoughts[s.def.id] ?? "",
    price: s.snap.price,
    qty: s.fill.qty,
    notional: s.fill.notional,
    readout: s.decision.readout,
    x402: s.paid,
  }));

  state.feed = [...entries].reverse().concat(state.feed);
  state.lastTickAt = t;

  // Sample every agent's equity once per round. Marks come from this round's
  // snapshot, so a position in a ticker the round didn't touch falls back to its
  // cost basis rather than silently dropping out of the curve.
  state.curve.push({
    t,
    round: state.round,
    equity: Object.fromEntries(
      Object.values(state.books).map((book) => [book.id, equity(book, marks)])
    ),
  });

  await saveState(state);

  return { round: state.round, t, entries, marks, flat: state.flatRounds > 0 };
}

/** Mark every open position to live pool prices for the leaderboard. */
export async function markPositions(state: ArenaState): Promise<Record<string, number>> {
  const symbols = [
    ...new Set(
      Object.values(state.books)
        .map((b) => b.position?.symbol)
        .filter((s): s is string => !!s)
    ),
  ];
  if (!symbols.length) return {};
  // Marking to market only needs prices — skip the news fetch entirely rather
  // than paying for a web search to compute a number that ignores it.
  const snaps = await snapshotMarket(symbols, { fetchedAt: 0, items: [], verified: false });
  return Object.fromEntries(snaps.map((s) => [s.symbol, s.price]));
}

export { equity };
