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
const g = globalThis as unknown as { __agentosKv?: Map<string, string> };
const memory: Map<string, string> = (g.__agentosKv ??= new Map());

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
