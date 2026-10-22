"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, type MarketListDto } from "@/lib/api/types";

export interface MarketQuery {
  q?: string;
  category?: string;
  status?: string;
  sort?: string;
  minLiquidity?: number;
  closesWithinHours?: number;
  creator?: string;
  limit?: number;
  offset?: number;
}

export function marketsUrl(p: MarketQuery) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && v !== null) s.set(k, String(v));
  return `/api/markets?${s}`;
}

export function useMarkets(p: MarketQuery, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["markets", p],
    queryFn: () => apiGet<MarketListDto>(marketsUrl(p)),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    // Back off while the index is down instead of hammering it every 20s.
    refetchInterval: (q) => (q.state.status === "error" ? 60_000 : 20_000),
  });
}
