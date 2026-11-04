import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import {
  checkAddColl,
  checkClose,
  checkDraw,
  checkOpen,
  checkRepay,
  checkWithdrawColl,
  closeCost,
  collForDebt,
  liquidationPrice,
  maxDebtAtRatio,
  maxRepay,
  maxWithdrawAtRatio,
  minReceivable,
  nicrOf,
  SUGGESTED_RATIO,
  type BorrowParams,
  type Trove,
} from "@/lib/mezo/borrow";

// Values read from Mezo testnet on 2026-10-22, with the price fixed at $82,000.
const p: BorrowParams = {
  block: 1n,
  price: parseEther("82000"),
  recoveryMode: false,
  minNetDebt: parseEther("1800"),
  borrowingRate: 10n ** 15n,
  gasCompensation: parseEther("200"),
  mcr: parseEther("1.1"),
  ccr: parseEther("1.5"),
  interestBps: 100,
  // A healthy system: 1,000 BTC against 20M MUSD (410%).
  systemColl: parseEther("1000"),
  systemDebt: parseEther("20000000"),
};

describe("Mezo borrow math", () => {
  it("matches what openTrove produced on a testnet fork", () => {
    const coll = parseEther("0.06");
    const debt = maxDebtAtRatio(coll, SUGGESTED_RATIO, p);
    expect(debt).toBe(2257742257742257742257n); // MUSD received on the fork
    const c = checkOpen(coll, debt, p);
    expect(c.ok && c.total).toBe(2459999999999999999999n); // trove debt on the fork
    expect(c.ok && c.ratio).toBe(2000000000000000000n);
  });

  it("rejects what the contract rejects", () => {
    expect(checkOpen(parseEther("0.02"), parseEther("1800"), p).ok).toBe(false); // ICR < MCR
    expect(checkOpen(parseEther("1"), parseEther("1700"), p).ok).toBe(false); // under minimum net debt
    expect(checkOpen(parseEther("1"), minReceivable(p), p).ok).toBe(true);
    expect(checkOpen(parseEther("1"), minReceivable(p) - 1n, p).ok).toBe(false);
  });

  it("needs 150% in recovery mode and charges no fee", () => {
    const r = { ...p, recoveryMode: true };
    const coll = collForDebt(parseEther("1800"), parseEther("1.4"), r);
    expect(checkOpen(coll, parseEther("1800"), r).ok).toBe(false);
    const ok = checkOpen(collForDebt(parseEther("1800"), parseEther("1.5"), r), parseEther("1800"), r);
    expect(ok.ok && ok.fee).toBe(0n);
  });

  it("liquidation price is where the ratio hits 110%", () => {
    const coll = parseEther("0.06");
    const total = parseEther("2460");
    const lp = liquidationPrice(coll, total, p.mcr);
    expect((coll * lp) / total).toBeGreaterThanOrEqual(p.mcr);
    expect((coll * (lp - 10n ** 6n)) / total).toBeLessThan(p.mcr);
    expect(nicrOf(coll, total)).toBe((coll * 10n ** 20n) / total);
  });

  it("caps extra borrowing at the limit set when the loan opened, and blocks it in recovery mode", () => {
    const trove = { active: true, coll: parseEther("0.06"), debt: parseEther("2460"), principal: parseEther("2460"), maxBorrowingCapacity: parseEther("4472.72") };
    expect(checkDraw(trove, parseEther("100"), p).ok).toBe(true);
    expect(checkDraw(trove, parseEther("2100"), p).ok).toBe(false);
    expect(checkDraw(trove, parseEther("100"), { ...p, recoveryMode: true }).ok).toBe(false);
  });
});

describe("managing an open loan", () => {
  // 0.1 BTC ($8,200) against 3,000 MUSD of debt: 273%.
  const trove: Trove = { active: true, coll: parseEther("0.1"), debt: parseEther("3000"), principal: parseEther("2990"), maxBorrowingCapacity: parseEther("7454") };

  it("repays down to Mezo's minimum net debt, and no further", () => {
    // debt 3000 − deposit 200 − minimum 1800 = 1000 repayable while the loan stays open.
    expect(maxRepay(trove, p)).toBe(parseEther("1000"));
    const ok = checkRepay(trove, parseEther("1000"), p, parseEther("5000"));
    expect(ok.ok && ok.debt).toBe(parseEther("2000"));
    const tooMuch = checkRepay(trove, parseEther("1000.01"), p, parseEther("5000"));
    expect(tooMuch.ok).toBe(false);
    expect(checkRepay(trove, parseEther("500"), p, parseEther("100")).ok).toBe(false); // wallet can't cover it
  });

  it("repaying raises the ratio and lowers the liquidation price", () => {
    const r = checkRepay(trove, parseEther("1000"), p, undefined);
    if (!r.ok) throw new Error(r.reason);
    expect(r.ratio).toBe((parseEther("0.1") * p.price) / parseEther("2000"));
    expect(r.liquidation).toBeLessThan(liquidationPrice(trove.coll, trove.debt, p.mcr));
  });

  it("adding BTC keeps a little back for network fees", () => {
    expect(checkAddColl(trove, parseEther("0.05"), p, parseEther("0.0505")).ok).toBe(false);
    const r = checkAddColl(trove, parseEther("0.05"), p, parseEther("0.06"));
    expect(r.ok && r.coll).toBe(parseEther("0.15"));
  });

  it("withdrawing keeps the loan at 110%, is blocked in recovery mode, and can't take everything", () => {
    // 3000 × 1.1 / 82000 = 0.040243… BTC must stay.
    expect(checkWithdrawColl(trove, parseEther("0.059"), p).ok).toBe(true);
    expect(checkWithdrawColl(trove, parseEther("0.06"), p).ok).toBe(false);
    expect(checkWithdrawColl(trove, parseEther("0.1"), p).ok).toBe(false);
    expect(checkWithdrawColl(trove, parseEther("0.01"), { ...p, recoveryMode: true }).ok).toBe(false);
    // "Keep 200%" leaves exactly enough for 200%.
    const safe = maxWithdrawAtRatio(trove, SUGGESTED_RATIO, p);
    const left = checkWithdrawColl(trove, safe, p);
    expect(left.ok && left.ratio >= SUGGESTED_RATIO).toBe(true);
  });

  it("withdrawing is blocked when it would pull the whole system under 150%", () => {
    const tight = { ...p, systemColl: parseEther("0.38"), systemDebt: parseEther("20000") }; // 155.8%
    expect(checkWithdrawColl(trove, parseEther("0.02"), tight).ok).toBe(false);
  });

  it("closing needs the debt minus the deposit, and not in recovery mode", () => {
    expect(closeCost(trove, p)).toBe(parseEther("2800"));
    expect(checkClose(trove, p, parseEther("2799")).ok).toBe(false);
    expect(checkClose(trove, p, parseEther("2800")).ok).toBe(true);
    expect(checkClose(trove, { ...p, recoveryMode: true }, parseEther("9999")).ok).toBe(false);
  });
});
