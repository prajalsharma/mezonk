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
import { deployment } from "@/lib/chain/config";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/market/metadata";

/**
 * Picks the market to feature: the most-traded open market that someone can actually buy into right now
 * (an offer on at least one side), else the most-traded open market. Never invents one.
 */
function useFeatured() {
  const q = useMarkets({ status: "open", sort: "trending", limit: 8, offset: 0 }, { enabled: deployment.ready });
  const items = q.data?.items ?? [];
  const m: MarketSummaryDto | undefined = items.find((x) => x.bestAsk != null || x.bestBid != null) ?? items[0];
  return { m, loading: q.isLoading, error: q.error };
}

/** The hero object: one real market, its odds and history, and the two ways in. */
export function HeroTicket() {
  const { m, loading, error } = useFeatured();
  const now = Date.now();
  return (
    <div className="panel relative overflow-hidden shadow-2">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-ink-2">
          <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-yes" />
          Featured market
        </span>
        <span className="mono text-xs text-muted">{m ? `#${m.id}` : ""}</span>
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
          <p className="text-sm text-ink-2">Markets appear here as soon as one launches on-chain. Have a question worth trading?</p>
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
              <Link href={marketHref(m)} className="block text-lg font-medium leading-snug decoration-line underline-offset-4 hover:underline">
                {m.question}
              </Link>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3">
            <p className="flex items-baseline gap-2">
              <SignalValue m={m} className="mono text-5xl font-medium tracking-tight" />
              <span className="text-sm text-muted">
                {m.priceYes != null ? "Yes, last trade" : marketSignal(m).kind === "indicative" ? "indicative" : "no trades yet"}
              </span>
            </p>
            {m.priceYes != null && m.priceYes24hAgo != null && (
              <span className="mono text-sm">
                <Change from={m.priceYes24hAgo} to={m.priceYes} /> <span className="text-muted">24h</span>
              </span>
            )}
          </div>

          <div className="rounded-md border border-line bg-sunk px-2 pt-2">
            <Sparkline marketId={m.id} height={88} />
          </div>
          {(() => {
            const sig = marketSignal(m);
            return sig.kind === "none" ? null : <ProbabilityBar priceYes={sig.p} />;
          })()}

          <div className="grid grid-cols-2 gap-2">
            <Link
              href={marketHref(m, "yes")}
              className="press flex h-12 items-center justify-between rounded-md bg-yes px-4 font-semibold text-on-yes transition-[background-color] hover:bg-accent-hover"
            >
              <span>Buy Yes</span>
              <span className="mono">{m.bestAsk != null ? formatCents(m.bestAsk) : "no offers"}</span>
            </Link>
            <Link
              href={marketHref(m, "no")}
              className="press flex h-12 items-center justify-between rounded-md bg-no px-4 font-semibold text-on-no transition-opacity hover:opacity-90"
            >
              <span>Buy No</span>
              <span className="mono">{m.bestBid != null ? formatCents(100 - m.bestBid) : "no offers"}</span>
            </Link>
          </div>
          <p className="flex flex-wrap justify-between gap-2 text-xs text-muted">
            <span className="mono">{m.tradeCount ? `${formatMusd(m.volume, { compact: true })} MUSD traded · ${m.tradeCount} trades` : "No trades yet"}</span>
            <span>A winning share pays 1 MUSD</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** One quiet line of real counts under the hero. Renders nothing until the index answers. */
export function HeroCounts() {
  const open = useMarkets({ status: "open", limit: 1, offset: 0 }, { enabled: deployment.ready });
  const seeding = useMarkets({ status: "seeding", limit: 1, offset: 0 }, { enabled: deployment.ready });
  if (!open.data) return <p className="h-5" aria-hidden />;
  const n = open.data.total;
  const s = seeding.data?.total ?? 0;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
      <span className="mono font-medium text-ink">{n}</span> {n === 1 ? "market open" : "markets open"}
      {s > 0 && (
        <>
          <span aria-hidden className="text-muted">·</span>
          <span className="mono font-medium text-ink">{s}</span> waiting for backers
        </>
      )}
    </p>
  );
}

/** The board: real open markets, filterable by category. */
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
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter the board by category">
        {["", ...CATEGORIES].map((c) => (
          <button
            key={c || "all"}
            type="button"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
            className={cx(
              "press h-9 shrink-0 rounded-md border px-3.5 text-sm font-medium transition-colors",
              cat === c ? "border-transparent bg-no text-on-no" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
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
          <div className="panel p-10 text-center">
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

/**
 * The markets block on the landing page. When no exchange is deployed on this network there is nothing to load, so it
 * says so at once instead of showing a skeleton; with a deployment it shows the featured market and the board.
 */
export function LiveMarkets() {
  const any = useMarkets({ status: "all", sort: "newest", limit: 1, offset: 0 }, { enabled: deployment.ready });
  if (!deployment.ready || (any.data && any.data.total === 0)) {
    return (
      <div className="panel grid gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:items-center md:p-12">
        <div className="space-y-3">
          <p className="text-2xl font-semibold tracking-tight">The first markets on Mezo are on their way.</p>
          <p className="max-w-lg text-ink-2">
            {deployment.ready
              ? "Nothing has been published yet. Suggestions are reviewed in public; you can propose the first question."
              : "Trading isn't switched on for this network yet. Suggestions are already open and reviewed in public."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end">
          <ButtonLink href="/suggest" size="lg">Suggest a market</ButtonLink>
          <ButtonLink href="/proposals" size="lg" variant="secondary">See suggestions</ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-10">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        <HeroTicket />
        <div className="space-y-4 lg:pt-2">
          <p className="text-2xl font-semibold tracking-tight">Pick a side straight from the board.</p>
          <p className="text-ink-2">
            Prices come from real trades. With no trade yet you see the middle of the best offers, labelled as indicative, or no
            number at all.
          </p>
          <HeroCounts />
        </div>
      </div>
      <Board />
    </div>
  );
}
