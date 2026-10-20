import Link from "next/link";
import { Change, ProbabilityBar } from "./Probability";
import { StageStatus } from "./StageStatus";
import { Skeleton } from "@/components/ui/primitives";
import type { MarketSummaryDto } from "@/lib/api/types";
import { formatMusd, formatProb, relativeTime } from "@/lib/format";
import { categoryLabel, type Category } from "@/lib/market/metadata";

/** One market in a list. A row, not a card: question first, numbers aligned for scanning. */
export function MarketRow({ m, now }: { m: MarketSummaryDto; now: number }) {
  const thin = BigInt(m.liquidity) < 100n * 10n ** 18n;
  const open = m.stage.stage === "open";
  return (
    <li className="group relative grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 border-b border-line py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_9rem_7rem_7rem]">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{categoryLabel[m.category as Category] ?? m.category}</span>
          <StageStatus stage={m.stage.stage} label={m.stage.label} finalOutcome={m.finalOutcome} />
          {open && <span>Closes {relativeTime(new Date(m.closeTime), now)}</span>}
          {open && thin && <span className="text-warn">Thin liquidity</span>}
          {!m.structured && <span className="text-warn">Unstructured rules</span>}
        </div>
        <Link href={`/markets/${m.id}`} className="block text-[0.9375rem] font-medium leading-snug text-ink after:absolute after:inset-0 group-hover:text-accent-text">
          {m.question}
        </Link>
      </div>
      <div className="w-24 space-y-1.5 md:w-auto">
        <div className="tnum flex items-baseline justify-between gap-2">
          <span className="mono text-lg font-semibold">{formatProb(m.priceYes)}</span>
          <span className="text-xs">
            <Change from={m.priceYes24hAgo} to={m.priceYes} />
          </span>
        </div>
        <ProbabilityBar priceYes={m.priceYes} size="sm" />
        <span className="sr-only">chance of Yes</span>
      </div>
      <div className="mono hidden text-right text-sm md:block">
        <div className="font-semibold">{formatMusd(m.volume, { compact: true })}</div>
        <div className="text-xs text-muted">volume</div>
      </div>
      <div className="mono hidden text-right text-sm md:block">
        <div className="font-semibold">{formatMusd(m.liquidity, { compact: true })}</div>
        <div className="text-xs text-muted">collateral</div>
      </div>
    </li>
  );
}

export function MarketListHeader() {
  return (
    <div className="label hidden grid-cols-[minmax(0,1fr)_9rem_7rem_7rem] gap-x-6 border-b border-line py-3 md:grid">
      <span>Market</span>
      <span>Chance of Yes · 24h</span>
      <span className="text-right">Volume (MUSD)</span>
      <span className="text-right">Collateral (MUSD)</span>
    </div>
  );
}

export function MarketRowSkeleton() {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-6 border-b border-line py-4 md:grid-cols-[minmax(0,1fr)_9rem_7rem_7rem]">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-6 w-24 md:w-full" />
      <Skeleton className="hidden h-6 md:block" />
      <Skeleton className="hidden h-6 md:block" />
    </li>
  );
}
