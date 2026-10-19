"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Hint } from "@/components/ui/primitives";
import { MarketList } from "@/components/markets/MarketList";
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
  const { data, isLoading, error } = useMarkets({ limit: 5, offset: 0, ...query });
  const items = filter ? data?.items.filter(filter) : data?.items;
  return (
    <section aria-labelledby={title} className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={title} className="flex items-center gap-2 text-xl font-semibold">
          {title}
          {hint && <Hint label={title}>{hint}</Hint>}
        </h2>
        <Link href={more} className="text-sm font-semibold text-ink-2 hover:text-ink">
          See all
        </Link>
      </div>
      <MarketList items={items} isLoading={isLoading} error={error} empty={<p className="py-6 text-sm text-muted">{empty}</p>} skeletonRows={3} showHeader={false} />
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
    <section aria-labelledby="recent" className="space-y-3">
      <h2 id="recent" className="text-xl font-semibold">Recently viewed</h2>
      <MarketList items={q.data} isLoading={q.isLoading} error={q.error} empty="" skeletonRows={2} showHeader={false} />
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
            <ButtonLink href="/create">Create a market</ButtonLink>
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
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
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
          empty="Every open market has at least 100 MUSD of collateral."
          filter={(m) => BigInt(m.liquidity) < 100n * 10n ** 18n}
          hint="Under 100 MUSD of collateral. Small trades move these prices a lot, so check the price impact in the quote."
        />
        <Section title="Awaiting resolution" query={{ status: "resolving", sort: "closing" }} more="/markets?status=resolving" empty="No markets are being resolved right now." />
        <RecentlyViewed />
      </div>
      <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-2">Browse by category</h2>
          <ul className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <li key={c}>
                <Link href={`/markets?category=${c}`} className="inline-block rounded-md border border-line px-2.5 py-1 text-sm text-ink-2 hover:border-ink-2 hover:text-ink">
                  {categoryLabel[c]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2 text-sm">
          <h2 className="font-semibold">How a market works</h2>
          <ol className="list-decimal space-y-1.5 pl-4 text-ink-2">
            <li>Buy Yes or No shares with MUSD. The price is the market&apos;s implied chance, 0 to 1.</li>
            <li>Sell back to the pool any time before trading closes.</li>
            <li>After close, a resolver proposes the outcome with evidence. Anyone can dispute it.</li>
            <li>Each winning share then redeems for 1 MUSD.</li>
          </ol>
          <Link href="/docs" className="inline-block pt-1 font-semibold text-ink underline decoration-line underline-offset-2">
            Read the full rules
          </Link>
        </div>
        <div className="space-y-2 text-sm">
          <h2 className="font-semibold">About MUSD</h2>
          <p className="text-ink-2">
            MUSD is Mezo&apos;s Bitcoin-backed stablecoin. You mint it by borrowing against BTC on Mezo. MEZONK uses it for
            every trade and payout.
          </p>
          {deployment.chain.testnet && (
            <p className="text-ink-2">
              On testnet: get BTC from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a>, then{" "}
              <a className="underline" href={TESTNET_FUNDING.borrowMusd} target="_blank" rel="noreferrer">borrow MUSD</a>.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
