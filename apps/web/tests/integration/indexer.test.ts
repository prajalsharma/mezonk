import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { serializeMetadata, metadataHash } from "@/lib/market/metadata";
import { openDb, schema, type Db } from "@/server/db/client";
import { createIndexer } from "@/server/indexer/indexer";
import { buildTimeline, type TimelineEventInput } from "@/lib/market/timeline";
import { E, startChain } from "./chain";

let c: Awaited<ReturnType<typeof startChain>>;
let db: Db;
let idx: ReturnType<typeof createIndexer>;
const MAX = 2n ** 63n;

const meta = serializeMetadata({
  v: 1,
  question: "Integration test: will this market resolve Yes?",
  category: "other",
  description: "",
  rules: { yes: "The integration test proposes Yes and it is upheld.", no: "The integration test proposes No and it is upheld.", invalid: "The integration test cannot complete its steps.", ambiguity: "" },
  source: { name: "Test", url: "https://example.org" },
  resolvesAt: "2030-01-01T00:00:00.000Z",
});

async function createMarket() {
  const t = (await c.client.getBlock()).timestamp;
  return c.createMarket({ metadata: meta, closeTime: t + 7200n, resolver: c.addr("resolver"), initialLiquidity: E(100), initialYesProbBps: 5000 });
}
const buy = (who: "alice" | "bob", id: bigint, yes: boolean, amt: number) =>
  c.send(c.wallet(who).writeContract({ address: c.markets, abi: mezonkMarketsAbi, functionName: "buy", args: [id, yes, E(amt), 0n, MAX] }));
const count = async () => Number((await db.select({ n: sql<number>`count(*)::int` }).from(schema.chainEvents))[0]!.n);

beforeAll(async () => {
  c = await startChain(8611);
  db = await openDb({ memory: true });
  idx = createIndexer({ client: c.client, db: async () => db, chainId: 31611, address: c.markets, deployBlock: c.deployBlock, confirmations: 0n });
});
afterAll(() => c?.stop());

describe("indexer against a real chain", () => {
  let id: bigint;

  it("indexes the full resolution lifecycle and matches contract state", async () => {
    id = await createMarket();
    await buy("alice", id, true, 30);
    await buy("bob", id, false, 20);
    await c.client.increaseTime({ seconds: 7200 });
    await c.client.mine({ blocks: 1 });
    const ev = "0x" + "11".repeat(32);
    await c.send(c.wallet("resolver").writeContract({ address: c.markets, abi: mezonkMarketsAbi, functionName: "proposeOutcome", args: [id, 1, ev as `0x${string}`, "https://e/1"] }));
    await c.send(c.wallet("bob").writeContract({ address: c.markets, abi: mezonkMarketsAbi, functionName: "dispute", args: [id, ev as `0x${string}`, "https://e/2"] }));
    await c.send(c.wallet("arbitrator").writeContract({ address: c.markets, abi: mezonkMarketsAbi, functionName: "arbitrate", args: [id, 1, ev as `0x${string}`, "https://e/3"] }));
    await c.send(c.wallet("alice").writeContract({ address: c.markets, abi: mezonkMarketsAbi, functionName: "redeem", args: [id] }));

    const r = await idx.runTick();
    expect(r.ok).toBe(true);
    const [m] = await db.select().from(schema.markets).where(eq(schema.markets.marketId, Number(id)));
    expect(m!.structured).toBe(true);
    expect(m!.metadataHash).toBe(metadataHash(meta));
    expect(m!.finalOutcome).toBe(1);
    expect(m!.finalizeReason).toBe(1); // Arbitrated
    const [d] = await db.select().from(schema.disputes).where(eq(schema.disputes.marketId, Number(id)));
    expect(d!.ruling).toBe(1);
    expect(d!.rulingRationaleUri).toBe("https://e/3");
    expect(await idx.reconcile()).toEqual([]);

    const alice = (await db.select().from(schema.positions)).find((p) => p.account === c.addr("alice").toLowerCase())!;
    expect(alice.redeemed).toBe(true);
    expect(BigInt(alice.yesShares)).toBe(0n);

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
    await idx.runTick();
    const snap = await c.client.snapshot();
    await buy("alice", id2, true, 10); // this trade will be orphaned
    await idx.runTick();
    const orphaned = (await db.select().from(schema.trades).where(eq(schema.trades.marketId, Number(id2)))).length;
    expect(orphaned).toBe(1);

    await c.client.revert({ id: snap });
    await c.client.mine({ blocks: 3 }); // canonical chain overtakes the old height with different blocks
    await buy("bob", id2, false, 7);
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
      address: c.markets,
      deployBlock: c.deployBlock,
      confirmations: 0n,
    });
    const r = await dead.runTick();
    expect(r.ok).toBe(false);
    const [after] = await db.select().from(schema.indexerState);
    expect(after!.lastBlock).toBe(before!.lastBlock);
    expect(after!.lastError).toBeTruthy();
    await buy("alice", 1n, true, 1).catch(() => undefined); // market 1 is finalized; ignore revert
    const ok = await idx.runTick();
    expect(ok.ok).toBe(true);
    const [healed] = await db.select().from(schema.indexerState);
    expect(healed!.lastError).toBeNull();
  });

  it("reports lag when held behind head by confirmations", async () => {
    await c.client.mine({ blocks: 20 });
    const lagged = createIndexer({ client: c.client, db: async () => db, chainId: 31611, address: c.markets, deployBlock: c.deployBlock, confirmations: 12n });
    await lagged.runTick();
    const [st] = await db.select().from(schema.indexerState);
    expect(Number(st!.headBlock! - st!.lastBlock)).toBeGreaterThanOrEqual(12);
  });

  it("detects divergence between the index and the contract", async () => {
    await db.update(schema.markets).set({ poolYes: "1" }).where(eq(schema.markets.marketId, 2));
    const mm = await idx.reconcile();
    expect(mm.some((x) => x.marketId === 2 && x.field === "poolYes")).toBe(true);
    await idx.rebuildMarket(2); // repair from raw events
    expect((await idx.reconcile()).filter((x) => x.marketId === 2)).toEqual([]);
  });
});
