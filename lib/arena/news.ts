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
  /**
   * Tickers this snapshot was *fetched for*, which is not the same as the
   * tickers it returned — see the coverage note on `isFresh`.
   */
  askedFor?: string[];
  /**
   * Set when a fetch ran and produced nothing usable. Without it a barren
   * result is indistinguishable from a cold cache, and every caller retries
   * the search immediately.
   */
  attemptedAt?: number;
};

const KEY = "agentos:arena:news:v2";
const TTL_MS = 10 * 60_000;
/**
 * Hard floor between paid searches, independent of cache state.
 *
 * The TTL alone is not a spend limit: a barren or failed fetch leaves nothing
 * fresh behind, so every subsequent caller sees a stale cache and pays for
 * another search. This floor is the backstop that makes the worst case
 * "one search per interval" rather than "one search per request".
 */
const MIN_FETCH_INTERVAL_MS = 5 * 60_000;
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

/**
 * Is this snapshot good enough to serve without paying for another search?
 *
 * Deliberately time-based and *not* coverage-based. The prompt instructs the
 * model to omit any ticker it can't verify — "an omitted ticker is correct" —
 * and the URL and freshness filters below drop more. So a healthy snapshot
 * routinely covers only some of the universe. The previous check required
 * every requested symbol to be present, which a correct response could almost
 * never satisfy: the cache was written every time and read almost never, and
 * each miss cost an Opus call with six web searches.
 *
 * Coverage is still consulted, but only to let a genuinely new ticker refresh
 * early — never to invalidate an otherwise fresh snapshot.
 */
function isFresh(snap: NewsSnapshot | null, symbols: string[]): boolean {
  if (!snap?.verified) return false;
  if (Date.now() - snap.fetchedAt >= TTL_MS) return false;
  // A symbol we've never even asked about is worth an early refresh; one we
  // asked about and got nothing for is a legitimate omission, not a miss.
  const asked = new Set(snap.askedFor ?? snap.items.map((i) => i.symbol));
  return symbols.every((s) => asked.has(s));
}

/**
 * Read-only view of the cache.
 *
 * Read paths must use this. `getNews` can spend money, and calling it from a
 * polled GET endpoint turns every open browser tab into a recurring bill.
 */
export async function peekNews(): Promise<NewsSnapshot> {
  return (await kvGet<NewsSnapshot>(KEY)) ?? EMPTY;
}

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
  if (cached && isFresh(cached, symbols)) return cached;

  if (!process.env.ANTHROPIC_API_KEY || !symbols.length) return cached ?? EMPTY;

  // Spend floor. Applies even when the cache is stale, empty, or was written by
  // a fetch that found nothing — those are exactly the states that otherwise
  // let every caller pay for its own search.
  const lastAttempt = Math.max(cached?.attemptedAt ?? 0, cached?.fetchedAt ?? 0);
  if (Date.now() - lastAttempt < MIN_FETCH_INTERVAL_MS) return cached ?? EMPTY;

  // Within a single warm instance, collapse concurrent misses onto one request
  // so a burst of traffic can't fan out into a burst of searches.
  if (inFlight) return inFlight;
  inFlight = fetchNews(symbols, cached).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** In-flight de-duplication for {@link getNews}. */
let inFlight: Promise<NewsSnapshot> | null = null;

async function fetchNews(
  symbols: string[],
  cached: NewsSnapshot | null
): Promise<NewsSnapshot> {
  // Stamp the attempt up front. If the search returns nothing usable, or throws,
  // this is what stops the next caller from immediately paying to try again.
  const attemptedAt = Date.now();
  const barren = (): NewsSnapshot => ({
    ...(cached ?? EMPTY),
    attemptedAt,
    askedFor: symbols,
  });
  const remember = async (snap: NewsSnapshot) => {
    await kvSet(KEY, snap);
    return snap;
  };

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
        `Today is ${today}. You surface breaking market news for trading agents that act on it ` +
        "within minutes. Recency is the entire point — an article from last week is worthless here.\n\n" +
        "You MUST use web search for every ticker. Never answer from memory; your training data is " +
        "months stale and will be wrong.\n\n" +
        "Search strategy, for every ticker:\n" +
        `- Put the date in the query, e.g. "<TICKER> stock news ${today}" and "<TICKER> stock ${yesterday}".\n` +
        `- Prefer results published today (${today}) or yesterday (${yesterday}).\n` +
        "- If the best result is over a week old, search again with a tighter query before settling.\n\n" +
        "Return the single most recent material article you actually found:\n" +
        "- url: the real article URL from your search results. Never construct or guess a URL.\n" +
        "- publishedAt: the article's own publish date, ISO format. Never default to today.\n" +
        "- headline: the article's actual headline, not a paraphrase.\n" +
        "- sentiment: -1 (clearly bearish) to +1 (clearly bullish), 0 when mixed or immaterial. " +
        "Be calibrated — most days are near zero.\n" +
        "- summary: one short sentence a trader could act on.\n\n" +
        "Omit a ticker entirely rather than returning something stale or invented. An omitted " +
        "ticker is correct; a fabricated one is not.",
      messages: [
        {
          role: "user",
          content: `Breaking news from the last 48 hours for: ${named}. Today is ${today}.`,
        },
      ],
    });

    // Integrity gate: if search never ran, whatever came back is recall, not news.
    const searched = response.content.some(
      (b) => b.type === "server_tool_use" || b.type === "web_search_tool_result"
    );
    if (!searched) return remember(barren());

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

    // Merge rather than replace: a ticker legitimately omitted this round keeps
    // its previous headline until that headline ages out, instead of the feed
    // flickering empty every time the model declines to verify one.
    const merged = [
      ...items,
      ...(cached?.items ?? []).filter(
        (old) =>
          !items.some((fresh) => fresh.symbol === old.symbol) &&
          symbols.includes(old.symbol) &&
          hoursOld(old.publishedAt) <= MAX_AGE_HOURS
      ),
    ].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

    return remember({
      fetchedAt: Date.now(),
      items: merged,
      verified: true,
      askedFor: symbols,
      attemptedAt,
    });
  } catch {
    return remember(barren());
  }
}

export function sentimentFor(news: NewsSnapshot, symbol: string): number {
  return news.items.find((i) => i.symbol === symbol)?.sentiment ?? 0;
}

export function headlineFor(news: NewsSnapshot, symbol: string): TickerNews | null {
  return news.items.find((i) => i.symbol === symbol) ?? null;
}
