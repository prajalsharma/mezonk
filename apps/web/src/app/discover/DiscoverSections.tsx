"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Hint } from "@/components/ui/primitives";
import { CategoryGlyph, MarketGrid } from "@/components/markets/MarketCard";
import { useMarkets, type MarketQuery } from "@/hooks/useMarkets";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { apiGet, type MarketSummaryDto } from "@/lib/api/types";
import { CATEGORIES, categoryLabel } from "@/lib/market/metadata";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";

function Section({
  title,
  hint,
  query,
  more,
  empty,
  filter,
}: {
  title: string;
  hint?: ReactNode;
  query: MarketQuery;
  more: string;
  empty: string;
  filter?: (m: MarketSummaryDto) => boolean;
}) {
  const { data, isLoading, error } = useMarkets({ limit: 3, offset: 0, ...query });
  const items = filter ? data?.items.filter(filter) : data?.items;
  const id = title.toLowerCase().replace(/\s+/g, "-");
  // An empty section collapses to one line so empty lists never dominate the page.
  if (data && !items?.length) {
    return (
      <section aria-labelledby={id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-4">
        <h2 id={id} className="flex items-center gap-2 font-medium">
          {title}
          {hint && <Hint label={title}>{hint}</Hint>}
        </h2>
        <p className="text-sm text-muted">{empty}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="flex items-center gap-2 text-2xl font-medium tracking-tight">
          {title}
          {hint && <Hint label={title}>{hint}</Hint>}
        </h2>
        <Link href={more} className="text-sm font-medium text-ink-2 hover:text-ink">
          See all →
        </Link>
      </div>
      <MarketGrid items={items} isLoading={isLoading} error={error} empty={null} skeletons={3} />
    </section>
  );
}

function RecentlyViewed() {
  const { ids } = useRecentlyViewed();
  const q = useQuery({
    queryKey: ["recent", ids],
    enabled: ids.length > 0,
    queryFn: async () =>
      (
        await Promise.all(
          ids.map((id) =>
            apiGet<{ summary: MarketSummaryDto }>(`/api/markets/${id}`)
              .then((r) => r.summary)
              .catch(() => null),
          ),
        )
      ).filter((x): x is MarketSummaryDto => !!x),
  });
  if (!ids.length || (q.data && !q.data.length)) return null;
  return (
    <section aria-labelledby="recent" className="space-y-4">
      <h2 id="recent" className="text-2xl font-medium tracking-tight">Recently viewed</h2>
      <MarketGrid items={q.data} isLoading={q.isLoading} error={q.error} empty={null} skeletons={3} />
    </section>
  );
}

export function DiscoverSections() {
  const all = useMarkets({ limit: 1, offset: 0 });
  if (all.data && all.data.total === 0) {
    return (
      <EmptyState
        title="No markets yet"
        action={
          <>
            <ButtonLink href="/suggest">Suggest a market</ButtonLink>
            <ButtonLink href="/docs" variant="secondary">How it works</ButtonLink>
          </>
        }
      >
        {deployment.ready
          ? `Nothing has been created on ${deployment.isLocalFork ? "this local fork" : deployment.chain.name} yet. Markets show up here within seconds of their creation transaction.`
          : "The market contract isn't deployed on this network yet, so there is nothing to show."}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-12">
      <nav aria-label="Browse by category" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/markets?category=${c}`}
            className="press flex shrink-0 items-center gap-2.5 rounded-md border border-line bg-surface py-1.5 pl-1.5 pr-4 text-sm font-medium text-ink-2 transition-colors hover:border-ink-2/40 hover:text-ink"
          >
            <CategoryGlyph category={c} className="size-7" />
            {categoryLabel[c]}
          </Link>
        ))}
      </nav>
      <div className="space-y-12">
        <Section
          title="Trending"
          query={{ sort: "trending", status: "open" }}
          more="/markets?sort=trending&status=open"
          empty="No open market has traded in the last 24 hours."
          filter={(m) => m.trendingScore > 0}
          hint="Ranked by 24h volume × √(1 + distinct traders in 24h). Open markets with at least one trade in the last 24 hours only."
        />
        <Section title="Closing soon" query={{ status: "closing", sort: "closing" }} more="/markets?status=closing&sort=closing" empty="No markets close in the next 48 hours." />
        <Section title="New" query={{ sort: "newest", status: "open" }} more="/markets?sort=newest&status=open" empty="No open markets." />
        <Section
          title="Deepest liquidity"
          query={{ sort: "liquidity", status: "open", minLiquidity: 100 }}
          more="/markets?sort=liquidity&status=open"
          empty="No open market holds 100 MUSD or more in collateral yet."
          hint="Collateral is the MUSD backing all outstanding shares. More collateral means trades move the price less."
        />
        <Section
          title="Thin liquidity"
          query={{ sort: "thin", status: "open" }}
          more="/markets?sort=thin&status=open"
          empty="Every live market has a two-sided book with a spread of 10¢ or less."
          filter={(m) => m.lowLiquidity}
          hint="One side of the book is empty or the spread is wide. Market orders may fill only partly; consider a limit order."
        />
        <Section title="Awaiting resolution" query={{ status: "resolving", sort: "closing" }} more="/markets?status=resolving" empty="No markets are being resolved right now." />
        <RecentlyViewed />
      </div>
      <aside className="grid gap-3 md:grid-cols-2">
        <div className="panel space-y-2 p-6 text-sm">
          <h2 className="font-semibold">How a market works</h2>
          <ol className="list-decimal space-y-1.5 pl-4 text-ink-2">
            <li>A market launches once funded orders sit on both sides of its book.</li>
            <li>Buy Yes or No from other people&apos;s orders, or post your own price. The price is the market&apos;s implied chance.</li>
            <li>After close, a resolver proposes the outcome with evidence. Anyone can dispute it.</li>
            <li>Each winning share then redeems for 1 MUSD.</li>
          </ol>
          <Link href="/docs" className="inline-block pt-1 font-semibold text-ink underline decoration-line underline-offset-2">
            Read the full rules
          </Link>
        </div>
        <div className="panel space-y-2 p-6 text-sm">
          <h2 className="font-semibold">About MUSD</h2>
          <p className="text-ink-2">
            MUSD is Mezo&apos;s Bitcoin-backed stablecoin. You mint it by borrowing against BTC on Mezo. MEZONK uses it for
            every trade and payout.
          </p>
          {deployment.chain.testnet && (
            <p className="text-ink-2">
              On testnet: get BTC from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a>, then{" "}
              <Link className="underline" href="/borrow">borrow MUSD</Link> right here.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
