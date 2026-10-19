import { describe, expect, it } from "vitest";
import { buyShares, quoteBuy, quoteSell, sellShares, withSlippage } from "@/lib/market/math";

const E = 10n ** 18n;

describe("FPMM math mirror", () => {
  it("buy keeps k and conserves sets", () => {
    const y = 100n * E, n = 100n * E, x = 9_900_000_000_000_000_000n;
    const r = buyShares(y, n, x);
    expect(r.newPoolOut * r.newPoolOther >= y * n).toBe(true);
    expect(r.sharesOut + r.newPoolOut).toBe(y + x);
  });

  it("sell keeps k and is the inverse direction", () => {
    const r = sellShares(80n * E, 125n * E, 10n * E);
    expect(r.newPoolIn * r.newPoolOther >= 80n * E * 125n * E).toBe(true);
    expect(r.grossOut).toBeLessThan(10n * E);
  });

  it("round trip never profits", () => {
    for (const amt of [1n, 10n, 500n, 5000n]) {
      const pool = { yes: 300n * E, no: 700n * E };
      const b = quoteBuy(pool, "yes", amt * E, 100);
      const after = { yes: pool.yes + amt * E - b.fee - b.shares, no: pool.no + amt * E - b.fee };
      const s = quoteSell(after, "yes", b.shares, 100);
      expect(s.out).toBeLessThan(amt * E);
    }
  });

  it("quote reports impact, fee and payout", () => {
    const q = quoteBuy({ yes: 100n * E, no: 100n * E }, "yes", 10n * E, 100);
    expect(q.fee).toBe(E / 10n);
    expect(q.priceBefore).toBe(0.5);
    expect(q.priceAfterYes).toBeGreaterThan(0.5);
    expect(q.priceImpact).toBeGreaterThan(0);
    expect(q.payoutIfWin).toBe(q.shares);
    expect(q.profitIfWin).toBe(q.shares - 10n * E);
  });

  it("slippage floor", () => {
    expect(withSlippage(1000n, 100)).toBe(990n);
  });
});
