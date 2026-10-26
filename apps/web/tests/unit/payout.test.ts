import { describe, expect, it } from "vitest";
import { formatMultiple, winAtBest, winFromBook } from "@/lib/market/payout";

const M = (n: number) => BigInt(n) * 10n ** 18n;

describe("payout", () => {
  it("10 MUSD at 15¢ with a 1% fee buys 66 whole shares and pays 66 MUSD", () => {
    const w = winAtBest(M(10), 15, 100)!;
    expect(w.payout).toBe(M(66));
    expect(w.spent).toBe(9_999n * 10n ** 15n); // 6,600 lots × 0.1515 = 9.999 MUSD
    expect(formatMultiple(w.multipleX100)).toBe("6.6×");
    expect(w.limited).toBe(false);
  });

  it("walks the book best-first and flags when offers run out", () => {
    const w = winFromBook(M(100), [{ price: 16, shares: M(50) }, { price: 15, shares: M(100) }], 100)!;
    // 100 shares at 15¢ (15.15 MUSD), then all 50 at 16¢ (8.08 MUSD): the book is exhausted.
    expect(w.payout).toBe(M(150));
    expect(w.spent).toBe(M(15.15 * 100) / 100n + M(808) / 100n); // 15.15 + 8.08 MUSD, not the 100 staked
    expect(w.limited).toBe(true);
  });

  it("never rounds the multiple up", () => {
    expect(formatMultiple(659n)).toBe("6.5×");
  });

  it("returns nothing without a price or offers", () => {
    expect(winAtBest(M(10), null, 100)).toBeNull();
    expect(winFromBook(M(10), [], 100)).toBeNull();
  });
});
