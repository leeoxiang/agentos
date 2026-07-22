import { NextResponse } from "next/server";
import { tick } from "@/lib/arena/engine";
import { guard, isCron } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Run one competitive round.
 *
 * Guarded against overlap: a round that is still signing payments or waiting on
 * commentary must not be re-entered by the next caller, or two rounds would
 * interleave writes to the same books.
 */
let running = false;

async function runRound(req: Request) {
  if (running)
    return NextResponse.json({ error: "round already in progress", busy: true }, { status: 429 });

  running = true;
  try {
    const origin = new URL(req.url).origin;
    const result = await tick(origin);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "round failed" },
      { status: 500 }
    );
  } finally {
    running = false;
  }
}

/**
 * The cron entry point. Vercel issues a GET and attaches
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Unauthenticated GETs are refused outright — every round costs a model call, so
 * an open endpoint here is an open tab on the operator's bill. With no
 * CRON_SECRET configured `isCron` returns false and this stays shut, which is
 * the correct default for something that spends money.
 */
export async function GET(req: Request) {
  if (!isCron(req))
    return NextResponse.json(
      { error: "unauthorized: this endpoint is cron-only. Use POST from the UI." },
      { status: 401 }
    );
  return runRound(req);
}

/** The UI entry point: anyone may call it, but not quickly. */
export async function POST(req: Request) {
  const limited = await guard(req, "arenaTick");
  if (limited) return limited;
  return runRound(req);
}
