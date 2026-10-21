import { describe, expect, it } from "vitest";
import { replayMarket, type StoredEvent } from "@/server/indexer/replay";
import { metadataHash, serializeMetadata } from "@/lib/market/metadata";

const E = 10n ** 18n;
const meta = serializeMetadata({
  v: 1,
  question: "Will BTC close above $150,000 on 31 Dec 2026?",
  category: "bitcoin",
  description: "",
  rules: {
    yes: "Coinbase BTC-USD daily close on 31 Dec 2026 is above 150,000 USD.",
    no: "Coinbase BTC-USD daily close on 31 Dec 2026 is at or below 150,000 USD.",
    invalid: "Coinbase does not publish a daily close for 31 Dec 2026.",
    ambiguity: "",
  },
  source: { name: "Coinbase", url: "https://www.coinbase.com/price/bitcoin" },
  resolvesAt: "2026-12-31T23:59:59.000Z",
});

let n = 0;
const ev = (eventName: string, args: Record<string, unknown>, block = 10n): StoredEvent => ({
  id: ++n,
  blockNumber: block,
  blockTime: new Date(1_700_000_000_000 + Number(block) * 1000),
  txHash: `0x${n}`,
  logIndex: n,
  eventName,
  args: { marketId: "1", ...args },
});
const s = (v: bigint) => v.toString();
const snapshot = {
  arbitrator: "0xA",
  proposalWindow: 259200,
  challengeWindow: 86400,
  arbitrationWindow: 604800,
  proposerBond: 25n * E,
  disputeBond: 25n * E,
  takerFeeBps: 100,
};
const ctx = { chainId: 31611, contract: "0xM", snapshot };

const created = () =>
  ev("MarketCreated", {
    creator: "0xC",
    resolver: "0xR",
    policyId: 1,
    seedingDeadline: "1700600000",
    closeTime: "1800000000",
    metadataHash: metadataHash(meta),
    metadata: meta,
  });

describe("replayMarket (order book)", () => {
  it("tracks seeding, graduation, fills, positions and resolution with exact amounts", () => {
    const events = [
      created(),
      // Seeding: alice bids YES 100 @45 (escrow 45), bob bids NO 100 @45 (= YES ask @55, escrow 45).
      ev("OrderPlaced", { orderId: "1", maker: "0xAl", outcome: 0, side: 0, price: 45, quantity: s(100n * E), seed: true }, 11n),
      ev("OrderPlaced", { orderId: "2", maker: "0xBo", outcome: 1, side: 0, price: 45, quantity: s(100n * E), seed: true }, 11n),
      ev("Graduated", { bestBid: 45, bestAsk: 55, bidDepth: s(100n * E), askDepth: s(100n * E), seeders: 2 }, 12n),
      // Dave buys 40 YES against bob's NO bid (complement mint at YES 55): pays 22 + 0.22 fee.
      ev("Fill", { orderRef: "0x" + "0".repeat(63) + "2", taker: "0xDa", maker: "0xBo", resting: true, makerOutcome: 1, makerSide: 0, makerPrice: 45, quantity: s(40n * E), complement: true, takerFee: s(22n * E / 100n) }, 13n),
      ev("TakeSettled", { taker: "0xDa", outcome: 0, side: 0, filled: s(40n * E), notional: s(22n * E), fee: s(22n * E / 100n), rebatePart: "0", referralPart: "0" }, 13n),
      ev("OutcomeProposed", { resolver: "0xR", outcome: 1, evidenceHash: "0xee", evidenceURI: "ipfs://x", challengeDeadline: "1800090000" }, 14n),
      ev("MarketFinalized", { outcome: 1, reason: 0 }, 15n),
      ev("Redeemed", { account: "0xDa", yesBurned: s(40n * E), noBurned: "0", payout: s(40n * E) }, 16n),
    ];
    const r = replayMarket(1, events, ctx)!;
    expect(r.market.structured).toBe(true);
    expect(r.market.graduatedAt).toBeInstanceOf(Date);
    expect(r.graduation).toMatchObject({ bestBid: 45, bestAsk: 55, seeders: 2 });
    // 40 sets minted, 40 redeemed.
    expect(r.market.collateral).toBe("0");
    expect(r.market.volume).toBe(s(22n * E));
    expect(r.market.priceYes).toBe(0.55);
    expect(r.market.tradeCount).toBe(1);
    // Escrow left: alice 45, bob 60 x 0.45 = 27.
    expect(r.market.escrowed).toBe(s(45n * E + 27n * E));
    expect(r.market.bestBid).toBe(45);
    expect(r.market.bestAsk).toBe(55);
    const bob = r.resting.find((o) => o.orderId === 2)!;
    expect(bob.remaining).toBe(60n * E);
    expect(bob.status).toBe("open");

    const dave = r.positions.find((p) => p.account === "0xda")!;
    expect(dave.yesShares).toBe(0n);
    expect(dave.redeemed).toBe(true);
    // Paid 22.22 for 40 YES, redeemed 40 → +17.78
    expect(dave.realizedPnl).toBe(40n * E - 22n * E - 22n * E / 100n);
    const bobPos = r.positions.find((p) => p.account === "0xbo")!;
    expect(bobPos.noShares).toBe(40n * E);
    expect(bobPos.noCost).toBe(18n * E);
  });

  it("records refunds after a failed seeding and never sets a price without a trade", () => {
    const events = [
      created(),
      ev("OrderPlaced", { orderId: "7", maker: "0xAl", outcome: 0, side: 0, price: 40, quantity: s(10n * E), seed: true }, 11n),
      ev("OrderCancelled", { orderId: "7", maker: "0xAl", remaining: s(10n * E) }, 20n),
    ];
    const r = replayMarket(1, events, ctx)!;
    expect(r.market.graduatedAt).toBeNull();
    expect(r.market.priceYes).toBeNull();
    expect(r.market.escrowed).toBe("0");
    expect(r.resting[0]!.status).toBe("cancelled");
  });

  it("split, merge and transfers move cost basis without inventing P&L", () => {
    const events = [
      created(),
      ev("Split", { account: "0xAl", amount: s(10n * E) }, 11n),
      ev("SharesTransferred", { from: "0xAl", to: "0xBo", outcome: 1, amount: s(10n * E) }, 12n),
      ev("Split", { account: "0xAl", amount: s(4n * E) }, 13n),
      ev("Merged", { account: "0xAl", amount: s(4n * E) }, 14n),
    ];
    const r = replayMarket(1, events, ctx)!;
    expect(r.market.collateral).toBe(s(10n * E));
    const al = r.positions.find((p) => p.account === "0xal")!;
    expect(al.yesShares).toBe(10n * E);
    expect(al.noShares).toBe(0n);
    const bo = r.positions.find((p) => p.account === "0xbo")!;
    expect(bo.noShares).toBe(10n * E);
    expect(bo.noCost).toBe(5n * E);
  });

  it("is order-independent of input sorting and idempotent", () => {
    const events = [created(), ev("Split", { account: "0xAl", amount: s(E) }, 11n)];
    const a = replayMarket(1, events, ctx)!;
    const b = replayMarket(1, [...events].reverse(), ctx)!;
    expect(b.market.collateral).toBe(a.market.collateral);
  });

  it("returns null without a MarketCreated event", () => {
    expect(replayMarket(1, [], ctx)).toBeNull();
  });
});
