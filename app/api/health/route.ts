import { NextResponse } from "next/server";
import { rpc } from "@/lib/rpc";
import { isDurable, kvGet } from "@/lib/kv";
import { loadState } from "@/lib/arena/store";
import { facilitatorAccount } from "@/lib/x402/facilitator";
import { PAY_TO } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Is the system actually running?
 *
 * The arena is the front door and it advances on a cron, so a silent failure —
 * a broken schedule, a rate-limited RPC, an expired API key — presents to a
 * visitor as a leaderboard that simply stopped moving. Nothing else on the site
 * would look wrong. This is the check that turns that into a visible red dot.
 */

/** Rounds fire every minute; past this, something is wrong rather than slow. */
const STALE_AFTER_MS = 5 * 60_000;

type Check = { ok: boolean; detail: string };

export async function GET() {
  const checks: Record<string, Check> = {};

  // Chain reachability — everything else depends on it.
  const startedAt = Date.now();
  try {
    const block = await rpc.getBlockNumber();
    checks.rpc = { ok: true, detail: `block ${block} in ${Date.now() - startedAt}ms` };
  } catch (e) {
    checks.rpc = { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "unreachable" };
  }

  try {
    await kvGet("agentos:health:probe");
    checks.storage = {
      ok: true,
      detail: isDurable() ? "durable (KV)" : "in-memory — state resets on cold start",
    };
    // In-memory is functional but not healthy for a deployed instance.
    if (!isDurable()) checks.storage.ok = false;
  } catch (e) {
    checks.storage = { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "failed" };
  }

  // The one that actually catches a dead cron.
  try {
    const state = await loadState();
    const age = state.lastTickAt ? Date.now() - state.lastTickAt : null;
    if (age === null) {
      checks.arena = { ok: false, detail: "no round has ever run" };
    } else {
      const mins = Math.round(age / 60_000);
      checks.arena = {
        ok: age < STALE_AFTER_MS,
        detail:
          age < STALE_AFTER_MS
            ? `round ${state.round}, ${mins}m ago`
            : `STALE — last round ${mins}m ago (cron may be down)`,
      };
    }
  } catch (e) {
    checks.arena = { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "failed" };
  }

  checks.model = {
    ok: !!process.env.ANTHROPIC_API_KEY,
    detail: process.env.ANTHROPIC_API_KEY ? "configured" : "ANTHROPIC_API_KEY missing",
  };

  checks.payments = {
    ok: PAY_TO !== "0x0000000000000000000000000000000000000000",
    detail:
      PAY_TO === "0x0000000000000000000000000000000000000000"
        ? "NEXT_PUBLIC_PAY_TO unset — x402 cannot settle"
        : facilitatorAccount()
          ? "receiver set, facilitator armed"
          : "receiver set, verify-only (no facilitator)",
  };

  const failing = Object.entries(checks).filter(([, c]) => !c.ok);
  const healthy = failing.length === 0;

  return NextResponse.json(
    {
      healthy,
      status: healthy ? "ok" : "degraded",
      failing: failing.map(([k]) => k),
      checks,
      checkedAt: Date.now(),
    },
    // 503 so an uptime monitor can watch this without parsing the body.
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
