"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useMarkets } from "@/hooks/useMarkets";
import { formatProb } from "@/lib/format";
import { Change } from "./Probability";

/**
 * A moving strip of real open markets and their current odds. Hidden when nothing is open;
 * pauses on hover/focus; static under reduced motion (global rule).
 */
export function Ticker() {
  const { data } = useMarkets({ status: "open", sort: "volume", limit: 16, offset: 0 });
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  // Duplicate the list so the -50% translate loops seamlessly.
  const loop = [...items, ...items];
  return (
    <section aria-label="Open markets ticker" className="ticker-wrap relative overflow-hidden rounded-lg border border-line bg-surface">
      <div
        className="ticker flex w-max items-center"
        style={{ "--ticker-duration": `${Math.max(30, items.length * 7)}s` } as CSSProperties}
      >
        {loop.map((m, i) => (
          <Link
            key={`${m.id}-${i}`}
            href={`/markets/${m.id}`}
            aria-hidden={i >= items.length ? true : undefined}
            tabIndex={i >= items.length ? -1 : undefined}
            className="flex items-center gap-3 border-r border-line px-5 py-3 text-sm transition-colors hover:bg-surface-2"
          >
            <span className="max-w-[26ch] truncate text-ink-2">{m.question}</span>
            <span className="mono font-semibold text-ink">{formatProb(m.priceYes)}</span>
            <span className="mono text-xs">
              <Change from={m.priceYes24hAgo} to={m.priceYes} />
            </span>
          </Link>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-bg to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-bg to-transparent" />
    </section>
  );
}
