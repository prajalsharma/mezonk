import { Bitcoin, Coins, Cpu, Layers, Sparkles, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { Skeleton } from "@/components/ui/primitives";
import { type MarketSummaryDto, marketHref } from "@/lib/api/types";
import { formatCents, formatMusd, formatProb, marketSignal, relativeTime } from "@/lib/format";
import { categoryLabel, type Category } from "@/lib/market/metadata";
import { winAtBest } from "@/lib/market/payout";
import { Change, ProbabilityBar } from "./Probability";

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  crypto: Coins,
  defi: Layers,
  bitcoin: Bitcoin,
  technology: Cpu,
  economics: TrendingUp,
  sports: Trophy,
  other: Sparkles,
};

export function CategoryGlyph({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Sparkles;
  return (
    <span aria-hidden className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 text-ink-2", className)}>
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}

const DAY = 86_400_000;

/** Status chip in the card header. Text always carries the state; colour only reinforces it. */
export function MarketStatusChip({ m, now }: { m: MarketSummaryDto; now: number }) {
  const s = m.stage.stage;
  const closeMs = new Date(m.closeTime).getTime();
  if (s === "seeding") {
    return <span className="rounded-full bg-info/12 px-2 py-0.5 text-xs font-medium text-info">Seeding</span>;
  }
  if (s === "failed") {
    return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-line">Didn&apos;t launch</span>;
  }
  if (s === "open" && m.lowLiquidity) {
    return <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Low liquidity</span>;
  }
  if (s === "open") {
    const soon = closeMs - now < 2 * DAY;
    return soon ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
        <span aria-hidden className="size-1.5 rounded-full bg-warn" />
        Closes {relativeTime(closeMs, now)}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
        <span aria-hidden className="live-dot size-1.5 rounded-full bg-accent" />
        Live
      </span>
    );
  }
  if (s === "resolved" || s === "invalid") {
    return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-line">Settled</span>;
  }
  return <span className="rounded-full bg-info/12 px-2 py-0.5 text-xs font-medium text-info">{m.stage.label}</span>;
}

/** Outcome strip for settled markets: the result replaces the buy buttons, with how many people called it. */
function Settled({ m }: { m: MarketSummaryDto }) {
  const o = m.finalOutcome;
  const label = o === 1 ? "Resolved Yes" : o === 2 ? "Resolved No" : "Invalid · 0.5 MUSD per share";
  const { yesPeople, noPeople } = m.crowd;
  const right = o === 1 ? yesPeople : o === 2 ? noPeople : null;
  return (
    <div
      className={cx(
        "flex min-h-11 flex-col items-center justify-center rounded-md px-3 py-2 text-center",
        o === 1 ? "bg-yes-soft text-yes-text" : o === 2 ? "bg-no-soft text-no-text" : "bg-warn-soft text-warn",
      )}
    >
      <span className="text-sm font-semibold">{label}</span>
      {right != null && yesPeople + noPeople > 0 && (
        <span className="text-xs opacity-80">
          {right} of {yesPeople + noPeople} {yesPeople + noPeople === 1 ? "person" : "people"} called it
        </span>
      )}
    </div>
  );
}

/** How many people backed each side, and with how much. Nothing when no one has. */
export function CrowdSplit({ m, className }: { m: Pick<MarketSummaryDto, "crowd">; className?: string }) {
  const { yesPeople, noPeople, yesStake, noStake } = m.crowd;
  if (yesPeople + noPeople === 0) return null;
  return (
    <p className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}>
      <span className="text-yes-text">
        <span className="mono font-semibold">{yesPeople}</span> on Yes
        {yesPeople > 0 && <> · <span className="mono">{formatMusd(yesStake, { compact: true })}</span> MUSD</>}
      </span>
      <span className="text-ink-2">
        <span className="mono font-semibold text-ink">{noPeople}</span> on No
        {noPeople > 0 && <> · <span className="mono">{formatMusd(noStake, { compact: true })}</span> MUSD</>}
      </span>
    </p>
  );
}

