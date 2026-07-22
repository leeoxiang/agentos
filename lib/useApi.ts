"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

/**
 * Fetch JSON with polling and out-of-order protection.
 *
 * A slow request that resolves after a newer one must not overwrite it — with
 * a poll interval running against chain reads of wildly varying latency, that
 * race shows up as balances flickering backwards.
 */
export function useApi<T>(url: string | null, intervalMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (id !== seq.current) return;
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body as T);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
    if (!intervalMs || !url) return;
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs, url]);

  return { data, error, loading, refresh: load };
}

/** Page heading used across every non-console route. */
export function usePageTitle() {
  return null;
}
