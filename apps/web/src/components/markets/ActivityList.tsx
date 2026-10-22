import Link from "next/link";
import type { EventDto } from "@/lib/api/types";
import { TxLink } from "@/components/ui/Address";
import { formatMusd, formatShares, relativeTime, shortAddress } from "@/lib/format";
import { FINALIZE_REASON, outcomeLabel } from "@/lib/market/stage";

const s = (v: unknown) => String(v ?? "");

const outcomeName = (o: unknown) => (Number(o) === 0 ? "Yes" : "No");

/** Average price in whole cents from an exact notional and quantity (display only). */
function avgCentsLabel(notional: string, filled: string): string {
  const f = BigInt(filled || "0");
  if (f === 0n) return "";
  return ` at ${Number((BigInt(notional) * 100n + f / 2n) / f)}¢`;
}

/**
 * Human sentence for an indexed contract event, or null for internal plumbing that has a better sentence elsewhere
 * (each Fill is summarised by its TakeSettled; nonce and approval bookkeeping isn't news).
 */
export function describeEvent(e: EventDto): string | null {
  const a = e.args;
  const who = e.actor ? shortAddress(e.actor) : "Someone";
  switch (e.eventName) {
    case "TakeSettled":
      return `${who} ${Number(a.side) === 0 ? "bought" : "sold"} ${formatShares(s(a.filled))} ${outcomeName(a.outcome)}${avgCentsLabel(s(a.notional), s(a.filled))}`;
    case "OrderPlaced":
      return `${who} ${Number(a.side) === 0 ? "offered to buy" : "offered to sell"} ${formatShares(s(a.quantity))} ${outcomeName(a.outcome)} at ${s(a.price)}¢${a.seed ? " to back the market" : ""}`;
    case "OrderCancelled":
      return `${who} cancelled an order`;
    case "Graduated":
      return `Market launched: both sides funded by ${s(a.seeders)} backers`;
    case "MarketSettled":
      return `Settled: ${outcomeLabel(Number(a.outcome))}`;
    case "Split":
      return `${who} turned ${formatMusd(s(a.amount))} MUSD into Yes + No pairs`;
    case "Merged":
      return `${who} turned Yes + No pairs back into ${formatMusd(s(a.amount))} MUSD`;
    case "RebateClaimed":
      return `${who} claimed a ${formatMusd(s(a.amount))} MUSD backer rebate`;
    case "ReferralClaimed":
      return `${who} claimed ${formatMusd(s(a.amount))} MUSD in referral rewards`;
    case "Fill":
    case "RebateAccrued":
    case "ReferralAccrued":
    case "MarketApprovalUsed":
    case "SignedOrderCancelled":
    case "MinNonceRaised":
    case "SharesTransferred":
      return null;
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
      // Unknown events stay readable: split "SomethingHappened" into words rather than show a code name.
      return e.eventName.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  }
}

export function ActivityList({ events, showMarket = false }: { events: EventDto[]; showMarket?: boolean }) {
  const now = Date.now();
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => ({ e, text: describeEvent(e) })).filter((x) => x.text).map(({ e, text }) => (
        <li key={e.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-ink">{text}</p>
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
            <TxLink hash={e.txHash} />
          </div>
        </li>
      ))}
    </ol>
  );
}
