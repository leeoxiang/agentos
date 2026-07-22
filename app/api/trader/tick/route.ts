import { NextResponse } from "next/server";
import { markToMarket, tick } from "@/lib/trader/engine";
import { store } from "@/lib/trader/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Run one strategy pass.
 *
 * Driven by the dashboard while it is open, and safe to point a cron at for
 * unattended operation. Guarded against overlap: a slow tick that is still
 * broadcasting must not be re-entered by the next poll.
 */
let running = false;

export async function POST() {
  if (running)
    return NextResponse.json({ error: "tick already in progress", busy: true }, { status: 429 });

  running = true;
  try {
    const result = await tick();
    const positions = await markToMarket();
    return NextResponse.json({ ...result, positions, log: store.log.slice(0, 60) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "tick failed" }, { status: 500 });
  } finally {
    running = false;
  }
}
