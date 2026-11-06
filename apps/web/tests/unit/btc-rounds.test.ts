import { describe, expect, it } from "vitest";
import {
  RESULT,
  SIDE,
  WAD,
  btcForUsd,
  chipsInRange,
  closeTime,
  estimatePayout,
  formatCountdown,
  lockTime,
  multipleX100,
  payoutOf,
  rollableRound,
  roundAt,
  roundResult,
  secondsUntil,
  settledResult,
  stakeFor,
  upShareBps,
  usdOf,
  type RoundState,
} from "@/features/btc/math";
import { formatBtc, formatUsd } from "@/lib/format";

const USD = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;
const BTC = (sats: number) => BigInt(sats) * 10n ** 10n;
const PRICE = USD(80_123.45);
const s = { genesis: 1_000_000n, interval: 3600n, captureWindow: 300n };
const round = (o: Partial<RoundState> = {}): RoundState => ({ upPool: 0n, downPool: 0n, lockPrice: 0n, closePrice: 0n, locked: false, settled: false, fee: 0n, ...o });

describe("round timing (chain time only)", () => {
  it("numbers rounds from genesis like the contract", () => {
    expect(roundAt(999_999n, s)).toBe(0n);
    expect(roundAt(1_000_000n, s)).toBe(0n);
    expect(roundAt(1_003_599n, s)).toBe(0n);
    expect(roundAt(1_003_600n, s)).toBe(1n);
    expect(lockTime(0n, s)).toBe(1_003_600n);
    expect(closeTime(0n, s)).toBe(1_007_200n);
    expect(lockTime(1n, s)).toBe(closeTime(0n, s)); // round 1's betting window is round 0's price window
  });

  it("counts down to lock and never goes negative", () => {
    expect(secondsUntil(lockTime(0n, s), 1_003_000n)).toBe(600n);
    expect(secondsUntil(lockTime(0n, s), 1_003_700n)).toBe(0n);
    expect(formatCountdown(600n)).toBe("10:00");
    expect(formatCountdown(5n)).toBe("0:05");
    expect(formatCountdown(3725n)).toBe("1:02:05");
    expect(formatCountdown(-3n)).toBe("0:00");
  });

  it("tells a keeper which round to roll, only inside the capture window", () => {
    expect(rollableRound(1_003_599n, s)).toBeNull(); // before the first boundary
    expect(rollableRound(1_003_600n, s)).toBe(0n); // exactly at lockTime(0)
    expect(rollableRound(1_003_900n, s)).toBe(0n); // last second of the window
    expect(rollableRound(1_003_901n, s)).toBeNull(); // window closed
    expect(rollableRound(1_007_200n, s)).toBe(1n); // next boundary: roll(1) settles round 0
  });

  it("mirrors result() for rounds whose capture was missed", () => {
    const r = round();
    expect(roundResult(0n, r, 1_003_800n, s)).toBe(RESULT.Pending);
    expect(roundResult(0n, r, 1_003_901n, s)).toBe(RESULT.Void);
    const locked = round({ locked: true, lockPrice: PRICE, upPool: 1n, downPool: 1n });
    expect(roundResult(0n, locked, 1_007_400n, s)).toBe(RESULT.Pending);
    expect(roundResult(0n, locked, 1_007_501n, s)).toBe(RESULT.Void);
  });
});

describe("stakes", () => {
  it("sizes a chip exactly like btcForUsd", () => {
    expect(btcForUsd(USD(10), PRICE)).toBe((USD(10) * WAD) / PRICE);
    expect(usdOf(btcForUsd(USD(10), PRICE), PRICE) <= USD(10)).toBe(true);
  });

  it("rounds the stake up so a chip on the minimum never lands under it", () => {
    const v = stakeFor(USD(10), PRICE, USD(10), USD(100));
    expect(usdOf(v, PRICE) >= USD(10)).toBe(true);
    // and never pushes a chip on the maximum over it
    const top = stakeFor(USD(100), PRICE, USD(10), USD(100));
    expect(usdOf(top, PRICE) <= USD(100)).toBe(true);
    // a round price needs no adjustment
    expect(stakeFor(USD(10), USD(50_000), USD(10), USD(100))).toBe(btcForUsd(USD(10), USD(50_000)));
  });

  it("disables chips outside the contract's range", () => {
    const chips = chipsInRange([USD(10), USD(25), USD(50), USD(100)], USD(20), USD(50));
    expect(chips.map((c) => c.ok)).toEqual([false, true, true, false]);
  });
});

