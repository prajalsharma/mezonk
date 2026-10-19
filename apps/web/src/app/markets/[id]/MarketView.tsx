"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Address, TxLink } from "@/components/ui/Address";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, KeyValue, Notice, Skeleton } from "@/components/ui/primitives";
import { ActivityList } from "@/components/markets/ActivityList";
import { PriceChart } from "@/components/markets/PriceChart";
import { Change, OddsLabels, ProbabilityBar } from "@/components/markets/Probability";
import { RulesPanel } from "@/components/markets/RulesPanel";
import { StageStatus } from "@/components/markets/StageStatus";
import { TradePanel } from "@/components/trading/TradePanel";
import { ResolutionPanel } from "@/features/resolution/ResolutionPanel";
import { useMarketChain } from "@/hooks/useMarketChain";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { apiGet, type EventDto } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { formatDateTime, formatMusd, formatProb, formatShares, relativeTime } from "@/lib/format";
import { quoteSell } from "@/lib/market/math";
import { categoryLabel, parseMetadata, type Category } from "@/lib/market/metadata";
import { deriveStage } from "@/lib/market/stage";

export interface IndexedMarket {
  question: string;
  category: string;
  structured: boolean;
  metadataRaw: string;
  metadataHash: string;
  creator: string;
  createdAt: string;
  createdTx: string;
  volume: string;
  tradeCount: number;
  traderCount: number;
  priceYes24hAgo: number;
}

function ShareButton() {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        const url = window.location.href;
        try {
          if (navigator.share) await navigator.share({ url, title: document.title });
          else await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* cancelled */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {done ? <Check className="size-4 text-yes" /> : <Share2 className="size-4" />} {done ? "Link copied" : "Share"}
    </button>
  );
}

