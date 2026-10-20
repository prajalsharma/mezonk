import { Bitcoin, Coins, Cpu, Layers, Sparkles, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { Skeleton } from "@/components/ui/primitives";
import type { MarketSummaryDto } from "@/lib/api/types";
import { formatMusd, formatPrice, formatProb, relativeTime } from "@/lib/format";
import { categoryLabel, type Category } from "@/lib/market/metadata";
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

/** Outcome strip for settled markets: the result replaces the buy buttons. */
function Settled({ m }: { m: MarketSummaryDto }) {
  const o = m.finalOutcome;
  const label = o === 1 ? "Resolved Yes" : o === 2 ? "Resolved No" : "Invalid · 0.5 MUSD per share";
  return (
    <div
      className={cx(
        "flex h-11 items-center justify-center rounded-md text-sm font-semibold",
        o === 1 ? "bg-yes-soft text-yes-text" : o === 2 ? "bg-no-soft text-no-text" : "bg-warn-soft text-warn",
      )}
    >
      {label}
    </div>
  );
}

/**
 * A market as a decision card: what is being asked, what the market thinks, and two ways to act.
 * The question link covers the card for navigation; the outcome buttons sit above it as separate,
 * explicitly labelled links that open the market with that side selected (nothing is bought from here).
 */
export function MarketCard({ m, now, index = 0, featured = false }: { m: MarketSummaryDto; now: number; index?: number; featured?: boolean }) {
  const open = m.stage.stage === "open";
  const settled = m.stage.stage === "resolved" || m.stage.stage === "invalid";
  const thin = BigInt(m.liquidity) < 100n * 10n ** 18n;
  const yes = m.priceYes;
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

      <h3 className={cx("font-medium leading-snug text-ink", featured ? "text-lg md:text-xl" : "line-clamp-3 text-[0.9375rem]")}>
        <Link href={`/markets/${m.id}`} className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-focus">
          {m.question}
        </Link>
      </h3>

      <div className="mt-auto space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <p className="flex items-baseline gap-2">
            <span className={cx("mono font-semibold text-ink", featured ? "text-4xl" : "text-3xl")}>{formatProb(yes)}</span>
            <span className="text-xs text-muted">{settled ? "final price" : "chance"}</span>
          </p>
          {!settled && Math.abs(yes - m.priceYes24hAgo) >= 0.005 && (
            <span className="mono text-xs">
              <Change from={m.priceYes24hAgo} to={yes} />
            </span>
          )}
        </div>
        <ProbabilityBar priceYes={yes} size="sm" />
      </div>

      {settled ? (
        <Settled m={m} />
      ) : open ? (
        <div className="relative z-10 grid grid-cols-2 gap-2">
          <Link
            href={`/markets/${m.id}?side=yes`}
            aria-label={`Buy Yes at ${formatPrice(yes)} MUSD: ${m.question}`}
            className="press flex h-11 items-center justify-between rounded-md bg-yes-soft px-3 text-sm font-semibold text-yes-text ring-1 ring-yes/25 transition-colors hover:bg-yes hover:text-on-yes"
          >
            <span>Yes</span>
            <span className="mono">{formatPrice(yes)}</span>
          </Link>
          <Link
            href={`/markets/${m.id}?side=no`}
            aria-label={`Buy No at ${formatPrice(1 - yes)} MUSD: ${m.question}`}
            className="press flex h-11 items-center justify-between rounded-md bg-no-soft px-3 text-sm font-semibold text-no-text ring-1 ring-line transition-colors hover:bg-no hover:text-on-no"
          >
            <span>No</span>
            <span className="mono">{formatPrice(1 - yes)}</span>
          </Link>
        </div>
      ) : (
        <div className="flex h-11 items-center justify-center rounded-md bg-surface-2 text-sm text-ink-2 ring-1 ring-line">Trading closed · {m.stage.label}</div>
      )}

      <footer className="mono flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[11px] text-muted">
        <span>{m.tradeCount ? `${formatMusd(m.volume, { compact: true })} MUSD vol` : "No trades yet"}</span>
        {m.traders24h > 0 && <span>{m.traders24h} traders 24h</span>}
        {open && <span>Closes {new Date(m.closeTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>}
        {open && thin && <span className="text-warn">Thin liquidity</span>}
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
