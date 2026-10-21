import type { StageInfo } from "@/lib/market/stage";

/** Wire types for API responses (dates as ISO strings, amounts as decimal strings). */
export interface MarketSummaryDto {
  id: number;
  question: string;
  category: string;
  structured: boolean;
  /** Last real fill's YES price (0..1); null if the market has never traded. Never a made-up number. */
  priceYes: number | null;
  priceYes24hAgo: number | null;
  /** Executable top of book in YES cents (escrowed + signed); null when that side is empty. */
  bestBid: number | null;
  bestAsk: number | null;
  /** Collateral notional resting on the book. */
  liquidity: string;
  openInterest: string;
  lowLiquidity: boolean;
  volume: string;
  volume24h: string;
  traders24h: number;
  tradeCount: number;
  createdAt: string;
  closeTime: string;
  stage: Omit<StageInfo, "deadline"> & { deadline: string | null };
  finalOutcome: number | null;
  trendingScore: number;
  slug: string | null;
}

export interface MarketListDto {
  total: number;
  items: MarketSummaryDto[];
  limit: number;
  offset: number;
}

export interface EventDto {
  id: number;
  eventName: string;
  marketId: number | null;
  actor: string | null;
  args: Record<string, unknown>;
  blockNumber: string;
  blockTime: string;
  txHash: string;
  question: string | null;
}

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new ApiRequestError(r.status, body?.error?.code ?? "error", body?.error?.message ?? "Request failed");
  }
  return body as T;
}

/** Canonical public URL of a market: its slug when assigned, else the numeric id (which redirects). */
export const marketHref = (m: { id: number; slug?: string | null }, side?: "yes" | "no") =>
  `/markets/${m.slug ?? m.id}${side ? `?side=${side}` : ""}`;
