import { NextResponse } from "next/server";
import { tick } from "@/lib/arena/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Run one competitive round.
 *
 * Guarded against overlap: a round that is still signing payments or waiting on
 * commentary must not be re-entered by the next poll, or two rounds would
 * interleave writes to the same books.
 */
let running = false;

export async function POST(req: Request) {
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
