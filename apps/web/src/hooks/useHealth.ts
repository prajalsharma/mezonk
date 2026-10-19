"use client";

import { useQuery } from "@tanstack/react-query";

export interface Health {
  ok: boolean;
  chain: { chainId: number; name: string; localFork: boolean; contract: string | null; ready: boolean; reason: string; message: string };
  rpc: { ok: boolean; blockNumber: string | null; latencyMs: number | null };
  db: { ok: boolean };
  indexer: null | {
    lastBlock: string;
    headBlock: string | null;
    lagBlocks: number | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    stale: boolean;
    reconcileMismatches: unknown[];
  };
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const r = await fetch("/api/health");
      return (await r.json()) as Health;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
