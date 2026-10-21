/**
 * Order-book arithmetic shared by the browser, the API and the indexer. Mirrors MezonkExchange exactly:
 * prices are whole cents (1..99), quantities are 18-decimal shares in multiples of LOT (0.01 share), so
 * every cost and fee is an exact bigint. No floating point is used for money anywhere in this file.
 */
import type { Address, Hex } from "viem";

export const ONE = 10n ** 18n;
export const LOT = 10n ** 16n;
export const YES = 0;
export const NO = 1;
export const BUY = 0;
export const SELL = 1;
export type OutcomeIdx = 0 | 1;
export type SideIdx = 0 | 1;

/** Collateral for `q` shares at `cents` per share. Exact for q % LOT == 0. */
export const cost = (q: bigint, cents: number) => (q * BigInt(cents)) / 100n;
/** Taker fee, exact (cost is a multiple of 1e14). */
export const feeOf = (notional: bigint, feeBps: number) => (notional * BigInt(feeBps)) / 10_000n;

/** YES price in cents implied by an order on `outcome` at `price`. */
export const yesPriceOf = (outcome: number, price: number) => (outcome === YES ? price : 100 - price);

/** Where an order sits in the YES book. Bids want YES (buy YES / sell NO); asks offer YES (sell YES / buy NO). */
export function bookPosition(outcome: number, side: number, price: number): { book: "bid" | "ask"; yes: number } {
  const bid = (outcome === YES) === (side === BUY);
  return { book: bid ? "bid" : "ask", yes: yesPriceOf(outcome, price) };
}

/**
 * Whether a taker wanting (outcome, side) can trade against a maker order, and at what price for the taker.
 * Direct: same outcome, opposite side. Complement: other outcome, same side (mints or merges a set).
 */
export function takerTerms(
  maker: { outcome: number; side: number; price: number },
  taker: { outcome: number; side: number },
): { ok: boolean; complement: boolean; price: number } {
  if (maker.outcome === taker.outcome && maker.side !== taker.side) return { ok: true, complement: false, price: maker.price };
  if (maker.outcome !== taker.outcome && maker.side === taker.side) {
    return { ok: true, complement: true, price: 100 - maker.price };
  }
  return { ok: false, complement: false, price: 0 };
}

/** A piece of maker liquidity: a signed order (by hash) or an escrowed resting order (by id). */
export interface Liquidity {
  kind: "signed" | "resting";
  ref: string; // order hash or resting id
  maker: string;
  outcome: number;
  side: number;
  price: number;
  /** Shares still fillable and (for signed orders) currently funded. */
  available: bigint;
}

export interface QuoteStep {
  liquidity: Liquidity;
  quantity: bigint;
  takerPrice: number;
  complement: boolean;
}

export interface Quote {
  requested: bigint;
  filled: bigint;
  unfilled: bigint;
  notional: bigint; // collateral the taker pays (buy) or receives before fee (sell)
  fee: bigint;
  /** Taker-outcome price in cents, best and worst level touched. */
  bestPrice: number | null;
  worstPrice: number | null;
  steps: QuoteStep[];
}

/**
 * Walks the given liquidity best-first for a taker and returns exactly what the contract would fill,
 * never past `limit` (cents, for the taker's outcome). Own orders are excluded (the contract rejects self-trades).
 */
export function quote(
  liquidity: Liquidity[],
  t: { outcome: number; side: number; quantity: bigint; limit: number; feeBps: number; taker?: string },
): Quote {
  const me = t.taker?.toLowerCase();
  const candidates = liquidity
    .filter((l) => l.available > 0n && (!me || l.maker.toLowerCase() !== me))
    .map((l) => ({ l, terms: takerTerms(l, t) }))
    .filter((c) => c.terms.ok && (t.side === BUY ? c.terms.price <= t.limit : c.terms.price >= t.limit))
    // Best first for the taker; escrowed before signed at the same price (cannot go stale).
    .sort((a, b) =>
      a.terms.price !== b.terms.price
        ? t.side === BUY
          ? a.terms.price - b.terms.price
          : b.terms.price - a.terms.price
        : (a.l.kind === "resting" ? 0 : 1) - (b.l.kind === "resting" ? 0 : 1),
    );
  let left = t.quantity;
  let notional = 0n;
  const steps: QuoteStep[] = [];
  for (const c of candidates) {
    if (left === 0n) break;
    const q = c.l.available < left ? c.l.available : left;
    steps.push({ liquidity: c.l, quantity: q, takerPrice: c.terms.price, complement: c.terms.complement });
    notional += cost(q, c.terms.price);
    left -= q;
  }
  const filled = t.quantity - left;
  return {
    requested: t.quantity,
    filled,
    unfilled: left,
    notional,
    fee: feeOf(notional, t.feeBps),
    bestPrice: steps[0]?.takerPrice ?? null,
    worstPrice: steps.at(-1)?.takerPrice ?? null,
    steps,
  };
}

export interface BookLevel {
  yes: number; // YES price in cents
  shares: bigint;
  resting: bigint; // escrowed part (guaranteed funded)
  orders: number;
}

/** Aggregates liquidity into YES-price levels: bids high → low, asks low → high. */
export function aggregateBook(liquidity: Liquidity[]): { bids: BookLevel[]; asks: BookLevel[] } {
  const bids = new Map<number, BookLevel>();
  const asks = new Map<number, BookLevel>();
  for (const l of liquidity) {
    if (l.available <= 0n) continue;
    const pos = bookPosition(l.outcome, l.side, l.price);
    const m = pos.book === "bid" ? bids : asks;
    const lvl = m.get(pos.yes) ?? { yes: pos.yes, shares: 0n, resting: 0n, orders: 0 };
    lvl.shares += l.available;
    if (l.kind === "resting") lvl.resting += l.available;
    lvl.orders += 1;
    m.set(pos.yes, lvl);
  }
  return {
    bids: [...bids.values()].sort((a, b) => b.yes - a.yes),
    asks: [...asks.values()].sort((a, b) => a.yes - b.yes),
  };
}

/** Parse a user-entered share amount ("12.5") into lot-aligned bigint shares. Returns null if invalid. */
export function parseShares(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const v = BigInt(whole!) * ONE + BigInt((frac + "00").slice(0, 2)) * LOT;
  return v > 0n ? v : null;
}

/** Shares as a short decimal string (max 2 decimals, trailing zeros trimmed). */
export function formatShares(q: bigint): string {
  const neg = q < 0n;
  const v = neg ? -q : q;
  const whole = v / ONE;
  const cents = (v % ONE) / LOT;
  const frac = cents === 0n ? "" : `.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac}`;
}

// ───────────────────────────── EIP-712 ─────────────────────────────

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "outcome", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "price", type: "uint8" },
    { name: "quantity", type: "uint128" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "uint256" },
  ],
} as const;

export const exchangeDomain = (chainId: number, exchange: Address) =>
  ({ name: "MEZONK Exchange", version: "1", chainId, verifyingContract: exchange }) as const;

export interface SignedOrder {
  maker: Address;
  taker: Address;
  marketId: bigint;
  outcome: number;
  side: number;
  price: number;
  quantity: bigint;
  expiry: bigint;
  nonce: bigint;
  salt: bigint;
}

export interface OrderWithSig extends SignedOrder {
  signature: Hex;
}
