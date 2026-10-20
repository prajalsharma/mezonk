"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Share2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useBlock } from "wagmi";
import { Address, TxLink } from "@/components/ui/Address";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, KeyValue, Notice, Skeleton } from "@/components/ui/primitives";
import { ActivityList } from "@/components/markets/ActivityList";
import { PriceChart } from "@/components/markets/PriceChart";
import { Change, LiveProbability, ProbabilityBar } from "@/components/markets/Probability";
import { CategoryGlyph } from "@/components/markets/MarketCard";
import { cx } from "@/components/ui/cx";
import { RulesPanel } from "@/components/markets/RulesPanel";
import { StageStatus } from "@/components/markets/StageStatus";
import { TradePanel } from "@/components/trading/TradePanel";
import { ResolutionPanel } from "@/features/resolution/ResolutionPanel";
import { useMarketChain } from "@/hooks/useMarketChain";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { apiGet, type EventDto } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { formatDateTime, formatMusd, formatPrice, formatShares, relativeTime } from "@/lib/format";
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
      className="press inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-sm font-medium text-ink-2 hover:text-ink"
    >
      {done ? <Check className="size-4 text-success" /> : <Share2 className="size-4" />} {done ? "Link copied" : "Share"}
    </button>
  );
}

export function MarketView({ id, indexed, dbError }: { id: number; indexed: IndexedMarket | null; dbError: boolean }) {
  const chain = useMarketChain(id);
  const params = useSearchParams();
  // The outcome picked on a card (?side=) or on the tiles below drives the trade ticket.
  const [side, setSide] = useState<"yes" | "no">(params.get("side") === "no" ? "no" : "yes");
  const { add } = useRecentlyViewed();
  useEffect(() => add(id), [id, add]);
  const meta = useMemo(() => (indexed ? parseMetadata(indexed.metadataRaw) : null), [indexed]);
  const m = chain.market;
  // Stage labels use chain time (latest block), matching how the contract decides stages.
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });
  const chainNowMs = block.data ? Number(block.data.timestamp) * 1000 : Date.now();

  const activity = useQuery({
    queryKey: ["market", id, "activity"],
    queryFn: () => apiGet<{ events: EventDto[] }>(`/api/markets/${id}/activity?limit=30`),
    refetchInterval: 15_000,
    enabled: !!indexed,
  });

  if (!deployment.ready) {
    return <EmptyState title="Trading isn't available on this network">The market contract isn&apos;t deployed here.</EmptyState>;
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
      }, chainNowMs)
    : null;
  const question = indexed?.question ?? `Market #${id}`;
  const rules = indexed ? (
    <RulesPanel meta={meta} raw={indexed.metadataRaw} onchainHash={m?.metadataHash ?? indexed.metadataHash} closeTime={new Date(Number(m?.closeTime ?? 0n) * 1000)} />
  ) : null;

  const sections: Array<[string, string]> = [
    ["chart", "Chart"],
    ...(indexed ? ([["rules", "Rules"]] as Array<[string, string]>) : []),
    ["resolution", "Resolution"],
    ...(indexed ? ([["activity", "Activity"]] as Array<[string, string]>) : []),
    ["contract", "On-chain"],
  ];
  const open = stage?.stage === "open";

  return (
    <div className="space-y-6">
      {dbError && (
        <Notice tone="warn" title="Showing live chain data only">
          The market index is unavailable, so the question text, history and activity can&apos;t be shown. Prices, positions,
          resolution and claims below are read directly from the contract and work normally.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0 space-y-6">
          {/* Hero band: question, state, and the two outcomes as the primary objects. */}
          <header className="panel relative overflow-hidden p-5 md:p-7">
            <div aria-hidden className="grid-bg absolute inset-0" />
            <div className="relative space-y-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-ink-2">
                  <Link href="/markets" className="hover:text-ink">Markets</Link>
                  <span aria-hidden className="text-muted">/</span>
                  {indexed && <CategoryGlyph category={indexed.category} className="size-6" />}
                  <span>{indexed ? categoryLabel[indexed.category as Category] ?? indexed.category : `#${id}`}</span>
                </nav>
                <span className="ml-auto flex items-center gap-3">
                  {stage && <StageStatus stage={stage.stage} label={stage.label} />}
                  <ShareButton />
                </span>
              </div>
              <h1 className="max-w-3xl text-[1.75rem] font-medium leading-[1.15] tracking-tight md:text-[2.5rem]">{question}</h1>

              {m?.finalized && (
                <div
                  className={cx(
                    "flex flex-wrap items-baseline justify-between gap-2 rounded-md px-4 py-3.5",
                    m.finalOutcome === 1 ? "bg-yes text-on-yes" : m.finalOutcome === 2 ? "bg-no text-on-no" : "bg-warn-soft text-warn",
                  )}
                >
                  <span className="text-xl font-semibold">
                    {m.finalOutcome === 1 ? "Resolved Yes" : m.finalOutcome === 2 ? "Resolved No" : "Resolved Invalid"}
                  </span>
                  <span className="text-sm opacity-85">
                    {m.finalOutcome === 3 ? "Every share redeems for 0.5 MUSD." : `Each ${m.finalOutcome === 1 ? "Yes" : "No"} share redeems for 1 MUSD.`} Last trading prices below.
                  </span>
                </div>
              )}
              {priceYes === null ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
                    {(["yes", "no"] as const).map((s) => {
                      const p = s === "yes" ? priceYes : 1 - priceYes;
                      const active = open && side === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={!open}
                          aria-pressed={open ? active : undefined}
                          onClick={() => setSide(s)}
                          className={cx(
                            m?.finalized && "opacity-60",
                            "press group rounded-md border p-4 text-left transition-[border-color,background-color,box-shadow] duration-200 disabled:cursor-default md:p-5",
                            active
                              ? s === "yes"
                                ? "border-yes bg-yes-soft shadow-[0_0_0_3px_var(--accent-soft)]"
                                : "border-no bg-no-soft shadow-[0_0_0_3px_var(--no-soft)]"
                              : "border-line bg-surface hover:border-ink-2/40",
                          )}
                        >
                          <span className={cx("text-sm font-semibold", s === "yes" ? "text-yes-text" : "text-no-text")}>
                            {s === "yes" ? "Yes" : "No"}
                          </span>
                          <span className="mono mt-1 block text-4xl font-semibold tracking-tight text-ink md:text-5xl">
                            <LiveProbability value={p} />
                          </span>
                          <span className="mono mt-1 block text-xs text-muted">{formatPrice(p)} MUSD per share</span>
                        </button>
                      );
                    })}
                  </div>
                  <ProbabilityBar priceYes={priceYes} size="lg" />
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>The price of a Yes share in MUSD is the market&apos;s implied probability. It is not a guarantee.</span>
                    {indexed && (
                      <span className="mono">
                        <Change from={indexed.priceYes24hAgo} to={priceYes} /> 24h
                      </span>
                    )}
                  </p>
                </div>
              )}

              <dl className="mono grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-5">
                {[
                  ["Volume", indexed ? `${formatMusd(indexed.volume, { compact: true })}` : "—"],
                  ["Collateral", m ? formatMusd(m.collateral, { compact: true }) : "—"],
                  ["Traders", String(indexed?.traderCount ?? "—")],
                  ["Fee", m ? `${m.feeBps / 100}%` : "—"],
                  [open || !m ? "Closes" : "Closed", m ? relativeTime(Number(m.closeTime) * 1000, chainNowMs) : "—"],
                ].map(([k, v], i) => (
                  <div key={k} className={cx("bg-surface px-3 py-2.5", i === 4 && "col-span-2 sm:col-span-1")}>
                    <dt className="label">{k}</dt>
                    <dd className="text-sm font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </header>

          {/* On small screens the trade ticket follows the odds directly. */}
          <div className="space-y-4 lg:hidden">
            <TradePanel marketId={id} chain={chain} side={side} onSideChange={setSide} />
            <PositionCard chain={chain} />
          </div>

          <nav aria-label="On this page" className="glass sticky top-[4.75rem] z-[var(--z-dropdown)] -mx-1 flex gap-1 overflow-x-auto rounded-md border p-1">
            {sections.map(([h, l]) => (
              <a key={h} href={`#${h}`} className="shrink-0 rounded-sm px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                {l}
              </a>
            ))}
          </nav>

          <section id="chart" aria-label="Price history" className="panel scroll-mt-32 p-5">
            {indexed ? <PriceChart marketId={id} /> : <p className="text-sm text-muted">Price history needs the market index, which is unavailable.</p>}
          </section>

          {rules && <div className="panel scroll-mt-32 p-5 md:p-6">{rules}</div>}
          <div className="panel scroll-mt-32 p-5 md:p-6">
            <ResolutionPanel marketId={id} chain={chain} question={question} structured={indexed?.structured ?? false} rules={rules} />
          </div>

          {indexed && (
            <section aria-labelledby="activity" className="panel scroll-mt-32 space-y-3 p-5 md:p-6">
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

          <section aria-labelledby="contract" className="panel scroll-mt-32 space-y-2 p-5 md:p-6">
            <h2 id="contract" className="text-xl font-semibold">On-chain details</h2>
            <dl className="divide-y divide-line">
              <KeyValue label="Market id">#{id}</KeyValue>
              <KeyValue label="Contract"><Address address={deployment.marketsAddress!} label="Contract" /></KeyValue>
              <KeyValue label="Collateral token"><Address address={deployment.musd} label="MUSD" /></KeyValue>
              {m && <KeyValue label="Creator"><Address address={m.creator} you={chain.account} label="Creator" /></KeyValue>}
              {indexed && <KeyValue label="Created">{formatDateTime(new Date(indexed.createdAt))}</KeyValue>}
              {indexed && <KeyValue label="Creation tx"><TxLink hash={indexed.createdTx} /></KeyValue>}
              {m && <KeyValue label="Pool (Yes / No shares)">{formatShares(m.poolYes)} / {formatShares(m.poolNo)}</KeyValue>}
              {m && stage?.stage === "open" && <KeyValue label="Trading closes">{formatDateTime(Number(m.closeTime) * 1000)}</KeyValue>}
            </dl>
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-[4.75rem] space-y-3">
            <TradePanel marketId={id} chain={chain} side={side} onSideChange={setSide} />
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
    <section aria-label="Your position" className="panel p-5">
      <h2 className="text-base font-semibold">Your position</h2>
      <dl className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const v = exit(r.side, r.shares);
          return (
            <div key={r.side} className="py-2 text-sm">
              <div className="flex justify-between">
                <dt className={r.side === "yes" ? "font-semibold text-yes-text" : "font-semibold text-no-text"}>{r.side === "yes" ? "Yes" : "No"}</dt>
                <dd className="mono">{formatShares(r.shares)} shares</dd>
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