describe("payouts", () => {
  it("estimates a win from the pools after adding the stake, less the fee", () => {
    // 0.001 BTC on Up into Up 0.002 / Down 0.003 with a 3% fee: pool 0.006, fee 0.00018, winners 0.003.
    const e = estimatePayout(BTC(100_000), SIDE.Up, BTC(200_000), BTC(300_000), 300n);
    expect(e.oneSided).toBe(false);
    expect(e.payout).toBe((BTC(100_000) * (BTC(600_000) - BTC(18_000))) / BTC(300_000)); // 0.00194 BTC
    expect(multipleX100(e.payout, BTC(100_000))).toBe(194n);
  });

  it("is a refund when nobody is on the other side", () => {
    const e = estimatePayout(BTC(100_000), SIDE.Down, 0n, BTC(50_000), 300n);
    expect(e).toEqual({ payout: BTC(100_000), oneSided: true });
    expect(estimatePayout(0n, SIDE.Up, 0n, 0n, 300n).payout).toBe(0n);
  });

  it("decides a settled round like _result", () => {
    expect(settledResult(round({ lockPrice: 10n, closePrice: 11n, upPool: 1n, downPool: 1n }))).toBe(RESULT.Up);
    expect(settledResult(round({ lockPrice: 10n, closePrice: 9n, upPool: 1n, downPool: 1n }))).toBe(RESULT.Down);
    expect(settledResult(round({ lockPrice: 10n, closePrice: 10n, upPool: 1n, downPool: 1n }))).toBe(RESULT.Void);
    expect(settledResult(round({ lockPrice: 10n, closePrice: 11n, upPool: 0n, downPool: 1n }))).toBe(RESULT.Void);
    expect(settledResult(round({ lockPrice: 10n, closePrice: 11n, upPool: 1n, downPool: 0n }))).toBe(RESULT.Void);
  });

  it("pays winners pro-rata from the pool less the fee, refunds void rounds, nothing to losers", () => {
    const r = round({ upPool: BTC(300_000), downPool: BTC(300_000), lockPrice: 10n, closePrice: 11n, locked: true, settled: true, fee: BTC(18_000) });
    const up = { amount: BTC(100_000), usd: USD(80), side: SIDE.Up, claimed: false };
    const down = { amount: BTC(100_000), usd: USD(80), side: SIDE.Down, claimed: false };
    expect(payoutOf(r, up, RESULT.Up)).toBe((BTC(100_000) * BTC(582_000)) / BTC(300_000));
    expect(payoutOf(r, down, RESULT.Up)).toBe(0n);
    expect(payoutOf(r, down, RESULT.Void)).toBe(BTC(100_000));
    expect(payoutOf(r, down, RESULT.Pending)).toBe(0n);
    expect(payoutOf(r, { ...up, amount: 0n }, RESULT.Up)).toBe(0n);
  });

  it("splits the bar by stake", () => {
    expect(upShareBps(0n, 0n)).toBe(0n);
    expect(upShareBps(1n, 3n)).toBe(2500n);
  });
});

describe("formatting", () => {
  it("shows BTC to the satoshi, trimmed, never rounded up", () => {
    expect(formatBtc(BTC(12_345))).toBe("0.00012345");
    expect(formatBtc(BTC(100_000))).toBe("0.001");
    expect(formatBtc(WAD)).toBe("1");
    expect(formatBtc(1234n * WAD + BTC(50_000_000))).toBe("1,234.5");
    expect(formatBtc(BTC(12_345) + 9_999_999_999n)).toBe("0.00012345"); // sub-satoshi dust is dropped
    expect(formatBtc(1n)).toBe("< 0.00000001");
    expect(formatBtc(0n)).toBe("0");
    expect(formatBtc(null)).toBe("—");
  });

  it("shows USD and prices with two decimals", () => {
    expect(formatUsd(PRICE)).toBe("$80,123.45");
    expect(formatUsd(USD(10))).toBe("$10.00");
    expect(formatUsd(USD(0.05))).toBe("$0.05");
    expect(formatUsd(9_999_999_999_999_999n)).toBe("$0.00"); // under a cent rounds down
  });
});