export function MarketView({ id, indexed, dbError }: { id: number; indexed: IndexedMarket | null; dbError: boolean }) {
  const chain = useMarketChain(id);
  const { add } = useRecentlyViewed();
  useEffect(() => add(id), [id, add]);
  const meta = useMemo(() => (indexed ? parseMetadata(indexed.metadataRaw) : null), [indexed]);
  const m = chain.market;

  const activity = useQuery({
    queryKey: ["market", id, "activity"],
    queryFn: () => apiGet<{ events: EventDto[] }>(`/api/markets/${id}/activity?limit=30`),
    refetchInterval: 15_000,
    enabled: !!indexed,
  });

  if (!deployment.ready) {
    return <EmptyState title="Trading isn't available on this network">The market contract isn't deployed here.</EmptyState>;
  }
  if (chain.notFound && !indexed) {
    return (
      <EmptyState title="Market not found" action={<ButtonLink href="/markets" variant="secondary">Browse markets</ButtonLink>}>
        There is no market #{id} on {deployment.chain.name}.
      </EmptyState>
    );
  }

  const priceYes = m ? Number((m.poolNo * 1_000_000n) / (m.poolYes + m.poolNo || 1n)) / 1e6 : null;
  const stage = m
    ? deriveStage({
        closeTime: new Date(Number(m.closeTime) * 1000),
        proposalWindow: m.proposalWindow,
        proposedAt: m.proposedAt ? new Date(Number(m.proposedAt) * 1000) : null,
        challengeDeadline: m.proposedAt ? new Date(Number(m.proposedAt + BigInt(m.challengeWindow)) * 1000) : null,
        disputedAt: m.disputedAt ? new Date(Number(m.disputedAt) * 1000) : null,
        arbitrationDeadline: m.disputedAt ? new Date(Number(m.disputedAt + BigInt(m.arbitrationWindow)) * 1000) : null,
        finalOutcome: m.finalized ? m.finalOutcome : null,
      })
    : null;
  const question = indexed?.question ?? `Market #${id}`;
  const rules = indexed ? (
    <RulesPanel meta={meta} raw={indexed.metadataRaw} onchainHash={m?.metadataHash ?? indexed.metadataHash} closeTime={new Date(Number(m?.closeTime ?? 0n) * 1000)} />
  ) : null;

  return (
    <div className="space-y-8">
      {dbError && (
        <Notice tone="warn" title="Showing live chain data only">
          The market index is unavailable, so the question text, history and activity can&apos;t be shown. Prices, positions,
          resolution and claims below are read directly from the contract and work normally.
        </Notice>
      )}

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link href="/markets" className="hover:text-ink">Markets</Link>
        <span aria-hidden> / </span>
        <span>{indexed ? categoryLabel[indexed.category as Category] ?? indexed.category : `#${id}`}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8">
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {stage && <StageStatus stage={stage.stage} label={stage.label} />}
              {m && stage?.stage === "open" && <span className="text-ink-2">Closes {relativeTime(Number(m.closeTime) * 1000)}</span>}
              <span className="ml-auto"><ShareButton /></span>
            </div>
            <h1 className="max-w-3xl text-2xl font-semibold leading-tight md:text-3xl">{question}</h1>
            {priceYes === null ? (
              <Skeleton className="h-16 w-full max-w-md" />
            ) : (
              <div className="max-w-xl space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className="tnum text-4xl font-semibold">{formatProb(priceYes)}</span>
                  <span className="text-ink-2">chance of Yes</span>
                  {indexed && <span className="text-sm"><Change from={indexed.priceYes24hAgo} to={priceYes} /> <span className="text-muted">24h</span></span>}
                </div>
                <ProbabilityBar priceYes={priceYes} size="lg" />
                <OddsLabels priceYes={priceYes} />
                <p className="text-xs text-muted">
                  The price of a Yes share in MUSD is the market&apos;s implied probability. It is not a guarantee.
                </p>
              </div>
            )}
            <dl className="grid max-w-2xl grid-cols-2 gap-x-8 sm:grid-cols-4">
              <div><dt className="text-xs text-muted">Volume</dt><dd className="tnum font-semibold">{indexed ? `${formatMusd(indexed.volume, { compact: true })}` : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Collateral</dt><dd className="tnum font-semibold">{m ? formatMusd(m.collateral, { compact: true }) : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Traders</dt><dd className="tnum font-semibold">{indexed?.traderCount ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted">Fee</dt><dd className="tnum font-semibold">{m ? `${m.feeBps / 100}%` : "—"}</dd></div>
            </dl>
          </header>

          {/* On small screens the trade panel follows the odds directly. */}
          <div className="space-y-4 lg:hidden">
            <TradePanel marketId={id} chain={chain} />
            <PositionCard chain={chain} />
          </div>

          {indexed && <PriceChart marketId={id} />}
          {rules}
          <ResolutionPanel marketId={id} chain={chain} question={question} structured={indexed?.structured ?? false} rules={rules} />

          {indexed && (
            <section aria-labelledby="activity" className="space-y-3">
              <h2 id="activity" className="text-xl font-semibold">Activity</h2>
              {activity.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : activity.data?.events.length ? (
                <ActivityList events={activity.data.events} />
              ) : (
                <p className="text-sm text-muted">No indexed activity yet.</p>
              )}
            </section>
          )}

          <section aria-labelledby="contract" className="space-y-2">
            <h2 id="contract" className="text-xl font-semibold">On-chain details</h2>
            <dl className="max-w-2xl divide-y divide-line">
              <KeyValue label="Market id">#{id}</KeyValue>
              <KeyValue label="Contract"><Address address={deployment.marketsAddress!} label="Contract" /></KeyValue>
              <KeyValue label="Collateral token"><Address address={deployment.musd} label="MUSD" /></KeyValue>
              {m && <KeyValue label="Creator"><Address address={m.creator} you={chain.account} label="Creator" /></KeyValue>}
              {indexed && <KeyValue label="Created">{formatDateTime(new Date(indexed.createdAt))}</KeyValue>}
              {indexed && <KeyValue label="Creation tx"><TxLink hash={indexed.createdTx} /></KeyValue>}
              {m && <KeyValue label="Pool (Yes / No shares)">{formatShares(m.poolYes)} / {formatShares(m.poolNo)}</KeyValue>}
            </dl>
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            <TradePanel marketId={id} chain={chain} />
            <PositionCard chain={chain} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The connected wallet's shares, read from the contract, with what they'd fetch if sold now. */
function PositionCard({ chain }: { chain: ReturnType<typeof useMarketChain> }) {
  const m = chain.market;
  if (!chain.account || !m || chain.yes + chain.no === 0n) return null;
  const pool = { yes: m.poolYes, no: m.poolNo };
  const exit = (side: "yes" | "no", s: bigint) => {
    if (s === 0n || m.finalized) return null;
    try {
      return quoteSell(pool, side, s, m.feeBps).out;
    } catch {
      return null;
    }
  };
  const rows = [
    { side: "yes" as const, shares: chain.yes },
    { side: "no" as const, shares: chain.no },
  ].filter((r) => r.shares > 0n);
  return (
    <section aria-label="Your position" className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-base font-semibold">Your position</h2>
      <dl className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const v = exit(r.side, r.shares);
          return (
            <div key={r.side} className="py-2 text-sm">
              <div className="flex justify-between">
                <dt className={r.side === "yes" ? "font-semibold text-yes" : "font-semibold text-no"}>{r.side === "yes" ? "Yes" : "No"}</dt>
                <dd className="tnum">{formatShares(r.shares)} shares</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <span>Pays if it wins</span>
                <span className="tnum">{formatMusd(r.shares)} MUSD</span>
              </div>
              {v !== null && (
                <div className="flex justify-between text-ink-2">
                  <span>Sell now for</span>
                  <span className="tnum">{formatMusd(v)} MUSD</span>
                </div>
              )}
            </div>
          );
        })}
      </dl>
      <p className="mt-2 text-xs text-muted">Read live from the contract.</p>
    </section>
  );
}
