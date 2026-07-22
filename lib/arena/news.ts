import Anthropic from "@anthropic-ai/sdk";
import { kvGet, kvSet } from "../kv";
import { STOCKS } from "../stocks";

/**
 * Real headlines for the tickers the agents trade.
 *
 * The agents read on-chain price and depth, which tells them *what* the market
 * did but never *why*. News closes that gap: a sentiment read per ticker feeds
 * one agent's strategy directly, and the headlines ground every agent's
 * commentary in something that actually happened rather than pure price talk.
 *
 * Fetched with Claude's server-side web search and cached hard — search is the
 * most expensive call in the system and headlines do not change by the minute.
 */

export type TickerNews = {
  symbol: string;
  /** -1 (clearly bearish) … +1 (clearly bullish). 0 when genuinely mixed. */
  sentiment: number;
  headline: string;
  source: string;
  summary: string;
};

export type NewsSnapshot = {
  fetchedAt: number;
  items: TickerNews[];
};

const KEY = "agentos:arena:news:v1";
/** Long by design: search is expensive and headlines are not tick data. */
const TTL_MS = 20 * 60_000;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          sentiment: { type: "number" },
          headline: { type: "string" },
          source: { type: "string" },
          summary: { type: "string" },
        },
        required: ["symbol", "sentiment", "headline", "source", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/**
 * Fetch headlines for the given tickers, or serve the cache.
 *
 * Returns an empty snapshot rather than throwing when search is unavailable —
 * news is an input to the agents, not a precondition for them running.
 */
export async function getNews(symbols: string[]): Promise<NewsSnapshot> {
  const cached = await kvGet<NewsSnapshot>(KEY);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    // Serve the cache only if it actually covers what's being asked for; a
    // universe rotation shouldn't silently return news about other tickers.
    const covered = new Set(cached.items.map((i) => i.symbol));
    if (symbols.every((s) => covered.has(s))) return cached;
  }

  if (!process.env.ANTHROPIC_API_KEY || !symbols.length)
    return cached ?? { fetchedAt: Date.now(), items: [] };

  const named = symbols
    .map((s) => {
      const stock = STOCKS.find((x) => x.symbol === s);
      return stock ? `${stock.symbol} (${stock.name})` : s;
    })
    .join(", ");

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      system:
        "You surface market-moving news for trading agents. Search for the most recent " +
        "headline about each company, then return one entry per ticker.\n\n" +
        "sentiment is a number from -1 (clearly bearish for the stock) to +1 (clearly bullish), " +
        "0 when the news is genuinely mixed or nothing material happened. Be calibrated: most " +
        "days are near zero. Do not invent a headline — if you find nothing recent for a ticker, " +
        "say so in the headline field, set sentiment to 0, and set source to 'none'. " +
        "summary must be one short sentence a trader could act on.",
      messages: [
        {
          role: "user",
          content: `Latest market news for: ${named}. One entry per ticker.`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = JSON.parse(text) as { items: TickerNews[] };
    const snapshot: NewsSnapshot = {
      fetchedAt: Date.now(),
      items: parsed.items.map((i) => ({
        ...i,
        // Clamp: the model is asked for -1..1 but the strategy divides by this,
        // and an out-of-range value would silently distort position sizing.
        sentiment: Math.max(-1, Math.min(1, Number(i.sentiment) || 0)),
      })),
    };
    await kvSet(KEY, snapshot);
    return snapshot;
  } catch {
    // Stale news beats no news; no news beats a broken round.
    return cached ?? { fetchedAt: Date.now(), items: [] };
  }
}

export function sentimentFor(news: NewsSnapshot, symbol: string): number {
  return news.items.find((i) => i.symbol === symbol)?.sentiment ?? 0;
}

export function headlineFor(news: NewsSnapshot, symbol: string): TickerNews | null {
  return news.items.find((i) => i.symbol === symbol) ?? null;
}
