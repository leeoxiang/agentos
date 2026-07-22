import { exposureUsdg, store, type Policy, type Sample } from "./store";

export type Signal = {
  symbol: string;
  action: "buy" | "sell" | "hold";
  reason: string;
  price: number;
  fast: number | null;
  slow: number | null;
  spreadBps: number | null;
  /** USDG for a buy, shares for a sell. */
  amount: number;
};

export function sma(samples: Sample[], period: number): number | null {
  if (samples.length < period) return null;
  const slice = samples.slice(-period);
  return slice.reduce((n, s) => n + s.price, 0) / period;
}

/**
 * Dual-moving-average momentum with position-level risk exits.
 *
 * Exits are evaluated before entries and short-circuit: a stop-loss must be able
 * to fire even while the trend filter still reads bullish, which is exactly the
 * case where a crossover strategy left alone does the most damage.
 */
export function evaluate(symbol: string, policy: Policy = store.policy): Signal {
  const samples = store.history[symbol] ?? [];
  const price = samples.at(-1)?.price ?? 0;
  const base: Omit<Signal, "action" | "reason" | "amount"> = {
    symbol,
    price,
    fast: sma(samples, policy.fastPeriod),
    slow: sma(samples, policy.slowPeriod),
    spreadBps: null,
  };

  if (!price) return { ...base, action: "hold", reason: "no price sample yet", amount: 0 };

  const position = store.positions[symbol];

  if (position && position.qty > 0 && position.avgCost > 0) {
    const pnlPct = ((price - position.avgCost) / position.avgCost) * 100;
    if (pnlPct <= -policy.stopLossPct)
      return {
        ...base,
        action: "sell",
        reason: `stop loss: ${pnlPct.toFixed(2)}% vs -${policy.stopLossPct}% limit`,
        amount: position.qty,
      };
    if (pnlPct >= policy.takeProfitPct)
      return {
        ...base,
        action: "sell",
        reason: `take profit: +${pnlPct.toFixed(2)}% vs +${policy.takeProfitPct}% target`,
        amount: position.qty,
      };
  }

  const fast = base.fast;
  const slow = base.slow;
  if (fast === null || slow === null)
    return {
      ...base,
      action: "hold",
      reason: `warming up — ${samples.length}/${policy.slowPeriod} samples`,
      amount: 0,
    };

  const spreadBps = ((fast - slow) / slow) * 10_000;
  const withSpread = { ...base, spreadBps };

  if (spreadBps > policy.thresholdBps) {
    if (position && position.qty > 0)
      return { ...withSpread, action: "hold", reason: "already long, trend intact", amount: 0 };
    const room = policy.maxExposureUsdg - exposureUsdg();
    if (room < policy.orderSizeUsdg)
      return {
        ...withSpread,
        action: "hold",
        reason: `exposure cap reached (${exposureUsdg().toFixed(2)}/${policy.maxExposureUsdg} USDG)`,
        amount: 0,
      };
    return {
      ...withSpread,
      action: "buy",
      reason: `golden cross — fast SMA${policy.fastPeriod} is ${spreadBps.toFixed(0)}bps over SMA${policy.slowPeriod}`,
      amount: policy.orderSizeUsdg,
    };
  }

  if (spreadBps < -policy.thresholdBps) {
    if (position && position.qty > 0)
      return {
        ...withSpread,
        action: "sell",
        reason: `death cross — fast SMA${policy.fastPeriod} is ${Math.abs(spreadBps).toFixed(0)}bps under SMA${policy.slowPeriod}`,
        amount: position.qty,
      };
    return { ...withSpread, action: "hold", reason: "bearish but flat — nothing to sell", amount: 0 };
  }

  return {
    ...withSpread,
    action: "hold",
    reason: `no edge — ${spreadBps.toFixed(0)}bps inside the ${policy.thresholdBps}bps band`,
    amount: 0,
  };
}
