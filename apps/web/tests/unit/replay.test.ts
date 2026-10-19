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
  args,
});

const created = ev("MarketCreated", {
  marketId: "1",
  creator: "0xC",
  resolver: "0xR",
  initialYesProbBps: 5000,
  creatorYes: "0",
  creatorNo: "0",
  metadata: meta,
  market: {
    arbitrator: "0xA",
    closeTime: "1800000000",
    feeBps: 100,
    protocolFeeShareBps: 5000,
    proposalWindow: 259200,
    challengeWindow: 86400,
    arbitrationWindow: 604800,
    proposerBond: (25n * E).toString(),
    disputeBond: (25n * E).toString(),
    poolYes: (100n * E).toString(),
    poolNo: (100n * E).toString(),
    collateral: (100n * E).toString(),
    metadataHash: metadataHash(meta),
  },
});

describe("replayMarket", () => {
  it("derives market, positions and average-cost P&L", () => {
    const events = [
      created,
      ev("Trade", { trader: "0xAl", isYes: true, isBuy: true, collateralAmount: (10n * E).toString(), fee: (E / 10n).toString(), shares: (18n * E).toString(), poolYes: (91n * E).toString(), poolNo: (109n * E).toString() }, 11n),
      ev("Trade", { trader: "0xAl", isYes: true, isBuy: false, collateralAmount: (5n * E).toString(), fee: (E / 20n).toString(), shares: (9n * E).toString(), poolYes: (95n * E).toString(), poolNo: (104n * E).toString() }, 12n),
      ev("OutcomeProposed", { resolver: "0xR", outcome: 1, evidenceHash: "0xee", evidenceURI: "ipfs://x", challengeDeadline: "1800090000" }, 13n),
      ev("MarketFinalized", { outcome: 1, reason: 0 }, 14n),
      ev("Redeemed", { account: "0xAl", yesBurned: (9n * E).toString(), noBurned: "0", payout: (9n * E).toString() }, 15n),
    ];
    const r = replayMarket(1, events, { chainId: 31611, contract: "0xM" })!;
    expect(r.market.structured).toBe(true);
    expect(r.market.question).toContain("BTC");
    expect(r.market.tradeCount).toBe(2);
    expect(r.market.traderCount).toBe(1);
    expect(r.market.volume).toBe((15n * E).toString());
    // collateral: 100 + 9.9 - 5 - 9
    expect(r.market.collateral).toBe((100n * E + 99n * E / 10n - 5n * E - 9n * E).toString());
    expect(r.market.finalOutcome).toBe(1);

    const al = r.positions.find((p) => p.account === "0xal")!;
    expect(al.yesShares).toBe(0n);
    expect(al.redeemed).toBe(true);
    // Paid 10, got back 4.95 + 9 → realized +3.95
    expect(al.realizedPnl).toBe(395n * E / 100n);
    expect(al.feesPaid).toBe(15n * E / 100n);
  });

  it("flags metadata whose hash doesn't match as unstructured", () => {
    const bad = { ...created, args: { ...created.args, market: { ...(created.args.market as object), metadataHash: "0x00" } } };
    expect(replayMarket(1, [bad], { chainId: 1, contract: "0x" })!.market.structured).toBe(false);
  });

  it("is idempotent", () => {
    const a = replayMarket(1, [created], { chainId: 1, contract: "0x" })!;
    const b = replayMarket(1, [created], { chainId: 1, contract: "0x" })!;
    expect({ ...a.market, updatedAt: 0 }).toEqual({ ...b.market, updatedAt: 0 });
  });

  it("returns null without a creation event", () => {
    expect(replayMarket(1, [], { chainId: 1, contract: "0x" })).toBeNull();
  });
});
