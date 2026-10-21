"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api/types";

export interface BookDto {
  bids: Array<{ yes: number; shares: string; resting: string; orders: number }>;
  asks: Array<{ yes: number; shares: string; resting: string; orders: number }>;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  mid: number | null;
  lastPrice: number | null;
  bidNotional: string;
  askNotional: string;
}

export interface QuoteDto {
  quote: {
    requested: string;
    filled: string;
    unfilled: string;
    notional: string;
    fee: string;
    bestPrice: number | null;
    worstPrice: number | null;
    steps: Array<{ kind: "signed" | "resting"; ref: string; quantity: string; takerPrice: number; complement: boolean }>;
  };
  sources: Array<{
    restingId: string;
    order: { maker: string; taker: string; marketId: string; outcome: number; side: number; price: number; quantity: string; expiry: string; nonce: string; salt: string };
    signature: string;
  }>;
  feeBps: number;
}

export interface SeedingDto {
  policyId: number;
  seedingDeadline: number;
  graduatedAt: number;
  check: {
    bestBid: number;
    bestAsk: number;
    bidDepth: string;
    askDepth: string;
    seeders: number;
    spreadOk: boolean;
    depthOk: boolean;
    seedersOk: boolean;
    open: boolean;
    ready: boolean;
  };
  policy: {
    minBidDepth: string;
    minAskDepth: string;
    minSeederNotional: string;
    minSeeders: number;
    maxSpread: number;
    band: number;
    seedingPeriod: number;
    minRest: number;
    takerFeeBps: number;
    rebateShareBps: number;
    referralShareBps: number;
    rebatePeriod: number;
    claimWindow: number;
    rebateCapPerMarket: string;
    rebateCapPerWallet: string;
    rebateBudget: string;
    referralCapPerMarket: string;
  };
}

export interface SignedOrderRow {
  hash: string;
  marketId: number;
  maker: string;
  taker: string;
  outcome: number;
  side: number;
  price: number;
  quantity: string;
  filled: string;
  expiry: string;
  nonce: string;
  salt: string;
  signature: string;
  status: "open" | "filled" | "cancelled" | "expired" | "stale" | "removed";
  statusReason: string | null;
  createdAt: string;
}
export interface RestingRow {
  orderId: number;
  marketId: number;
  maker: string;
  outcome: number;
  side: number;
  price: number;
  quantity: string;
  remaining: string;
  seed: boolean;
  status: "open" | "filled" | "cancelled";
  placedAt: string;
  placedTx: string;
  closedAt: string | null;
}

export const bookKey = (id: number) => ["market", id, "book"] as const;

export function useBook(marketId: number, enabled = true) {
  return useQuery({
    queryKey: bookKey(marketId),
    queryFn: () => apiGet<BookDto>(`/api/markets/${marketId}/book`),
    refetchInterval: 4_000,
    enabled,
  });
}

export function useSeeding(marketId: number, enabled = true) {
  return useQuery({
    queryKey: ["market", marketId, "seeding"],
    queryFn: () => apiGet<SeedingDto>(`/api/markets/${marketId}/seeding`),
    refetchInterval: 5_000,
    enabled,
  });
}

export function useMyOrders(marketId: number | undefined, maker?: string) {
  return useQuery({
    queryKey: ["orders", maker?.toLowerCase(), marketId],
    queryFn: () => apiGet<{ signed: SignedOrderRow[]; resting: RestingRow[] }>(`/api/orders?maker=${maker}${marketId ? `&market=${marketId}` : ""}`),
    enabled: !!maker,
    refetchInterval: 6_000,
  });
}

/** Server quote, debounced while the user types. */
export function useQuote(
  marketId: number,
  p: { outcome: number; side: number; quantity: bigint | null; limit: number | null; taker?: string },
  enabled: boolean,
) {
  const key = p.quantity && p.limit ? `${p.outcome}:${p.side}:${p.quantity}:${p.limit}:${p.taker ?? ""}` : "";
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), 250);
    return () => clearTimeout(t);
  }, [key]);
  return useQuery({
    queryKey: ["market", marketId, "quote", debounced],
    queryFn: () =>
      apiGet<QuoteDto>(
        `/api/markets/${marketId}/quote?outcome=${p.outcome}&side=${p.side}&quantity=${p.quantity}&limit=${p.limit}${p.taker ? `&taker=${p.taker}` : ""}`,
      ),
    enabled: enabled && !!debounced && debounced === key,
    refetchInterval: 8_000,
    placeholderData: (prev) => prev,
  });
}
