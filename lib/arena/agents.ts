import { changePct, rangePosition, sma, volatilityPct, type Candle } from "../twap";

/**
 * The five competitors.
 *
 * They are not five copies of one strategy with different constants — each one
 * reads a *different signal* out of the same market data, so they genuinely
 * disagree and take opposite sides. Robinhood Chain pools are thin and move in
 * single-digit basis points, so thresholds are calibrated in bps, not percent;
 * a strategy tuned for equity-market volatility would simply never fire here.
 */

export type Decision = {
  action: "buy" | "sell" | "hold";
  /** 0..1 — drives position sizing and shows up as the conviction bar. */
  conviction: number;
  /** One-line machine rationale. The LLM commentary is generated separately. */
  rationale: string;
  /** Whichever numbers this strategy actually looked at, for the UI. */
  readout: Record<string, number>;
};

export type MarketView = {
  symbol: string;
  price: number;
  depthUsdg: number;
  candles: Candle[];
  /** -1..+1 from real headlines. 0 when there is no news, or it is genuinely mixed. */
  sentiment: number;
  headline: string | null;
};

export type AgentDef = {
  id: string;
  name: string;
  handle: string;
  color: string;
  /** Shown under the name; also seeds the LLM's voice. */
  style: string;
  thesis: string;
  /** Voice instructions for the commentary model. */
  voice: string;
  /** Fraction of bankroll committed at full conviction. */
  aggression: number;
  /**
   * Risk exits as multiples of the ticker's own realised volatility.
   *
   * Fixed basis-point bands cannot work across these markets: one round's noise
   * is larger than a 10bps stop, so a fixed stop fires on entry every time,
   * while a dormant pool would never reach it at all. Expressing the bands
   * relative to observed volatility makes them mean the same thing on a quiet
   * pool and a busy one. The engine additionally floors them above the pool's
   * round-trip fee — a target inside trading costs is unwinnable by
   * construction.
   */
  takeProfitMult: number;
  stopLossMult: number;
  /**
   * How this agent reacts to the news, from -1 to +1.
   *
   * Every agent reads the same headlines; what differs is what they do with
   * them. A trend follower leans into a catalyst, a mean-reverter fades it, and
   * a liquidity trader mostly doesn't care. Making this a weight rather than a
   * sixth "news agent" keeps the disagreement where it belongs — in how the
   * same information is interpreted.
   */
  newsWeight: number;
  decide: (view: MarketView, holding: boolean) => Decision;
};

const bps = (a: number, b: number) => ((a - b) / b) * 10_000;

