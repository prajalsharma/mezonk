"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui/cx";
import { Hint, Segmented, Skeleton } from "@/components/ui/primitives";
import { formatMusd } from "@/lib/format";
import { cost, formatShares } from "@/lib/orderbook/math";
import { useBook } from "./api";

type View = "yes" | "no";
const LEVELS = 8;

/**
 * The live book for one market. Levels come from orders that exist right now: escrowed orders (locked on-chain,
 * marked with a lock) and signed orders (funded when last checked). Nothing here is a trade except "Last trade".
 */
export function OrderBook({ marketId, onPick }: { marketId: number; onPick?: (p: { outcome: 0 | 1; side: 0 | 1; price: number }) => void }) {
  const q = useBook(marketId);
  const [view, setView] = useState<View>("yes");
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <p className="text-sm text-ink-2">The order book is unavailable right now. On-chain orders are unaffected.</p>;
  const b = q.data;
  // NO view mirrors the YES book: a YES ask at y is a NO bid at 100 − y.
  const asks = (view === "yes" ? b.asks : b.bids.map((l) => ({ ...l, yes: 100 - l.yes }))).slice(0, LEVELS);
  const bids = (view === "yes" ? b.bids : b.asks.map((l) => ({ ...l, yes: 100 - l.yes }))).slice(0, LEVELS);
  const outcome = view === "yes" ? 0 : 1;
  const bestBid = bids[0]?.yes ?? null;
  const bestAsk = asks[0]?.yes ?? null;
  const max = [...asks, ...bids].reduce((m, l) => (BigInt(l.shares) > m ? BigInt(l.shares) : m), 1n);
  const empty = !asks.length && !bids.length;

  const Row = ({ l, kind }: { l: (typeof asks)[number]; kind: "ask" | "bid" }) => {
    const pct = Number((BigInt(l.shares) * 100n) / max);
    return (
      <li>
        <button
          type="button"
          onClick={() => onPick?.({ outcome, side: kind === "ask" ? 0 : 1, price: l.yes })}
          className="group relative grid w-full grid-cols-[4rem_1fr_1fr] items-center gap-2 px-3 py-1 text-left text-sm hover:bg-surface-2"
          aria-label={`${kind === "ask" ? "Offer to sell" : "Bid to buy"} ${formatShares(BigInt(l.shares))} ${view === "yes" ? "Yes" : "No"} at ${l.yes} cents. Use this price.`}
        >
          <span aria-hidden className={cx("absolute inset-y-0.5 right-0 rounded-l-sm", kind === "ask" ? "bg-danger-soft" : "bg-success-soft")} style={{ width: `${pct}%` }} />
          <span className={cx("mono relative font-semibold", kind === "ask" ? "text-danger" : "text-success")}>{l.yes}¢</span>
          <span className="mono relative flex items-center justify-end gap-1 text-ink">
            {BigInt(l.resting) > 0n && <Lock aria-label="includes escrowed liquidity" className="size-3 text-muted" />}
            {formatShares(BigInt(l.shares))}
          </span>
          <span className="mono relative text-right text-ink-2">{formatMusd(cost(BigInt(l.shares), l.yes), { compact: true })}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-medium">
          Order book
          <Hint label="order book">
            Prices are in cents per share; a winning share pays 1 MUSD. A lock means the order&apos;s funds are escrowed in the contract.
            Other orders are signed and funded when last checked; the contract re-checks at settlement.
          </Hint>
        </h3>
        <Segmented label="Book view" value={view} onChange={setView} className="w-36" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
      </div>
      {empty ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-ink-2">
          No orders yet. Nothing can be bought or sold until someone offers. Place a limit order to start the book.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <div className="label grid grid-cols-[4rem_1fr_1fr] gap-2 border-b border-line bg-sunk/60 px-3 py-1.5">
            <span>Price</span>
            <span className="text-right">Shares</span>
            <span className="text-right">MUSD</span>
          </div>
          <ol aria-label="Asks (offers to sell), best last" className="flex flex-col-reverse">
            {asks.length ? asks.map((l) => <Row key={`a${l.yes}`} l={l} kind="ask" />) : <li className="px-3 py-2 text-sm text-muted">No one is selling {view === "yes" ? "Yes" : "No"}.</li>}
          </ol>
          <div className="mono flex items-center justify-between border-y border-line bg-sunk/60 px-3 py-1.5 text-xs text-ink-2">
            <span>Spread {bestBid != null && bestAsk != null ? `${bestAsk - bestBid}¢` : "—"}</span>
            <span title="Midpoint of best bid and ask. Indicative only, not a trade.">
              Mid {bestBid != null && bestAsk != null ? `~${(bestBid + bestAsk) / 2}¢` : "—"}
            </span>
            <span>Last trade {b.lastPrice != null ? `${view === "yes" ? b.lastPrice : 100 - b.lastPrice}¢` : "none"}</span>
          </div>
          <ol aria-label="Bids (offers to buy), best first">
            {bids.length ? bids.map((l) => <Row key={`b${l.yes}`} l={l} kind="bid" />) : <li className="px-3 py-2 text-sm text-muted">No one is buying {view === "yes" ? "Yes" : "No"}.</li>}
          </ol>
        </div>
      )}
    </div>
  );
}
