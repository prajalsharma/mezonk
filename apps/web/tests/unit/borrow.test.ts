import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { checkDraw, checkOpen, collForDebt, liquidationPrice, maxDebtAtRatio, minReceivable, nicrOf, SUGGESTED_RATIO, type BorrowParams } from "@/lib/mezo/borrow";

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
