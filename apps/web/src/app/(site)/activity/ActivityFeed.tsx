"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, Skeleton } from "@/components/ui/primitives";
import { ActivityList } from "@/components/markets/ActivityList";
import { useHealth } from "@/hooks/useHealth";
import { apiGet, type EventDto } from "@/lib/api/types";

export function ActivityFeed() {
  const health = useHealth();
  const q = useInfiniteQuery({
    queryKey: ["activity"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiGet<{ events: EventDto[] }>(`/api/activity?limit=40${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) => (last.events.length === 40 ? last.events.at(-1)!.id : undefined),
    refetchInterval: 15_000,
  });
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <div className="space-y-4">
      {health.data?.indexer?.stale && (
        <Notice tone="warn" title="This feed may be behind">
          The indexer last caught up {health.data.indexer.lastSuccessAt ? new Date(health.data.indexer.lastSuccessAt).toLocaleString() : "never"}.
        </Notice>
      )}
      <p className="text-sm text-muted">Source: indexed on-chain events. MEZONK records no off-chain activity here.</p>
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.error ? (
        <Notice tone="error" title="Couldn't load activity">The index is unavailable. On-chain state is unaffected.</Notice>
      ) : !events.length ? (
        <EmptyState title="No activity yet">Events appear here once markets are created and traded.</EmptyState>
      ) : (
        <ActivityList events={events} showMarket />
      )}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Older activity</Button>
        </div>
      )}
    </div>
  );
}
