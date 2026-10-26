"use client";

import Link from "next/link";
import { useState } from "react";
import { cx } from "@/components/ui/cx";
import { useBook } from "@/features/trading/api";
import { type MarketSummaryDto, marketHref } from "@/lib/api/types";
import { formatCents, formatMusd } from "@/lib/format";
import { formatMultiple, winFromBook, type Win } from "@/lib/market/payout";

const STAKES = [10, 50, 100] as const;
const wei = (musd: number) => BigInt(musd) * 10n ** 18n;
/** Whole MUSD, rounded up, for prefilling the ticket with what the shares on offer cost. */
const wholeMusdUp = (w: bigint) => Number((w + 10n ** 18n - 1n) / 10n ** 18n);

/**
 * Pick a stake, see what each side pays if it wins. Walks the live order book (fee included), so the number is
 * what the ticket will quote for the same amount right now. Tapping a side opens the ticket with side and stake set.
 */
export function WinPicker({ m }: { m: MarketSummaryDto }) {
  const [stake, setStake] = useState<(typeof STAKES)[number]>(10);
  const book = useBook(m.id);
  const yesOffers = book.data?.asks.map((l) => ({ price: l.yes, shares: BigInt(l.shares) })) ?? [];
  const noOffers = book.data?.bids.map((l) => ({ price: 100 - l.yes, shares: BigInt(l.shares) })) ?? [];
  const yesWin = winFromBook(wei(stake), yesOffers, m.feeBps);
  const noWin = winFromBook(wei(stake), noOffers, m.feeBps);
  const fee = m.feeBps / 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink-2">If you put in</p>
        <div role="radiogroup" aria-label="Stake" className="flex gap-1 rounded-md bg-sunk p-1">
          {STAKES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stake === s}
              onClick={() => setStake(s)}
              className={cx(
                "press mono h-8 rounded-sm px-3 text-sm font-semibold transition-colors",
                stake === s ? "bg-surface text-ink shadow-1" : "text-ink-2 hover:text-ink",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Side m={m} side="yes" stake={stake} cents={m.bestAsk} win={yesWin} loading={book.isLoading} />
        <Side m={m} side="no" stake={stake} cents={m.bestBid == null ? null : 100 - m.bestBid} win={noWin} loading={book.isLoading} />
      </div>

      <p className="text-xs text-muted">
        MUSD, at today&apos;s prices with the {fee}% fee included. A winning share pays 1 MUSD; a losing one pays nothing.
        {(yesWin?.limited || noWin?.limited) && " Where fewer shares are on offer than your stake buys, you'd only spend what's shown and keep the rest."}
      </p>
    </div>
  );
}

function Side({ m, side, stake, cents, win, loading }: { m: MarketSummaryDto; side: "yes" | "no"; stake: number; cents: number | null; win: Win | null; loading: boolean }) {
  const yes = side === "yes";
  const label = yes ? "Yes" : "No";
  return (
    <Link
      href={marketHref(m, side, win ? (win.limited ? wholeMusdUp(win.spent) : stake) : undefined)}
      aria-label={win ? `${label}: put in ${stake} MUSD, get ${formatMusd(win.payout)} MUSD if ${label} wins` : `${label}: no offers right now`}
      className={cx(
        "press flex flex-col gap-2 rounded-md p-3.5 transition-[background-color,opacity]",
        yes ? "bg-yes text-on-yes hover:bg-accent-hover" : "bg-no text-on-no hover:opacity-90",
      )}
    >
      <span className="flex items-baseline justify-between font-semibold">
        <span>{label}</span>
        <span className="mono text-sm opacity-80">{cents != null ? formatCents(cents) : "—"}</span>
      </span>
      {win ? (
        <span className="space-y-0.5">
          <span className="block text-xs opacity-80">{win.limited ? `only ${formatMusd(win.payout)} shares on offer · you get` : "you get"}</span>
          <span className="mono block text-2xl font-semibold leading-none tracking-tight">{formatMusd(win.payout)}</span>
          <span className="mono block text-xs opacity-80">
            {win.limited ? `for ${formatMusd(win.spent)} · ` : ""}+{formatMusd(win.payout - win.spent)} profit
            {win.multipleX100 >= 200n ? ` · ${formatMultiple(win.multipleX100)}` : ""}
          </span>
        </span>
      ) : (
        <span className="text-sm opacity-80">{loading ? "Reading the book…" : "No offers right now"}</span>
      )}
    </Link>
  );
}
