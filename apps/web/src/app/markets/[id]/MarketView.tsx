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
import { Change, ProbabilityBar } from "@/components/markets/Probability";
import { CategoryGlyph } from "@/components/markets/MarketCard";
import { UserChip, type PublicPerson } from "@/components/profile/UserChip";
import { Discussion } from "@/features/comments/Discussion";
import { cx } from "@/components/ui/cx";
import { RulesPanel } from "@/components/markets/RulesPanel";
import { StageStatus } from "@/components/markets/StageStatus";
import { TradeTicket } from "@/features/trading/TradeTicket";
import { OrderBook } from "@/features/trading/OrderBook";
import { SeedingPanel } from "@/features/trading/SeedingPanel";
import { MyOrders, PositionCard, RecentFills } from "@/features/trading/Positions";
import { useBook, useSeeding } from "@/features/trading/api";
import { ResolutionPanel } from "@/features/resolution/ResolutionPanel";
import { useMarketChain } from "@/hooks/useMarketChain";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { apiGet, type EventDto } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { formatDateTime, formatMusd, formatProb, relativeTime } from "@/lib/format";
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
  priceYes24hAgo: number | null;
  presentation: {
    creator: PublicPerson;
    suggestedBy: PublicPerson | null;
    proposalId: string | null;
    summary: string;
    media: Array<{ id: string; url: string; width: number; height: number; role: string }>;
  } | null;
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
  // A stake picked on the landing page (?amount=10) prefills the ticket. Whole MUSD only, 1–100,000.
  const amountParam = /^\d{1,6}$/.test(params.get("amount") ?? "") && Number(params.get("amount")) >= 1 ? params.get("amount")! : undefined;
  const { add } = useRecentlyViewed();
  useEffect(() => add(id), [id, add]);
  // In-page links to a collapsed section (#book, #resolution) open it.
  useEffect(() => {
    const openTarget = () => {
      const el = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
      if (el instanceof HTMLDetailsElement) el.open = true;
    };
    openTarget();
    window.addEventListener("hashchange", openTarget);
    return () => window.removeEventListener("hashchange", openTarget);
  }, []);
  const meta = useMemo(() => (indexed ? parseMetadata(indexed.metadataRaw) : null), [indexed]);
  const m = chain.market;
  const raw = chain.raw;
  const [preset, setPreset] = useState<{ action: "buy" | "sell"; price: number; nonce: number } | null>(null);
  const book = useBook(id, !!raw && chain.exStage !== 0 && chain.exStage !== 2);
  const seeding = useSeeding(id, chain.exStage === 0 || chain.exStage === 2);
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

  const stage = m && raw
    ? deriveStage({
        closeTime: new Date(Number(m.closeTime) * 1000),
        seedingDeadline: new Date(Number(raw.seedingDeadline) * 1000),
        graduatedAt: raw.graduatedAt > 0n ? new Date(Number(raw.graduatedAt) * 1000) : null,
        proposalWindow: m.proposalWindow,
        proposedAt: m.proposedAt ? new Date(Number(m.proposedAt) * 1000) : null,
        challengeDeadline: m.proposedAt ? new Date(Number(m.proposedAt + BigInt(m.challengeWindow)) * 1000) : null,
        disputedAt: m.disputedAt ? new Date(Number(m.disputedAt) * 1000) : null,
        arbitrationDeadline: m.disputedAt ? new Date(Number(m.disputedAt + BigInt(m.arbitrationWindow)) * 1000) : null,
        finalOutcome: m.finalized ? m.finalOutcome : null,
      }, chainNowMs)
    : null;
  const preLaunch = stage?.stage === "seeding" || stage?.stage === "failed";
  const bk = book.data;
  // One number with provenance: last real trade, else indicative midpoint, else nothing.
  const priceYes = bk?.lastPrice != null ? bk.lastPrice / 100 : null;
  const indicative = priceYes == null && bk?.mid != null ? bk.mid / 100 : null;
  const shown = priceYes ?? indicative;
  const question = indexed?.question ?? `Market #${id}`;
  const rules = indexed ? (
    <RulesPanel meta={meta} raw={indexed.metadataRaw} onchainHash={raw?.metadataHash ?? indexed.metadataHash} closeTime={new Date(Number(m?.closeTime ?? 0n) * 1000)} />
  ) : null;

  const sections: Array<[string, string]> = [
    ["chart", "Chart"],
    ...(!preLaunch ? ([["book", "Order book"]] as Array<[string, string]>) : []),
    ...(indexed ? ([["rules", "Rules"]] as Array<[string, string]>) : []),
    ...(indexed ? ([["discussion", "Discussion"]] as Array<[string, string]>) : []),
    ["resolution", "Resolution"],
    ...(indexed ? ([["activity", "Activity"]] as Array<[string, string]>) : []),
    ["contract", "On-chain"],
  ];
  const open = stage?.stage === "open";
  const pres = indexed?.presentation ?? null;
  const minRest = seeding.data?.policy.minRest ?? 3600;
  const sidebar = preLaunch ? (
    <SeedingPanel marketId={id} chain={chain} chainNowMs={chainNowMs} />
  ) : (
    <>
      {open ? (
        <TradeTicket marketId={id} chain={chain} side={side} onSideChange={setSide} preset={preset} initialAmount={amountParam} />
      ) : stage ? (
        <div className="panel space-y-1 p-5 text-sm">
          <p className="font-medium text-ink">Trading has closed</p>
          <p className="text-ink-2">Positions settle by the resolution process on this page. Open orders can be cancelled below.</p>
        </div>
      ) : null}
      <MyOrders marketId={id} chainNowMs={chainNowMs} minRest={minRest} graduatedAtMs={Number(raw?.graduatedAt ?? 0n) * 1000} />
      <PositionCard marketId={id} chain={chain} />
    </>
  );
  const cover = pres?.media.find((x) => x.role === "cover") ?? null;
  const gallery = pres?.media.filter((x) => x.role === "context") ?? [];

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
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.url} alt="" width={cover.width} height={cover.height} className="-mx-5 -mt-5 mb-5 block aspect-[21/9] w-[calc(100%+2.5rem)] max-w-none object-cover md:-mx-7 md:-mt-7 md:mb-7 md:w-[calc(100%+3.5rem)]" />
            )}
            {!cover && <div aria-hidden className="grid-bg absolute inset-0" />}
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
              {pres?.summary && <p className="max-w-2xl text-lg text-ink-2">{pres.summary}</p>}
              {pres && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <UserChip person={pres.creator} sub="created this market" />
                  {pres.suggestedBy && <UserChip person={pres.suggestedBy} sub="suggested it" />}
                  {pres.proposalId && (
                    <Link href={`/proposals/${pres.proposalId}`} className="text-sm text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                      Review history
                    </Link>
                  )}
                </div>
              )}

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
              {!raw ? (
                <Skeleton className="h-28 w-full" />
              ) : preLaunch ? (
                <div className="rounded-md border border-line bg-surface p-4 md:p-5">
                  <p className="text-lg font-semibold">{stage?.stage === "failed" ? "Didn't launch" : "Seeding · not trading yet"}</p>
                  <p className="mt-1 text-sm text-ink-2">
                    {stage?.stage === "failed"
                      ? "Not enough funded orders arrived in time. No trades happened; every seeder can take their deposit back."
                      : `This market goes live once enough funded orders sit on both sides. ${seeding.data ? `Now: Yes bid ${seeding.data.check.bestBid || "—"}¢ · ask ${seeding.data.check.bestAsk || "—"}¢ · ${seeding.data.check.seeders} seeders.` : ""}`}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* One headline number with provenance, then the two ways in. */}
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    {shown != null ? (
                      <p className="flex items-baseline gap-2">
                        <span className="mono text-5xl font-medium tracking-tight md:text-6xl">
                          {priceYes == null && "~"}
                          {formatProb(shown)}
                        </span>
                        <span className="text-lg font-semibold text-yes-text">Yes</span>
                      </p>
                    ) : (
                      <p className="text-2xl font-medium text-ink-2">No trades yet</p>
                    )}
                    {indexed && priceYes != null && indexed.priceYes24hAgo != null && (
                      <span className="mono pb-2 text-sm">
                        <Change from={indexed.priceYes24hAgo} to={priceYes} /> <span className="text-muted">24h</span>
                      </span>
                    )}
                  </div>
                  {shown != null && <ProbabilityBar priceYes={shown} size="lg" />}
                  <p className="text-xs text-muted">
                    {priceYes != null
                      ? "Chance of Yes from the last trade. A price, not a guarantee."
                      : indicative != null
                        ? "No trades yet, so this is an estimate: halfway between the best offers to buy and sell."
                        : "No trades and no offers on both sides yet, so there is no price."}
                  </p>
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
                    {(["yes", "no"] as const).map((s) => {
                      const buyAt = !bk ? null : s === "yes" ? bk.bestAsk : bk.bestBid == null ? null : 100 - bk.bestBid;
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
                            "press flex h-14 items-center justify-between rounded-md border px-4 font-semibold transition-[border-color,background-color,color] duration-200 disabled:cursor-default",
                            active
                              ? s === "yes"
                                ? "border-yes bg-yes text-on-yes"
                                : "border-no bg-no text-on-no"
                              : cx("border-line bg-surface hover:border-line-strong", s === "yes" ? "text-yes-text" : "text-no-text"),
                          )}
                        >
                          <span>Buy {s === "yes" ? "Yes" : "No"}</span>
                          <span className="mono">{buyAt != null ? `${buyAt}¢` : "no offers"}</span>
                        </button>
                      );
                    })}
                  </div>
                  {bk?.bestAsk != null && bk.bestBid != null && bk.bestAsk > bk.bestBid && (
                    <p className="text-xs text-muted">
                      Yes and No add up to {bk.bestAsk + 100 - bk.bestBid}¢ because you buy from the cheapest seller on each side. The extra{" "}
                      {bk.bestAsk - bk.bestBid}¢ is the spread between buyers and sellers.
                    </p>
                  )}
                </div>
              )}

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-5">
                {[
                  ["Volume", indexed ? `${formatMusd(indexed.volume, { compact: true })}` : "—"],
                  ["Open interest", raw ? formatMusd(raw.collateral, { compact: true }) : "—"],
                  [
                    "Spread",
                    preLaunch
                      ? seeding.data && seeding.data.check.bestBid > 0 && seeding.data.check.bestAsk > 0 && stage?.stage === "seeding"
                        ? `${seeding.data.check.bestAsk - seeding.data.check.bestBid}¢`
                        : "—"
                      : bk?.spread != null
                        ? `${bk.spread}¢`
                        : "—",
                  ],
                  ["Traders", String(indexed?.traderCount ?? "—")],
                  preLaunch
                    ? ["Seeding ends", raw ? relativeTime(Number(raw.seedingDeadline) * 1000, chainNowMs) : "—"]
                    : [open || !m ? "Closes" : "Closed", m ? relativeTime(Number(m.closeTime) * 1000, chainNowMs) : "—"],
                ].map(([k, v], i) => (
                  <div key={k} className={cx("bg-surface px-3 py-2.5", i === 4 && "col-span-2 sm:col-span-1")}>
                    <dt className="label">{k}</dt>
                    <dd className="mono mt-0.5 text-sm font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </header>

          {/* On small screens the ticket follows the odds directly. */}
          <div className="space-y-4 lg:hidden">{sidebar}</div>

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

          {!preLaunch && (
            <details id="book" className="panel group scroll-mt-32">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 font-medium [&::-webkit-details-marker]:hidden">
                <span>Order book and recent trades</span>
                <span className="text-sm text-ink-2">
                  <span className="group-open:hidden">Show</span>
                  <span className="hidden group-open:inline">Hide</span>
                </span>
              </summary>
              <div role="region" aria-label="Order book" className="grid gap-6 border-t border-line p-5 md:grid-cols-[1.4fr_1fr]">
              <OrderBook
                marketId={id}
                onPick={(p) => {
                  setSide(p.outcome === 0 ? "yes" : "no");
                  setPreset({ action: p.side === 0 ? "buy" : "sell", price: p.price, nonce: Date.now() });
                }}
              />
              <RecentFills marketId={id} />
              </div>
            </details>
          )}

          {rules && (
            <div className="panel scroll-mt-32 space-y-6 p-5 md:p-6">
              {rules}
              {gallery.length > 0 && (
                <section aria-labelledby="context-images" className="space-y-3 border-t border-line pt-5">
                  <h3 id="context-images" className="font-medium">Context images</h3>
                  <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {gallery.map((g) => (
                      <li key={g.id}>
                        <a href={g.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-line">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={g.url} alt="Context image supplied by the author" width={g.width} height={g.height} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">Supplied by the market&apos;s author for context. The written rules above decide the outcome.</p>
                </section>
              )}
            </div>
          )}
          {indexed && <Discussion marketId={id} />}

          {/* Resolution matters once trading closes; while a market trades it stays one click away. */}
          <details id="resolution" open={!open && !preLaunch} className="panel group scroll-mt-32">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 font-medium md:px-6 [&::-webkit-details-marker]:hidden">
              <span>How this market resolves</span>
              <span className="text-sm text-ink-2">
                <span className="group-open:hidden">Show</span>
                <span className="hidden group-open:inline">Hide</span>
              </span>
            </summary>
            <div className="border-t border-line p-5 md:p-6">
              <ResolutionPanel marketId={id} chain={chain} question={question} structured={indexed?.structured ?? false} rules={rules} />
            </div>
          </details>

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
              <KeyValue label="Exchange"><Address address={deployment.marketsAddress!} label="Exchange" /></KeyValue>
              <KeyValue label="Resolution"><Address address={deployment.resolutionAddress!} label="Resolution" /></KeyValue>
              {raw && <KeyValue label="Policy">#{raw.policyId} (graduation and fee terms fixed at publication)</KeyValue>}
              <KeyValue label="Collateral token"><Address address={deployment.musd} label="MUSD" /></KeyValue>
              {m && <KeyValue label="Creator"><Address address={m.creator} you={chain.account} label="Creator" /></KeyValue>}
              {indexed && <KeyValue label="Created">{formatDateTime(new Date(indexed.createdAt))}</KeyValue>}
              {indexed && <KeyValue label="Creation tx"><TxLink hash={indexed.createdTx} /></KeyValue>}
              {raw && <KeyValue label="Collateral backing shares">{formatMusd(raw.collateral)} MUSD</KeyValue>}
              {m && stage?.stage === "open" && <KeyValue label="Trading closes">{formatDateTime(Number(m.closeTime) * 1000)}</KeyValue>}
            </dl>
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-[4.75rem] space-y-3">{sidebar}</div>
        </aside>
      </div>
    </div>
  );
}
