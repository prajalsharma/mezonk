"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Skeleton } from "@/components/ui/primitives";
import { CategoryGlyph, MarketGrid, MarketStatusChip } from "@/components/markets/MarketCard";
import { Change, ProbabilityBar, SignalValue } from "@/components/markets/Probability";
import { Sparkline } from "@/components/markets/Sparkline";
import { useMarkets } from "@/hooks/useMarkets";
import { type MarketSummaryDto, marketHref } from "@/lib/api/types";
import { formatCents, formatMusd, marketSignal } from "@/lib/format";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/market/metadata";

/** Picks the market to feature: most-traded open market, else newest open. Never invents one. */
function useFeatured() {
  const trending = useMarkets({ status: "open", sort: "trending", limit: 1, offset: 0 });
  const newest = useMarkets({ status: "open", sort: "volume", limit: 1, offset: 0 });
  const m: MarketSummaryDto | undefined = trending.data?.items[0] ?? newest.data?.items[0];
  return { m, loading: trending.isLoading || newest.isLoading, error: trending.error && newest.error };
}

/** The hero object: one real market, its live odds and history, and the two ways in. */
export function HeroTicket() {
  const { m, loading, error } = useFeatured();
  const now = Date.now();
  return (
    <div className="relative">
      <div className="glass relative overflow-hidden rounded-xl border shadow-3">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="label">Featured market</span>
          <span className="label">{m ? `#${m.id}` : ""}</span>
        </div>
        {loading ? (
          <div className="space-y-4 p-5">
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-ink-2">Market data is unavailable right now. On-chain markets are unaffected.</p>
        ) : !m ? (
          <div className="space-y-3 p-6">
            <p className="text-lg font-medium">No live markets yet.</p>
            <p className="text-sm text-ink-2">Markets appear here the moment one is published on-chain. Have a question worth trading?</p>
            <ButtonLink href="/suggest" variant="secondary">Suggest the first one</ButtonLink>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <CategoryGlyph category={m.category} className="mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-muted">
                  {categoryLabel[m.category as Category] ?? m.category}
                  <span aria-hidden>·</span>
                  <MarketStatusChip m={m} now={now} />
                </div>
                <Link href={marketHref(m)} className="block text-lg font-medium leading-snug hover:underline decoration-line underline-offset-4">
                  {m.question}
                </Link>
              </div>
            </div>

            <div className="flex items-end justify-between">
              <p className="flex items-baseline gap-2">
                <SignalValue m={m} className="mono text-5xl font-semibold tracking-tight" />
                <span className="text-sm text-muted">{m.priceYes != null ? "last trade" : marketSignal(m).kind === "indicative" ? "book midpoint" : "no trades yet"}</span>
              </p>
              {m.priceYes != null && m.priceYes24hAgo != null && (
                <span className="mono text-sm">
                  <Change from={m.priceYes24hAgo} to={m.priceYes} /> <span className="text-muted">24h</span>
                </span>
              )}
            </div>

            <div className="rounded-md border border-line bg-sunk/60 px-2 pt-2">
              <Sparkline marketId={m.id} height={88} />
            </div>
            {(() => {
              const sig = marketSignal(m);
              return sig.kind === "none" ? null : <ProbabilityBar priceYes={sig.p} />;
            })()}

            <div className="grid grid-cols-2 gap-2">
              <Link
                href={marketHref(m, "yes")}
                className="press flex h-12 items-center justify-between rounded-md bg-yes px-4 font-semibold text-on-yes shadow-[0_10px_30px_-12px_var(--accent)] transition-[filter] hover:brightness-110"
              >
                <span>Buy Yes</span>
                <span className="mono">{m.bestAsk != null ? formatCents(m.bestAsk) : "no offers"}</span>
              </Link>
              <Link
                href={marketHref(m, "no")}
                className="press flex h-12 items-center justify-between rounded-md bg-no px-4 font-semibold text-on-no transition-[filter] hover:brightness-110"
              >
                <span>Buy No</span>
                <span className="mono">{m.bestBid != null ? formatCents(100 - m.bestBid) : "no offers"}</span>
              </Link>
            </div>
            <p className="mono flex flex-wrap justify-between gap-2 text-[11px] text-muted">
              <span>{m.tradeCount ? `${formatMusd(m.volume, { compact: true })} MUSD traded · ${m.tradeCount} trades` : "No trades yet"}</span>
              <span>Prices in cents per share · a winning share pays 1 MUSD</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The board: real open markets, filterable by category, as decision cards. */
export function Board() {
  const [cat, setCat] = useState<string>("");
  const q = useMarkets({ status: "open", sort: "trending", category: cat || undefined, limit: 6, offset: 0 });
  const any = useMarkets({ status: "all", sort: "newest", limit: 6, offset: 0 });
  const openCount = q.data?.total ?? 0;
  // A young deployment may have nothing open; show the newest markets of any status rather than an empty board.
  const fallback = !cat && q.data && openCount === 0;
  const data = fallback ? any.data : q.data;
  return (
    <div className="space-y-5">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter the board by category">
        {["", ...CATEGORIES].map((c) => (
          <button
            key={c || "all"}
            type="button"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
            className={cx(
              "press shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              cat === c ? "border-transparent bg-primary text-on-primary" : "border-line text-ink-2 hover:border-ink-2/40 hover:text-ink",
            )}
          >
            {c ? categoryLabel[c as Category] : "All"}
          </button>
        ))}
      </div>
      {fallback && <p className="text-sm text-muted">Nothing is open right now. These are the newest markets.</p>}
      <MarketGrid
        items={data?.items}
        isLoading={q.isLoading}
        error={q.error}
        empty={
          <div className="panel grid-bg p-10 text-center">
            <p className="font-medium">No open {cat ? categoryLabel[cat as Category] : ""} markets right now.</p>
            <Link href="/suggest" className="mt-2 inline-flex items-center gap-1 text-sm text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
              Suggest one <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        }
      />
    </div>
  );
}

/** Live counts from the index for the hero. Renders nothing until real numbers arrive. */
export function HeroStats() {
  const open = useMarkets({ status: "open", limit: 1, offset: 0 });
  const all = useMarkets({ status: "all", limit: 1, offset: 0 });
  if (!open.data || !all.data) return <div className="h-12" aria-hidden />;
  const stats: Array<[string, string]> = [
    [String(open.data.total), open.data.total === 1 ? "market open" : "markets open"],
    [String(all.data.total), all.data.total === 1 ? "market created" : "markets created"],
    ["1 MUSD", "per winning share"],
  ];
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {stats.map(([v, l]) => (
        <div key={l}>
          <dt className="sr-only">{l}</dt>
          <dd className="mono text-2xl font-semibold text-ink">{v}</dd>
          <p className="text-xs text-muted">{l}</p>
        </div>
      ))}
    </dl>
  );
}
