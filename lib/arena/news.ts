import Anthropic from "@anthropic-ai/sdk";
import { kvGet, kvSet } from "../kv";
import { STOCKS } from "../stocks";

/**
 * Real, verifiable headlines for the tickers the agents trade.
 *
 * Two integrity rules, because "the model returned a plausible headline" is not
 * the same thing as "this happened":
 *
 *  1. A response that did not actually invoke web search is discarded. Without
 *     that check a search failure degrades silently into the model reciting its
 *     training data as today's news — stale, confident, and indistinguishable
 *     from the real thing.
 *  2. Every item must carry a resolvable URL and a publish date. An item without
 *     a source is dropped rather than shown, which removes the room a model has
 *     to pad a real search result with recalled detail.
 *
 * Anything surviving both is rendered with its link and age visible, so a reader
 * can check it rather than take our word for it.
 */

export type TickerNews = {
  symbol: string;
  /** -1 (clearly bearish) … +1 (clearly bullish). 0 when genuinely mixed. */
  sentiment: number;
  headline: string;
  source: string;
  /** Resolvable link to the article. Items without one are dropped. */
  url: string;
  /** ISO date the article was published. */
  publishedAt: string;
  summary: string;
};

export type NewsSnapshot = {
  fetchedAt: number;
  items: TickerNews[];
  /** False when search didn't run — the UI says so instead of implying freshness. */
  verified: boolean;
};

const KEY = "agentos:arena:news:v2";
const TTL_MS = 10 * 60_000;
/** Older than this and it isn't news, it's history. */
const MAX_AGE_HOURS = 72;

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
          url: { type: "string" },
          publishedAt: { type: "string" },
          summary: { type: "string" },
        },
        required: ["symbol", "sentiment", "headline", "source", "url", "publishedAt", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const EMPTY: NewsSnapshot = { fetchedAt: 0, items: [], verified: false };

function hoursOld(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

/**
 * Fetch headlines for the given tickers, or serve a still-fresh cache.
 *
 * Returns an empty, unverified snapshot rather than throwing — news is an input
 * to the agents, not a precondition for them running.
 */
export async function getNews(symbols: string[]): Promise<NewsSnapshot> {
  const cached = await kvGet<NewsSnapshot>(KEY);
  if (cached?.verified && Date.now() - cached.fetchedAt < TTL_MS) {
    const covered = new Set(cached.items.map((i) => i.symbol));
    if (symbols.every((s) => covered.has(s))) return cached;
  }

  if (!process.env.ANTHROPIC_API_KEY || !symbols.length) return cached ?? EMPTY;

  const named = symbols
    .map((s) => {
      const stock = STOCKS.find((x) => x.symbol === s);
      return stock ? `${stock.symbol} (${stock.name})` : s;
    })
    .join(", ");

  // The model has no clock, and left to itself it searches without any recency
  // intent — measured runs came back with articles 15 days old that it presented
  // as current. Handing it today's and yesterday's dates, and telling it to put
  // them in the query, moved that to under 48 hours.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      system:
        `Today is ${today}. You surface genuinely recent market news for trading agents.\n\n` +
        "You MUST use web search for every ticker. Never answer from memory — your training " +
        "data is months stale and will be wrong.\n\n" +
        "For each ticker return the single most recent, most material article you actually found:\n" +
        "- url: the real article URL from your search results. Never construct or guess a URL.\n" +
        "- publishedAt: the article's own publish date, ISO format. Never today's date by default.\n" +
        "- headline: the article's actual headline, not a paraphrase.\n" +
        "- sentiment: -1 (clearly bearish) to +1 (clearly bullish), 0 when mixed or immaterial. " +
        "Be calibrated — most days are near zero.\n" +
        "- summary: one short sentence a trader could act on.\n\n" +
        "If search returns nothing recent for a ticker, omit that ticker entirely. Do not invent " +
        "an entry, and do not pad a real article with details you did not read. An omitted ticker " +
        "is correct; a fabricated one is not.",
      messages: [
        { role: "user", content: `Search for the latest news on each of: ${named}.` },
      ],
    });

    // Integrity gate: if search never ran, whatever came back is recall, not news.
    const searched = response.content.some(
      (b) => b.type === "server_tool_use" || b.type === "web_search_tool_result"
    );
    if (!searched) return cached ?? EMPTY;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = JSON.parse(text) as { items: TickerNews[] };

    const items = parsed.items
      .map((i) => ({
        ...i,
        sentiment: Math.max(-1, Math.min(1, Number(i.sentiment) || 0)),
      }))
      // No source, no publication: drop it. This is the check that removes the
      // model's room to pad a real result with invented specifics.
      .filter((i) => /^https?:\/\/\S+\.\S+/.test(i.url ?? ""))
      .filter((i) => hoursOld(i.publishedAt) <= MAX_AGE_HOURS)
      .filter((i) => symbols.includes(i.symbol))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

    const snapshot: NewsSnapshot = { fetchedAt: Date.now(), items, verified: true };
    await kvSet(KEY, snapshot);
    return snapshot;
  } catch {
    return cached ?? EMPTY;
  }
}

export function sentimentFor(news: NewsSnapshot, symbol: string): number {
  return news.items.find((i) => i.symbol === symbol)?.sentiment ?? 0;
}

export function headlineFor(news: NewsSnapshot, symbol: string): TickerNews | null {
  return news.items.find((i) => i.symbol === symbol) ?? null;
}
