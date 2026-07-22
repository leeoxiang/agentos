/**
 * Tiny durable key-value layer.
 *
 * Serverless functions get a fresh module scope whenever a new instance spins
 * up, so anything the arena wants to survive between requests has to live
 * somewhere else. This talks to Upstash/Vercel KV over plain REST — no SDK, no
 * connection pooling to get wrong — and silently degrades to an in-process Map
 * when no credentials are configured, so local development needs no setup.
 *
 * `isDurable()` is exported so the UI can tell the user which mode they are in
 * rather than letting them assume persistence they don't have.
 */

const URL_ENV = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_ENV = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const isDurable = () => Boolean(URL_ENV && TOKEN_ENV);

// Survives hot-reload in dev, where module identity is otherwise discarded.
const g = globalThis as unknown as {
  __agentosKv?: Map<string, string>;
  __agentosCounters?: Map<string, { count: number; expires: number }>;
};
const memory: Map<string, string> = (g.__agentosKv ??= new Map());
const counters: Map<string, { count: number; expires: number }> = (g.__agentosCounters ??=
  new Map());

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!isDurable()) {
    const raw = memory.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  try {
    const res = await fetch(`${URL_ENV}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOKEN_ENV}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result: string | null };
    return body.result ? (JSON.parse(body.result) as T) : null;
  } catch {
    // A KV outage must not take the whole page down — callers treat null as
    // "no state yet" and rebuild from defaults.
    return null;
  }
}

/**
 * Atomic increment with a TTL on first write.
 *
 * Rate limiting cannot be built on get-then-set: two requests that read the same
 * counter both write `n+1`, and the limit silently doubles under exactly the
 * concurrency it exists to stop. Redis INCR is atomic, so the counter is correct
 * no matter how many instances are serving.
 *
 * Returns the post-increment count, or null if the store is unreachable — the
 * caller decides whether to fail open or closed.
 */
export async function kvIncr(key: string, ttlSeconds: number): Promise<number | null> {
  if (!isDurable()) {
    const now = Date.now();
    const hit = counters.get(key);
    if (!hit || hit.expires <= now) {
      counters.set(key, { count: 1, expires: now + ttlSeconds * 1000 });
      return 1;
    }
    hit.count += 1;
    return hit.count;
  }

  try {
    const res = await fetch(`${URL_ENV}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOKEN_ENV}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result: number };

    // Only the first request in a window sets the expiry; re-setting it on every
    // hit would slide the window forward forever and the limit would never reset.
    if (body.result === 1) {
      await fetch(`${URL_ENV}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
        headers: { Authorization: `Bearer ${TOKEN_ENV}` },
        cache: "no-store",
      }).catch(() => {});
    }
    return body.result;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
  const payload = JSON.stringify(value);
  if (!isDurable()) {
    memory.set(key, payload);
    return true;
  }
  try {
    const res = await fetch(`${URL_ENV}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN_ENV}`, "Content-Type": "text/plain" },
      body: payload,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
