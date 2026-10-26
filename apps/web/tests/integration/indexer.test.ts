import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { resolutionAbi } from "@/lib/contracts/abi";
import { serializeMetadata, metadataHash } from "@/lib/market/metadata";
import { exchangeAbi as exchangeAbiForTest } from "@/lib/contracts/abi";
import { openDb, schema, type Db } from "@/server/db/client";
import { createIndexer } from "@/server/indexer/indexer";
import { crowdFor } from "@/server/queries";
import { buildTimeline, type TimelineEventInput } from "@/lib/market/timeline";
import { BUY, E, NO, startChain, YES } from "./chain";

let c: Awaited<ReturnType<typeof startChain>>;
let db: Db;
let idx: ReturnType<typeof createIndexer>;

const meta = serializeMetadata({
  v: 1,
  question: "Integration test: will this market resolve Yes?",
  category: "other",
  description: "",
  rules: { yes: "The integration test proposes Yes and it is upheld.", no: "The integration test proposes No and it is upheld.", invalid: "The integration test cannot complete its steps.", ambiguity: "" },
  source: { name: "Test", url: "https://example.org" },
  resolvesAt: "2030-01-01T00:00:00.000Z",
});

/** Published into seeding; close leaves room for the 1h seeding period and the 1h minimum live time. */
async function createMarket() {
  const t = (await c.client.getBlock()).timestamp;
  return c.createMarket({ metadata: meta, closeTime: t + 3n * 3600n, resolver: c.addr("resolver") });
}
/** Resting order ids for a market, read from the chain. */
async function resting(id: bigint, outcome: number) {
  const n = await c.client.readContract({ address: c.exchange, abi: exchangeAbiForTest, functionName: "restingCount" });
  const out: bigint[] = [];
  for (let i = 1n; i <= n; i++) {
    const o = await c.client.readContract({ address: c.exchange, abi: exchangeAbiForTest, functionName: "getResting", args: [i] });
    if (o.marketId === id && o.outcome === outcome && o.remaining > 0n) out.push(i);
  }
  return out;
}
/** `who` buys `qty` Yes against the Yes asks (escrowed No bids). */
const buyYes = async (who: "alice" | "bob" | "carol", id: bigint, qty: number) => c.take(who, id, YES, BUY, 99, E(qty), await resting(id, NO));
/** `who` buys `qty` No against the Yes bids (escrowed Yes bids): mints sets. */
const buyNo = async (who: "alice" | "bob" | "carol", id: bigint, qty: number) => c.take(who, id, NO, BUY, 99, E(qty), await resting(id, YES));
const count = async () => Number((await db.select({ n: sql<number>`count(*)::int` }).from(schema.chainEvents))[0]!.n);

beforeAll(async () => {
  c = await startChain(8611);
  db = await openDb({ memory: true });
  idx = createIndexer({ client: c.client, db: async () => db, chainId: 31611, address: c.exchange, deployBlock: c.deployBlock, confirmations: 0n });
});
afterAll(() => c?.stop());