/** Example stake on every card: small enough that the best price holds, big enough to feel real. */
const CARD_STAKE = 10;

/**
 * One outcome as a button that says what you get: the price, and what a 10 MUSD stake pays if it wins
 * (best price, fee included). Opens the market with that side and stake picked; nothing is bought from here.
 */
function OutcomeButton({ m, side, cents }: { m: MarketSummaryDto; side: "yes" | "no"; cents: number | null }) {
  const win = winAtBest(BigInt(CARD_STAKE) * 10n ** 18n, cents, m.feeBps);
  const yes = side === "yes";
  const label = yes ? "Yes" : "No";
  return (
    <Link
      href={marketHref(m, side, win ? CARD_STAKE : undefined)}
      aria-label={
        cents == null
          ? `${label}: no sellers right now: ${m.question}`
          : `Buy ${label} at ${cents} cents. ${win ? `${win.limited ? formatMusd(win.spent) : CARD_STAKE} MUSD pays ${formatMusd(win.payout)} MUSD if ${label} wins` : ""}: ${m.question}`
      }
      className={cx(
        "press group/out flex min-h-14 flex-col justify-center gap-0.5 rounded-md px-3 py-2 ring-1 transition-colors",
        yes ? "bg-yes-soft text-yes-text ring-yes/25 hover:bg-yes hover:text-on-yes" : "bg-no-soft text-no-text ring-line hover:bg-no hover:text-on-no",
      )}
    >
      <span className="flex items-center justify-between text-sm font-semibold">
        <span>{label}</span>
        <span className="mono">{cents != null ? formatCents(cents) : "no offers"}</span>
      </span>
      {win && (
        <span className="mono text-[11px] font-medium opacity-80">
          {win.limited ? formatMusd(win.spent) : CARD_STAKE} → {formatMusd(win.payout)} MUSD
        </span>
      )}
    </Link>
  );
}

/**
 * A market as a decision card: what is being asked, what the market thinks, and two ways to act.
 * The question link covers the card for navigation; the outcome buttons sit above it as separate,
 * explicitly labelled links that open the market with that side selected (nothing is bought from here).
 */
