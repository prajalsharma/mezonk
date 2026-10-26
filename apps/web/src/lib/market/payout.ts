import { cost, feeOf, LOT, sharesForBudget } from "@/lib/orderbook/math";

/**
 * What a stake turns into if the side wins. Every winning share pays exactly 1 MUSD, so the payout is the
 * number of whole lots the stake buys, fee included. Exact bigint; prices are whole cents.
 */
export interface Win {
  /** MUSD paid out if this side wins (18 decimals). */
  payout: bigint;
  /** MUSD actually spent, fee included. Less than the stake when the book runs out first. */
  spent: bigint;
  /** Payout per MUSD spent, ×100 (e.g. 652 = 6.52×). */
  multipleX100: bigint;
  /** The book ran out before the stake was spent: the payout is for the shares actually on offer. */
  limited: boolean;
}

/** Cost of buying `qty` best-first through `offers`, fee included (same per-lot rounding as sharesForBudget). */
function spendFor(qty: bigint, offers: Array<{ price: number; shares: bigint }>, feeBps: number): bigint {
  let left = qty / LOT;
  let spent = 0n;
  for (const l of [...offers].sort((x, y) => x.price - y.price)) {
    if (left <= 0n) break;
    const lots = l.shares / LOT < left ? l.shares / LOT : left;
    const perLot = cost(LOT, l.price);
    spent += lots * (perLot + feeOf(perLot, feeBps));
    left -= lots;
  }
  return spent;
}

function toWin(qty: bigint, spent: bigint, limited: boolean): Win {
  const payout = qty; // one share (1e18) pays one MUSD (1e18)
  return { payout, spent, multipleX100: spent > 0n ? (payout * 100n) / spent : 0n, limited };
}

/** Walks real offers best-first (prices in the buyer's cents). Use this when the book is loaded. */
export function winFromBook(stake: bigint, offers: Array<{ price: number; shares: bigint }>, feeBps: number): Win | null {
  if (stake <= 0n || offers.length === 0) return null;
  const r = sharesForBudget(offers, stake, feeBps);
  return r.qty < LOT ? null : toWin(r.qty, spendFor(r.qty, offers, feeBps), r.exhausted);
}

/** At the best price only (for cards, which don't load the book). Large stakes may move the price. */
export function winAtBest(stake: bigint, cents: number | null, feeBps: number): Win | null {
  if (cents == null || cents < 1 || cents > 99) return null;
  return winFromBook(stake, [{ price: cents, shares: stake * 1000n }], feeBps);
}

/** "6.5×" from multipleX100, one decimal, rounded down so it never overstates. */
export function formatMultiple(m: bigint): string {
  const tenths = m / 10n;
  return `${tenths / 10n}.${tenths % 10n}×`;
}