describe("indexer against a real chain", () => {
  let id: bigint;

  it("indexes seeding, graduation, fills and the full resolution lifecycle, matching contract state", async () => {
    id = await createMarket();
    await idx.runTick();
    let [m] = await db.select().from(schema.markets).where(eq(schema.markets.marketId, Number(id)));
    expect(m!.graduatedAt).toBeNull();
    expect(m!.priceYes).toBeNull(); // no trade, no price

    await c.seedAndGraduate(id);
    await buyYes("carol", id, 30); // complement mint at Yes 55 against bob's escrowed No bid
    await c.client.increaseTime({ seconds: 3 * 3600 });
    await c.client.mine({ blocks: 1 });
    const ev = "0x" + "11".repeat(32);
    const res = (who: "resolver" | "bob" | "arbitrator", functionName: string, args: readonly unknown[]) =>
      c.send(c.wallet(who).writeContract({ address: c.resolutionAddress, abi: resolutionAbi, functionName, args } as never));
    await res("resolver", "proposeOutcome", [id, 1, ev, "https://e/1"]);
    await res("bob", "dispute", [id, ev, "https://e/2"]);
    await res("arbitrator", "arbitrate", [id, 1, ev, "https://e/3"]);
    await c.ex("carol", "redeem", [id]);

    const r = await idx.runTick();
    expect(r.ok).toBe(true);
    [m] = await db.select().from(schema.markets).where(eq(schema.markets.marketId, Number(id)));
    expect(m!.structured).toBe(true);
    expect(m!.graduatedAt).toBeInstanceOf(Date);
    expect(m!.priceYes).toBe(0.55);
    expect(m!.collateral).toBe("0"); // 30 sets minted, all 30 winning Yes redeemed
    const [g] = await db.select().from(schema.marketGraduations).where(eq(schema.marketGraduations.marketId, Number(id)));
    expect(g).toMatchObject({ bestBid: 45, bestAsk: 55, seeders: 2 });
    const fills = await db.select().from(schema.fills).where(eq(schema.fills.marketId, Number(id)));
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ complement: true, yesPrice: 55, resting: true });
    const rest = await db.select().from(schema.restingOrders).where(eq(schema.restingOrders.marketId, Number(id)));
    expect(rest).toHaveLength(2);
    expect(rest.find((o) => o.outcome === NO)!.remaining).toBe(E(30).toString());
    expect(m!.metadataHash).toBe(metadataHash(meta));
    expect(m!.finalOutcome).toBe(1);
    expect(m!.finalizeReason).toBe(1); // Arbitrated
    const [d] = await db.select().from(schema.disputes).where(eq(schema.disputes.marketId, Number(id)));
    expect(d!.ruling).toBe(1);
    expect(d!.rulingRationaleUri).toBe("https://e/3");
    expect(await idx.reconcile()).toEqual([]);

    const carol = (await db.select().from(schema.positions)).find((p) => p.account === c.addr("carol").toLowerCase())!;
    expect(carol.redeemed).toBe(true);
    expect(BigInt(carol.yesShares)).toBe(0n);
    expect(BigInt(carol.realizedPnl)).toBe(E(30) - E(16.5) - E(0.165)); // paid 16.5 + 1% fee, redeemed 30

    // "Who backed what" comes from fill history, so carol still counts on Yes after redeeming; the creator never counts.
    const [row] = await db.select().from(schema.markets).where(eq(schema.markets.marketId, Number(id)));
    const crowd = (await crowdFor([Number(id)], db, 31611)).get(Number(id))!;
    expect(crowd.yesPeople).toBeGreaterThan(0);
    expect(BigInt(crowd.yesStake)).toBeGreaterThanOrEqual(E(16.5)); // includes carol's 16.5 (fee excluded)
    const fillsHere = await db.select().from(schema.fills).where(eq(schema.fills.marketId, Number(id)));
    const people = new Set(fillsHere.flatMap((f) => [f.maker.toLowerCase(), f.taker.toLowerCase()]));
    people.delete(row!.creator.toLowerCase());
    expect(crowd.yesPeople + crowd.noPeople).toBeLessThanOrEqual(2 * people.size);
    expect(people.has(c.addr("carol").toLowerCase())).toBe(true);

    // Timeline reconstructed from stored events is complete and ordered.
    const evs = await db.select().from(schema.chainEvents).where(eq(schema.chainEvents.marketId, Number(id)));
    const tl = buildTimeline(m!, evs as TimelineEventInput[], Date.now() + 10 * 86400e3);
    expect(tl.map((x) => x.kind)).toEqual(
      expect.arrayContaining(["created", "closed", "proposed", "challenge-window", "disputed", "arbitration-window", "arbitrated", "finalized", "claims-open", "redeemed"]),
    );
  });

  it("is idempotent under duplicate delivery (cursor rewound to the deploy block)", async () => {
    const before = await count();
    const posBefore = await db.select().from(schema.positions);
    await db.update(schema.indexerState).set({ lastBlock: c.deployBlock - 1n, lastBlockHash: null });
    const r = await idx.runTick();
    expect(r.ok).toBe(true);
    expect(r.eventsInserted).toBe(0);
    expect(await count()).toBe(before);
    expect(await db.select().from(schema.positions)).toHaveLength(posBefore.length);
  });

  it("recovers from a chain reorganization", async () => {
    const id2 = await createMarket();
    await c.seedAndGraduate(id2);
    await idx.runTick();
    const snap = await c.client.snapshot();
    await buyYes("carol", id2, 10); // this trade will be orphaned
    await idx.runTick();
    const orphaned = (await db.select().from(schema.trades).where(eq(schema.trades.marketId, Number(id2)))).length;
    expect(orphaned).toBe(1);

    await c.client.revert({ id: snap });
    await c.client.mine({ blocks: 3 }); // canonical chain overtakes the old height with different blocks
    await buyNo("carol", id2, 7);
    const r = await idx.runTick();
    expect(r.reorg).toBe(true);
    const trades = await db.select().from(schema.trades).where(eq(schema.trades.marketId, Number(id2)));
    expect(trades).toHaveLength(1);
    expect(trades[0]!.side).toBe("no");
    const [st] = await db.select().from(schema.indexerState);
    expect(st!.reorgsHandled).toBe(1);
    expect(await idx.reconcile()).toEqual([]);
  });

  it("records RPC failures without advancing, then retries successfully", async () => {
    const [before] = await db.select().from(schema.indexerState);
    const dead = createIndexer({
      client: createPublicClient({ transport: http("http://127.0.0.1:1", { retryCount: 0, timeout: 500 }) }),
      db: async () => db,
      chainId: 31611,
      address: c.exchange,
      deployBlock: c.deployBlock,
      confirmations: 0n,
    });
    const r = await dead.runTick();
    expect(r.ok).toBe(false);
    const [after] = await db.select().from(schema.indexerState);
    expect(after!.lastBlock).toBe(before!.lastBlock);
    expect(after!.lastError).toBeTruthy();
    await c.ex("carol", "split", [2n, E(1)]); // a real event to pick up after recovery
    const ok = await idx.runTick();
    expect(ok.ok).toBe(true);
    const [healed] = await db.select().from(schema.indexerState);
    expect(healed!.lastError).toBeNull();
  });

  it("reports lag when held behind head by confirmations", async () => {
    await c.client.mine({ blocks: 20 });
    const lagged = createIndexer({ client: c.client, db: async () => db, chainId: 31611, address: c.exchange, deployBlock: c.deployBlock, confirmations: 12n });
    await lagged.runTick();
    const [st] = await db.select().from(schema.indexerState);
    expect(Number(st!.headBlock! - st!.lastBlock)).toBeGreaterThanOrEqual(12);
  });

  it("detects divergence between the index and the contract", async () => {
    await db.update(schema.markets).set({ collateral: "1" }).where(eq(schema.markets.marketId, 2));
    const mm = await idx.reconcile();
    expect(mm.some((x) => x.marketId === 2 && x.field === "collateral")).toBe(true);
    await idx.rebuildMarket(2); // repair from raw events
    expect((await idx.reconcile()).filter((x) => x.marketId === 2)).toEqual([]);
  });
});
