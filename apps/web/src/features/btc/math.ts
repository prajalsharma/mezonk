/**
 * Pure bigint helpers for MezonkBtcRounds. Mirrors the contract's integer math exactly (same formulas, same
 * rounding) so what the UI shows is what the chain would do. No floats, no wall clock: callers pass chain time.
 */

export const WAD = 10n ** 18n;
export const BPS = 10_000n;

/** Contract enums. */
export const SIDE = { Up: 0, Down: 1 } as const;
export type Side = (typeof SIDE)[keyof typeof SIDE];
export const RESULT = { Pending: 0, Up: 1, Down: 2, Void: 3 } as const;
export type Result = (typeof RESULT)[keyof typeof RESULT];

export interface RoundState {
  upPool: bigint;
  downPool: bigint;
  lockPrice: bigint;
  closePrice: bigint;
  locked: boolean;
  settled: boolean;
  fee: bigint;
}

export interface BetState {
  amount: bigint;
  usd: bigint;
  side: number;
  claimed: boolean;
}

export interface Schedule {
  genesis: bigint;
  interval: bigint;
  captureWindow: bigint;
}

// ───────────────────────────── Round timing ─────────────────────────────

/** The round open for bets at chain time `now` (the contract's `currentRound()`). */
export function roundAt(now: bigint, s: Schedule): bigint {
  if (now < s.genesis) return 0n;
  return (now - s.genesis) / s.interval;
}

export const betStart = (round: bigint, s: Schedule) => s.genesis + round * s.interval;
export const lockTime = (round: bigint, s: Schedule) => s.genesis + (round + 1n) * s.interval;
export const closeTime = (round: bigint, s: Schedule) => s.genesis + (round + 2n) * s.interval;

/** Seconds from chain time `now` until `target`, never negative. */
export const secondsUntil = (target: bigint, now: bigint) => (target > now ? target - now : 0n);

/**
 * The round a keeper should `roll` at chain time `now`, or null when no capture window is open. `roll(r)` is
 * valid from `lockTime(r)` for `captureWindow` seconds, and `lockTime(r) <= now` means `r = currentRound - 1`.
 */
export function rollableRound(now: bigint, s: Schedule): bigint | null {
  if (now < s.genesis + s.interval) return null;
  const r = roundAt(now, s) - 1n;
  return now > lockTime(r, s) + s.captureWindow ? null : r;
}

/** "mm:ss" under an hour, "h:mm:ss" above. For a countdown that ticks every second. */
export function formatCountdown(secs: bigint): string {
  const t = secs < 0n ? 0n : secs;
  const h = t / 3600n;
  const m = (t % 3600n) / 60n;
  const s = t % 60n;
  const two = (x: bigint) => x.toString().padStart(2, "0");
  return h > 0n ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// ───────────────────────────── Stakes ─────────────────────────────

/** BTC (18 decimals) that `usd` (18 decimals) buys at `price` (USD per BTC, 18 decimals): the contract's `btcForUsd`. */
export const btcForUsd = (usd: bigint, price: bigint) => (usd * WAD) / price;

/** What `amount` BTC is worth at `price`, as the contract's `bet` computes it. */
export const usdOf = (amount: bigint, price: bigint) => (amount * price) / WAD;

/**
 * The BTC to send so a stake is worth `usd` at `price`. `btcForUsd` rounds down, which can land a hair under a
 * chip that sits exactly on `minStakeUsd` and revert with StakeOutsideRange; so round up, unless that would push a
 * chip sitting on `maxStakeUsd` over the top.
 */
export function stakeFor(usd: bigint, price: bigint, minUsd: bigint, maxUsd: bigint): bigint {
  const floor = btcForUsd(usd, price);
  const ceil = (usd * WAD + price - 1n) / price;
  if (usdOf(ceil, price) > maxUsd) return floor;
  if (usdOf(floor, price) < minUsd) return ceil;
  return floor === ceil ? floor : ceil;
}

/** Which stake chips the contract's limits allow right now. */
export const chipsInRange = (chips: readonly bigint[], minUsd: bigint, maxUsd: bigint) =>
  chips.map((usd) => ({ usd, ok: usd >= minUsd && usd <= maxUsd }));

// ───────────────────────────── Payouts ─────────────────────────────

/**
 * What a new `stake` on `side` would collect if that side wins, given the pools as they stand now. The stake is
 * added to its side first, so the estimate includes its own dilution. `oneSided` means nobody is on the other
 * side yet: if it stays that way the round is void and the stake is refunded.
 */
export function estimatePayout(
  stake: bigint,
  side: Side,
  upPool: bigint,
  downPool: bigint,
  feeBps: bigint,
): { payout: bigint; oneSided: boolean } {
  const winners = (side === SIDE.Up ? upPool : downPool) + stake;
  const losers = side === SIDE.Up ? downPool : upPool;
  if (stake === 0n) return { payout: 0n, oneSided: losers === 0n };
  if (losers === 0n) return { payout: stake, oneSided: true };
  const pool = winners + losers;
  const fee = (pool * feeBps) / BPS;
  return { payout: (stake * (pool - fee)) / winners, oneSided: false };
}

/** Payout per BTC staked, in hundredths (184 → "1.84×"). Rounded down so it never flatters. */
export const multipleX100 = (payout: bigint, stake: bigint) => (stake === 0n ? 0n : (payout * 100n) / stake);

/** The contract's `_result` for a settled round. */
export function settledResult(r: RoundState): Result {
  if (r.closePrice === r.lockPrice) return RESULT.Void;
  const won = r.closePrice > r.lockPrice ? RESULT.Up : RESULT.Down;
  const winners = won === RESULT.Up ? r.upPool : r.downPool;
  const losers = won === RESULT.Up ? r.downPool : r.upPool;
  return winners === 0n || losers === 0n ? RESULT.Void : won;
}

/** The contract's `result(round)` view at chain time `now`. */
export function roundResult(round: bigint, r: RoundState, now: bigint, s: Schedule): Result {
  if (r.settled) return settledResult(r);
  if (!r.locked) return now > lockTime(round, s) + s.captureWindow ? RESULT.Void : RESULT.Pending;
  return now > closeTime(round, s) + s.captureWindow ? RESULT.Void : RESULT.Pending;
}

/** What a bet pays for a decided round (the contract's `_payout`, ignoring whether it was claimed already). */
export function payoutOf(r: RoundState, b: BetState, res: Result): bigint {
  if (b.amount === 0n || res === RESULT.Pending) return 0n;
  if (res === RESULT.Void) return b.amount;
  if ((res === RESULT.Up) !== (b.side === SIDE.Up)) return 0n;
  const pool = r.upPool + r.downPool - r.fee;
  const winners = res === RESULT.Up ? r.upPool : r.downPool;
  return winners === 0n ? 0n : (b.amount * pool) / winners;
}

/** Up's share of the pool in basis points (0 when empty), for a split bar. */
export function upShareBps(upPool: bigint, downPool: bigint): bigint {
  const total = upPool + downPool;
  return total === 0n ? 0n : (upPool * BPS) / total;
}
