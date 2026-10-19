"use client";

import type { ReactNode } from "react";
import { MarketListHeader, MarketRow, MarketRowSkeleton } from "./MarketRow";
import { EmptyState, Notice } from "@/components/ui/primitives";
import type { MarketSummaryDto } from "@/lib/api/types";

export function MarketList({
  items,
  isLoading,
  error,
  empty,
  skeletonRows = 5,
  showHeader = true,
}: {
  items?: MarketSummaryDto[];
  isLoading: boolean;
  error?: Error | null;
  empty: ReactNode;
  skeletonRows?: number;
  showHeader?: boolean;
}) {
  const now = Date.now();
  if (error && !items) {
    return (
      <Notice tone="error" title="Couldn't load markets">
        The market index is unavailable right now. Markets and funds on-chain are unaffected. Try again in a moment.
      </Notice>
    );
  }
  if (isLoading && !items) {
    return (
      <ul aria-busy="true" aria-label="Loading markets">
        {Array.from({ length: skeletonRows }, (_, i) => (
          <MarketRowSkeleton key={i} />
        ))}
      </ul>
    );
  }
  if (!items?.length) return typeof empty === "string" ? <EmptyState title={empty} /> : <>{empty}</>;
  return (
    <div>
      {showHeader && <MarketListHeader />}
      <ul>
        {items.map((m) => (
          <MarketRow key={m.id} m={m} now={now} />
        ))}
      </ul>
    </div>
  );
}