export const AGENTS: AgentDef[] = [
  {
    id: "momo",
    name: "Momo",
    handle: "@momentum",
    color: "#ff6a1f",
    style: "Trend follower",
    thesis: "Fast SMA over slow SMA. Buy strength, cut weakness, never argue with the tape.",
    voice:
      "Punchy and decisive, a little cocky. Talks in momentum terms — 'tape', 'strength', 'rolling over'. Short sentences.",
    aggression: 0.35,
    takeProfitMult: 3.0,
    stopLossMult: 1.6,
    newsWeight: 0.8,
    decide: ({ candles }, holding) => {
      const fast = sma(candles, 4);
      const slow = sma(candles, 12);
      if (fast === null || slow === null)
        return { action: "hold", conviction: 0, rationale: "not enough oracle history", readout: {} };

      const spread = bps(fast, slow);
      const readout = { spreadBps: spread, fast, slow };
      // 3bps is roughly one tick of drift on these pools — below that it's noise.
      if (spread > 3)
        return {
          action: holding ? "hold" : "buy",
          conviction: Math.min(1, spread / 25),
          rationale: holding
            ? `already long, trend intact at +${spread.toFixed(1)}bps`
            : `fast SMA ${spread.toFixed(1)}bps over slow — trend is up`,
          readout,
        };
      if (spread < -3 && holding)
        return {
          action: "sell",
          conviction: Math.min(1, -spread / 25),
          rationale: `fast SMA ${spread.toFixed(1)}bps under slow — trend broke`,
          readout,
        };
      return {
        action: "hold",
        conviction: 0,
        rationale: `${spread.toFixed(1)}bps inside the noise band`,
        readout,
      };
    },
  },
  {
    id: "vega",
    name: "Vega",
    handle: "@meanrevert",
    color: "#3ecf8e",
    style: "Mean reversion",
    thesis: "Fade the extremes. When price pins the top of its range, sell it; at the bottom, buy it.",
    voice:
      "Dry, contrarian, faintly amused by everyone else's excitement. Talks about 'stretch', 'snapback', 'reverting'.",
    aggression: 0.3,
    takeProfitMult: 2.2,
    stopLossMult: 2.2,
    newsWeight: -0.6,
    decide: ({ candles }, holding) => {
      if (candles.length < 6)
        return { action: "hold", conviction: 0, rationale: "range undefined", readout: {} };
      const pos = rangePosition(candles);
      const readout = { rangePos: pos, samples: candles.length };

      if (pos < 0.25 && !holding)
        return {
          action: "buy",
          conviction: Math.min(1, (0.25 - pos) * 4),
          rationale: `pinned at ${(pos * 100).toFixed(0)}% of range — stretched low`,
          readout,
        };
      if (pos > 0.75 && holding)
        return {
          action: "sell",
          conviction: Math.min(1, (pos - 0.75) * 4),
          rationale: `${(pos * 100).toFixed(0)}% of range — taking the snapback`,
          readout,
        };
      return {
        action: "hold",
        conviction: 0,
        rationale: `mid-range at ${(pos * 100).toFixed(0)}% — nothing to fade`,
        readout,
      };
    },
  },
  {
    id: "byte",
    name: "Byte",
    handle: "@breakout",
    color: "#e5b567",
    style: "Breakout hunter",
    thesis: "Sit flat through the chop, then commit hard the moment price clears the window high.",
    voice:
      "Terse and technical, almost clipped. Uses 'range', 'clears', 'expansion', 'flat'. Rarely more than two sentences.",
    aggression: 0.5,
    takeProfitMult: 4.5,
    stopLossMult: 1.3,
    newsWeight: 0.5,
    decide: ({ candles }, holding) => {
      if (candles.length < 8)
        return { action: "hold", conviction: 0, rationale: "no range established", readout: {} };
      const prices = candles.map((c) => c.price);
      const last = prices[prices.length - 1];
      // Compare against the prior window, excluding the bar being tested.
      const prior = prices.slice(0, -1);
      const hi = Math.max(...prior);
      const lo = Math.min(...prior);
      const breakUp = bps(last, hi);
      const breakDown = bps(last, lo);
      const readout = { breakoutBps: breakUp, hi, lo };

      if (breakUp > 1 && !holding)
        return {
          action: "buy",
          conviction: Math.min(1, breakUp / 12),
          rationale: `cleared window high by ${breakUp.toFixed(1)}bps`,
          readout,
        };
      if (breakDown < -1 && holding)
        return {
          action: "sell",
          conviction: Math.min(1, -breakDown / 12),
          rationale: `lost window low by ${(-breakDown).toFixed(1)}bps`,
          readout,
        };
      return {
        action: "hold",
        conviction: 0,
        rationale: holding ? "holding through the range" : "no break — staying flat",
        readout,
      };
    },
  },
  {
    id: "nova",
    name: "Nova",
    handle: "@liquidity",
    color: "#7aa2f7",
    style: "Liquidity seeker",
    thesis: "Only trade where you can actually get out. Depth first, direction second.",
    voice:
      "Measured and risk-aware, the adult in the room. Talks about 'depth', 'slippage', 'exit', 'size'. Slightly professorial.",
    aggression: 0.4,
    takeProfitMult: 2.6,
    stopLossMult: 1.9,
    newsWeight: 0.15,
    decide: ({ depthUsdg, candles }, holding) => {
      const drift = changePct(candles);
      const readout = { depthUsdg, driftPct: drift };
      // Sized as a multiple of a typical position rather than an absolute floor:
      // an absolute wall calibrated to equity markets rejects every pool here.
      const TYPICAL_POSITION = 400;
      const cover = depthUsdg / TYPICAL_POSITION;

      if (cover < 25)
        return {
          action: holding ? "sell" : "hold",
          conviction: holding ? 0.6 : 0,
          rationale: holding
            ? `depth fell to ${cover.toFixed(0)}× my size — exiting while I can`
            : `only ${cover.toFixed(0)}× my size in the pool — can't get out of that`,
          readout,
        };
      if (!holding && drift >= 0)
        return {
          action: "buy",
          conviction: Math.min(1, Math.log10(cover) / 3),
          rationale: `${Math.round(depthUsdg).toLocaleString()} USDG deep — ${cover.toFixed(0)}× my size, exit is clean`,
          readout,
        };
      return {
        action: "hold",
        conviction: 0,
        rationale: holding ? `${cover.toFixed(0)}× cover, staying` : "deep enough, but drifting the wrong way",
        readout,
      };
    },
  },
  {
    id: "zen",
    name: "Zen",
    handle: "@patient",
    color: "#bb9af7",
    style: "Volatility patient",
    thesis: "Do nothing, expensively well. Only wake up when realised volatility says something changed.",
    voice:
      "Calm, unhurried, occasionally philosophical about doing nothing. Never excited. One or two short sentences.",
    aggression: 0.6,
    takeProfitMult: 5.5,
    stopLossMult: 2.6,
    newsWeight: 0.45,
    decide: ({ candles }, holding) => {
      const vol = volatilityPct(candles);
      const drift = changePct(candles);
      const readout = { volPct: vol, driftPct: drift };
      if (candles.length < 10)
        return { action: "hold", conviction: 0, rationale: "waiting for the tape to speak", readout };

      // Dormant pools read ~0% vol; anything waking up is the signal.
      if (vol > 0.004 && drift > 0 && !holding)
        return {
          action: "buy",
          conviction: Math.min(1, vol / 0.02),
          rationale: `vol woke up to ${vol.toFixed(4)}% with upward drift`,
          readout,
        };
      if (holding && drift < 0)
        return {
          action: "sell",
          conviction: 0.5,
          rationale: `drift turned ${drift.toFixed(3)}% — patience over`,
          readout,
        };
      return {
        action: "hold",
        conviction: 0,
        rationale: vol < 0.001 ? "market is asleep. so am I" : "nothing worth acting on",
        readout,
      };
    },
  },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
