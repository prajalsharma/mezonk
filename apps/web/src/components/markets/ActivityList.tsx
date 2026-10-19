import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { EventDto } from "@/lib/api/types";
import { explorerTx } from "@/lib/chain/config";
import { formatMusd, formatShares, relativeTime, shortAddress } from "@/lib/format";
import { FINALIZE_REASON, outcomeLabel } from "@/lib/market/stage";

const s = (v: unknown) => String(v ?? "");

/** Human sentence for an indexed contract event. */
export function describeEvent(e: EventDto): string {
  const a = e.args;
  const who = e.actor ? shortAddress(e.actor) : "Someone";
  switch (e.eventName) {
    case "MarketCreated":
      return `${who} created the market`;
    case "Trade": {
      const side = a.isYes ? "Yes" : "No";
      return a.isBuy
        ? `${who} bought ${formatShares(s(a.shares))} ${side} for ${formatMusd(s(a.collateralAmount))} MUSD`
        : `${who} sold ${formatShares(s(a.shares))} ${side} for ${formatMusd(BigInt(s(a.collateralAmount)) - BigInt(s(a.fee)))} MUSD`;
    }
    case "OutcomeProposed":
      return `${who} proposed ${outcomeLabel(Number(a.outcome))}`;
    case "OutcomeDisputed":
      return `${who} disputed the proposed outcome`;
    case "DisputeArbitrated":
      return `Arbitrator ruled ${outcomeLabel(Number(a.outcome))}`;
    case "MarketFinalized":
      return `Final outcome: ${outcomeLabel(Number(a.outcome))} (${FINALIZE_REASON[Number(a.reason)] ?? "finalized"})`;
    case "Redeemed":
      return `${who} redeemed ${formatMusd(s(a.payout))} MUSD`;
    case "LiquidityClaimed":
      return `Creator withdrew ${formatMusd(s(a.payout))} MUSD of liquidity`;
    case "CreatorFeesClaimed":
      return `Creator claimed ${formatMusd(s(a.amount))} MUSD in fees`;
    case "BondCredited":
      return `${who} was credited a ${formatMusd(s(a.amount))} MUSD bond`;
    default:
      return e.eventName;
  }
}

export function ActivityList({ events, showMarket = false }: { events: EventDto[]; showMarket?: boolean }) {
  const now = Date.now();
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-ink">{describeEvent(e)}</p>
            {showMarket && e.marketId != null && (
              <Link href={`/markets/${e.marketId}`} className="line-clamp-1 text-ink-2 underline decoration-line underline-offset-2 hover:text-ink">
                {e.question ?? `Market #${e.marketId}`}
              </Link>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
            <time dateTime={e.blockTime} title={new Date(e.blockTime).toUTCString()}>
              {relativeTime(new Date(e.blockTime), now)}
            </time>
            <a href={explorerTx(e.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-ink">
              {e.txHash.slice(0, 10)}… <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </li>
      ))}
    </ol>
  );
}
