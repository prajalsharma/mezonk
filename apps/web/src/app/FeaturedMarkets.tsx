"use client";

import Link from "next/link";
import { ProbabilityBar } from "@/components/markets/Probability";
import { Skeleton } from "@/components/ui/primitives";
import { useMarkets } from "@/hooks/useMarkets";
import { formatMusd, formatProb, relativeTime } from "@/lib/format";

/** Live markets only. Ranked by the documented trending score, falling back to newest open. */
export function FeaturedMarkets() {
  const trending = useMarkets({ sort: "trending", status: "open", limit: 4, offset: 0 });
  const items = trending.data?.items ?? [];
  return (
    <section aria-label="Live markets" className="rounded-lg border border-line bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <h2 className="font-semibold">Live markets</h2>
        <Link href="/markets?status=open" className="text-sm font-semibold text-ink-2 hover:text-ink">All markets</Link>
      </div>
      {trending.isLoading ? (
        <div className="space-y-4 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : trending.error ? (
        <p className="p-5 text-sm text-ink-2">Market data is unavailable right now.</p>
      ) : !items.length ? (
        <div className="space-y-2 p-5 text-sm text-ink-2">
          <p className="font-semibold text-ink">No open markets yet.</p>
          <p>When markets are created on-chain they appear here, ranked by real trading activity.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((m) => (
            <li key={m.id} className="relative space-y-2 px-5 py-4 hover:bg-surface-2/50">
              <Link href={`/markets/${m.id}`} className="block font-semibold leading-snug after:absolute after:inset-0">{m.question}</Link>
              <div className="flex items-center gap-4">
                <span className="tnum w-12 font-semibold">{formatProb(m.priceYes)}</span>
                <ProbabilityBar priceYes={m.priceYes} size="sm" className="flex-1" />
              </div>
              <p className="tnum text-xs text-muted">{formatMusd(m.volume, { compact: true })} MUSD volume · closes {relativeTime(new Date(m.closeTime))}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
