import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approvalTypes } from "@/lib/governance/approval";
import { policySchema } from "@/lib/orderbook/policy";
import {
  aggregateBook,
  BUY,
  cost,
  feeOf,
  formatShares,
  LOT,
  NO,
  ONE,
  parseShares,
  quote,
  SELL,
  takerTerms,
  ORDER_TYPES,
  YES,
  type Liquidity,
} from "@/lib/orderbook/math";

const E = ONE;
const liq = (o: Partial<Liquidity> & Pick<Liquidity, "outcome" | "side" | "price" | "available">): Liquidity => ({
  kind: "signed",
  ref: Math.random().toString(16),
  maker: "0xm",
  ...o,
});

describe("order-book math", () => {
  it("costs and fees are exact at lot granularity", () => {
    expect(cost(LOT, 1)).toBe(10n ** 14n);
    expect(cost(3n * E + 7n * LOT, 37)).toBe((307n * LOT * 37n) / 100n);
    expect(cost(E, 37) + cost(E, 63)).toBe(E); // complementary prices fund exactly one set
    expect(feeOf(cost(E, 55), 100)).toBe(55n * 10n ** 14n);
  });

  it("maps complementary orders", () => {
    expect(takerTerms({ outcome: NO, side: BUY, price: 40 }, { outcome: YES, side: BUY })).toEqual({ ok: true, complement: true, price: 60 });
    expect(takerTerms({ outcome: YES, side: SELL, price: 60 }, { outcome: YES, side: BUY })).toEqual({ ok: true, complement: false, price: 60 });
    expect(takerTerms({ outcome: YES, side: BUY, price: 60 }, { outcome: YES, side: BUY }).ok).toBe(false);
  });

  it("all-YES demand fills only real, funded depth within the limit", () => {
    // Asks: 100 YES @55 (a NO bid @45) and 100 YES @58. Everyone wants 1,000 YES at up to 60.
    const book = [
      liq({ outcome: NO, side: BUY, price: 45, available: 100n * E, kind: "resting" }),
      liq({ outcome: YES, side: SELL, price: 58, available: 100n * E }),
      liq({ outcome: YES, side: SELL, price: 61, available: 500n * E }), // above the limit
    ];
    const q = quote(book, { outcome: YES, side: BUY, quantity: 1000n * E, limit: 60, feeBps: 100 });
    expect(q.filled).toBe(200n * E);
    expect(q.unfilled).toBe(800n * E);
    expect(q.notional).toBe(55n * E + 58n * E);
    expect(q.fee).toBe((113n * E) / 100n);
    expect(q.bestPrice).toBe(55);
    expect(q.worstPrice).toBe(58);
    expect(quote(book, { outcome: YES, side: BUY, quantity: 10n * E, limit: 50, feeBps: 100 }).filled).toBe(0n);
  });

  it("excludes the taker's own orders and prefers escrowed liquidity at equal prices", () => {
    const book = [
      liq({ outcome: YES, side: SELL, price: 50, available: 5n * E, maker: "0xME" }),
      liq({ outcome: YES, side: SELL, price: 50, available: 5n * E, kind: "signed", ref: "s" }),
      liq({ outcome: NO, side: BUY, price: 50, available: 5n * E, kind: "resting", ref: "r" }),
    ];
    const q = quote(book, { outcome: YES, side: BUY, quantity: 6n * E, limit: 50, feeBps: 0, taker: "0xme" });
    expect(q.steps.map((s) => s.liquidity.ref)).toEqual(["r", "s"]);
    expect(q.filled).toBe(6n * E);
  });

  it("aggregates a YES book from both outcomes", () => {
    const b = aggregateBook([
      liq({ outcome: YES, side: BUY, price: 45, available: 10n * E, kind: "resting" }),
      liq({ outcome: NO, side: SELL, price: 55, available: 5n * E }), // also a YES bid @45
      liq({ outcome: NO, side: BUY, price: 45, available: 7n * E }), // YES ask @55
    ]);
    expect(b.bids).toEqual([{ yes: 45, shares: 15n * E, resting: 10n * E, orders: 2 }]);
    expect(b.asks[0]).toMatchObject({ yes: 55, shares: 7n * E, resting: 0n });
  });

  it("parses and formats share amounts without floats", () => {
    expect(parseShares("12.5")).toBe(12n * E + 50n * LOT);
    expect(parseShares("0.01")).toBe(LOT);
    expect(parseShares("0.001")).toBeNull();
    expect(parseShares("1e3")).toBeNull();
    expect(parseShares("0")).toBeNull();
    expect(formatShares(1234n * E + 5n * LOT)).toBe("1,234.05");
    expect(formatShares(2n * E + 50n * LOT)).toBe("2.5");
  });
});

describe("typed data matches the contracts", () => {
  const src = (f: string) => readFileSync(path.join(__dirname, "../../../../contracts/src", f), "utf8");
  const typeString = (name: string, fields: ReadonlyArray<{ name: string; type: string }>) => `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
  it("Order", () => {
    expect(src("MezonkExchange.sol")).toContain(`"${typeString("Order", ORDER_TYPES.Order)}"`);
  });
  it("MarketApproval", () => {
    expect(src("MezonkMarketFactory.sol")).toContain(`"${typeString("MarketApproval", approvalTypes.MarketApproval)}"`);
  });
});

describe("policy validation mirrors addPolicy", () => {
  const base = {
    minBidDepth: (100n * E).toString(), minAskDepth: (100n * E).toString(), minSeederNotional: (10n * E).toString(), minSeeders: 2,
    maxSpread: 10, band: 5, seedingPeriod: 7 * 86400, minRest: 3600, takerFeeBps: 100, rebateShareBps: 2000, referralShareBps: 1000,
    rebatePeriod: 30 * 86400, claimWindow: 90 * 86400, rebateCapPerMarket: "1", rebateCapPerWallet: "1", rebateBudget: "1", referralCapPerMarket: "1",
  };
  it("accepts the deploy defaults", () => expect(policySchema.safeParse(base).success).toBe(true));
  it("rejects incentives above 80% of the fee, fees above 5%, and non-lot depths", () => {
    expect(policySchema.safeParse({ ...base, rebateShareBps: 7000, referralShareBps: 2000 }).success).toBe(false);
    expect(policySchema.safeParse({ ...base, takerFeeBps: 501 }).success).toBe(false);
    expect(policySchema.safeParse({ ...base, minBidDepth: "123" }).success).toBe(false);
    expect(policySchema.safeParse({ ...base, claimWindow: 3600 }).success).toBe(false);
  });
});
