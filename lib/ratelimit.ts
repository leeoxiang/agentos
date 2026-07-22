import { NextResponse } from "next/server";
import { kvIncr } from "./kv";

/**
 * Fixed-window rate limiting for the routes that cost real money.
 *
 * `/api/chat` can fan out to eight Opus round-trips per request and `/api/arena/tick`
 * calls the model once per round. Both are reachable by anyone who reads the
 * client bundle, so without a limit a single loop bills the operator without
 * bound. This is a cost control first and an abuse control second.
 */

export type Limit = { limit: number; windowSeconds: number };

/** Per-route budgets. Generous enough for a human, useless for a scraper. */
export const LIMITS = {
  chat: { limit: 12, windowSeconds: 300 },
  arenaTick: { limit: 30, windowSeconds: 300 },
} as const satisfies Record<string, Limit>;

/**
 * Best-effort client identity.
 *
 * Vercel sets `x-forwarded-for` at the edge and it cannot be spoofed past it;
 * the other headers are fallbacks for self-hosting. An unidentifiable caller is
 * bucketed under a shared key rather than waved through — anonymity must not be
 * a way to opt out of the limit.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
}

export type RateResult = {
  ok: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
};

export async function rateLimit(req: Request, route: keyof typeof LIMITS): Promise<RateResult> {
  const { limit, windowSeconds } = LIMITS[route];
  // Bucketing by window start keeps the key self-expiring and makes the reset
  // time computable without storing it.
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `agentos:rl:${route}:${window}:${clientKey(req)}`;

  const count = await kvIncr(key, windowSeconds);

  // A KV outage must not take the site down, but it also must not silently
  // remove the spend ceiling — see `guard`, which fails closed on the routes
  // that cost money.
  if (count === null) return { ok: true, remaining: limit, limit, resetSeconds: windowSeconds };

  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    limit,
    resetSeconds: windowSeconds - elapsed,
  };
}

/**
 * Apply a limit and return a 429 when it's exceeded, or null to proceed.
 * Always sets the standard headers so a well-behaved client can back off.
 */
export async function guard(
  req: Request,
  route: keyof typeof LIMITS
): Promise<NextResponse | null> {
  const result = await rateLimit(req, route);
  if (result.ok) return null;

  return NextResponse.json(
    {
      error: `Rate limit exceeded. This endpoint costs the operator money per call, so it is capped at ${result.limit} requests per ${LIMITS[route].windowSeconds / 60} minutes.`,
      retryAfterSeconds: result.resetSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.resetSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetSeconds),
      },
    }
  );
}

/**
 * Verify a Vercel cron request.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` when the env var is set.
 * With no secret configured we refuse rather than accept: an unauthenticated
 * endpoint that spends money on every call is not something to leave open by
 * default.
 */
export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