export function MarketCard({ m, now, index = 0, featured = false }: { m: MarketSummaryDto; now: number; index?: number; featured?: boolean }) {
  const open = m.stage.stage === "open";
  const seeding = m.stage.stage === "seeding";
  const settled = m.stage.stage === "resolved" || m.stage.stage === "invalid";
  const sig = marketSignal(m);
  // Executable prices: buying YES costs the best YES ask; buying NO costs 100 − best YES bid.
  const buyYes = m.bestAsk;
  const buyNo = m.bestBid == null ? null : 100 - m.bestBid;
  return (
    <article
      className={cx("panel card-hover rise group relative flex flex-col gap-4 p-4", featured && "md:p-5")}
      style={{ "--i": index } as CSSProperties}
    >
      <header className="flex items-center gap-2.5">
        <CategoryGlyph category={m.category} />
        <span className="text-xs text-muted">{categoryLabel[m.category as Category] ?? m.category}</span>
        <span className="ml-auto">
          <MarketStatusChip m={m} now={now} />
        </span>
      </header>

      <div className="flex items-start gap-3">
        {m.cover && (
          // Decorative: the question beside it says what the market is.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.cover.url}
            alt=""
            width={m.cover.width}
            height={m.cover.height}
            loading="lazy"
            decoding="async"
            className={cx("shrink-0 rounded-sm border border-line bg-surface-2 object-cover", featured ? "size-16" : "size-12")}
          />
        )}
        <h3 className={cx("min-w-0 font-medium leading-snug text-ink", featured ? "text-lg md:text-xl" : "line-clamp-3 text-[0.9375rem]")}>
          <Link href={marketHref(m)} className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-focus">
            {m.question}
          </Link>
        </h3>
      </div>

      <div className="mt-auto space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          {sig.kind === "none" ? (
            <p className="flex items-baseline gap-2">
              <span className={cx("mono font-semibold text-muted", featured ? "text-4xl" : "text-3xl")}>—</span>
              <span className="text-xs text-muted">{seeding ? "no trading yet" : "no trades yet"}</span>
            </p>
          ) : (
            <p className="flex items-baseline gap-2">
              <span className={cx("mono font-semibold", sig.kind === "trade" ? "text-ink" : "text-ink-2", featured ? "text-4xl" : "text-3xl")}>
                {sig.kind === "indicative" && <span className="sr-only">about </span>}
                {sig.kind === "indicative" ? "~" : ""}
                {formatProb(sig.p)}
              </span>
              <span className="text-xs text-muted">{settled ? "final price" : sig.kind === "trade" ? "chance of Yes" : "estimated chance · no trades yet"}</span>
            </p>
          )}
          {!settled && m.priceYes != null && m.priceYes24hAgo != null && Math.abs(m.priceYes - m.priceYes24hAgo) >= 0.005 && (
            <span className="mono text-xs">
              <Change from={m.priceYes24hAgo} to={m.priceYes} />
            </span>
          )}
        </div>
        {sig.kind !== "none" && <ProbabilityBar priceYes={sig.p} size="sm" />}
        <CrowdSplit m={m} />
      </div>

      {settled ? (
        <Settled m={m} />
      ) : open ? (
        <div className="relative z-10 grid grid-cols-2 gap-2">
          <OutcomeButton m={m} side="yes" cents={buyYes} />
          <OutcomeButton m={m} side="no" cents={buyNo} />
        </div>
      ) : seeding ? (
        <Link
          href={marketHref(m)}
          className="press relative z-10 flex h-11 items-center justify-center rounded-md bg-surface-2 text-sm font-medium text-ink ring-1 ring-line hover:bg-raised"
        >
          Back this market · seeding
        </Link>
      ) : (
        <div className="flex h-11 items-center justify-center rounded-md bg-surface-2 text-sm text-ink-2 ring-1 ring-line">
          {m.stage.stage === "failed" ? "Didn't reach launch liquidity · refunds open" : `Trading closed · ${m.stage.label}`}
        </div>
      )}

      <footer className="mono flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[11px] text-muted">
        <span>{m.tradeCount ? `${formatMusd(m.volume, { compact: true })} MUSD vol` : "No trades yet"}</span>
        {m.traders24h > 0 && <span>{m.traders24h} {m.traders24h === 1 ? "trader" : "traders"} 24h</span>}
        {open && <span>Closes {new Date(m.closeTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>}
        {seeding && m.stage.deadline && <span>Seeding ends {relativeTime(new Date(m.stage.deadline).getTime(), now)}</span>}
        {!m.structured && <span className="text-warn">Unstructured rules</span>}
        <span className="ml-auto">#{m.id}</span>
      </footer>
    </article>
  );
}

export function MarketCardSkeleton() {
  return (
    <div className="panel flex flex-col gap-4 p-4" aria-hidden>
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-4 h-8 w-24" />
      <Skeleton className="h-2 w-full" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
    </div>
  );
}

/** Responsive card grid with loading and empty handling. */
export function MarketGrid({
  items,
  isLoading,
  error,
  empty,
  skeletons = 6,
  className,
}: {
  items?: MarketSummaryDto[];
  isLoading: boolean;
  error?: Error | null;
  empty: React.ReactNode;
  skeletons?: number;
  className?: string;
}) {
  const now = Date.now();
  const grid = cx("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className);
  if (error && !items) {
    return <p className="panel p-5 text-sm text-ink-2">The market index is unavailable right now. Markets and funds on-chain are unaffected.</p>;
  }
  if (isLoading && !items) {
    return (
      <div className={grid} aria-busy="true" aria-label="Loading markets">
        {Array.from({ length: skeletons }, (_, i) => <MarketCardSkeleton key={i} />)}
      </div>
    );
  }
  if (!items?.length) return <>{empty}</>;
  return (
    <div className={grid}>
      {items.map((m, i) => <MarketCard key={m.id} m={m} now={now} index={i} />)}
    </div>
  );
}
