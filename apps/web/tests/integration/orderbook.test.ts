/**
 * The off-chain order book service against a real chain: what it accepts, what it refuses, how quotes track
 * live funding, and that "removed from the book" is not the same as "cancelled on-chain".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The exchange is the owner's first deployment on a fresh anvil, so its address is known before any import
// reads the deployment config (asserted in beforeAll).
const EXCHANGE = vi.hoisted(() => {
  const a = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  process.env.NEXT_PUBLIC_CHAIN_ID = "31611";
  process.env.NEXT_PUBLIC_RPC_URL = "http://127.0.0.1:8612";
  process.env.NEXT_PUBLIC_MARKETS_ADDRESS = a;
  return a;
});
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { exchangeAbi } from "@/lib/contracts/abi";
import { exchangeDomain, ORDER_TYPES } from "@/lib/orderbook/math";
import { serializeMetadata } from "@/lib/market/metadata";
import { BUY, E, KEYS, NO, SELL, startChain, YES, type Who } from "./chain";

let c: Awaited<ReturnType<typeof startChain>>;
let ob: typeof import("@/server/orderbook");
let indexer: ReturnType<typeof import("@/server/indexer/indexer")["createIndexer"]>;
let id: bigint;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
let salt = 1n;

const meta = serializeMetadata({
  v: 1,
  question: "Order-book integration test market",
  category: "other",
  description: "",
  rules: { yes: "Yes if the test says so.", no: "No otherwise.", invalid: "The test cannot run.", ambiguity: "" },
  source: { name: "Test", url: "https://example.org" },
  resolvesAt: "2030-01-01T00:00:00.000Z",
});

async function sign(who: Who, o: { outcome: number; side: number; price: number; qty: bigint; maker?: Who }) {
  const maker = privateKeyToAccount(KEYS[o.maker ?? who]).address;
  const t = (await c.client.getBlock()).timestamp;
  const message = { maker, taker: ZERO as Address, marketId: id, outcome: o.outcome, side: o.side, price: o.price, quantity: o.qty, expiry: t + 86400n, nonce: 0n, salt: salt++ };
  const signature = await privateKeyToAccount(KEYS[who]).signTypedData({ domain: exchangeDomain(31611, c.exchange), types: ORDER_TYPES, primaryType: "Order", message });
  const input = {
    maker,
    taker: ZERO,
    marketId: String(id),
    outcome: o.outcome,
    side: o.side,
    price: o.price,
    quantity: String(o.qty),
    expiry: String(message.expiry),
    nonce: "0",
    salt: String(message.salt),
    signature,
  };
  return { input, message, signature };
}
const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
};
/** Execute exactly what the quote returned, as the browser would. */
async function execute(who: Who, q: Awaited<ReturnType<typeof ob.quoteFor>>, outcome: number, side: number, limit: number) {
  const sources = q.sources.map((s) => ({
    restingId: BigInt(s.restingId),
    order: { ...s.order, maker: getAddress(s.order.maker), taker: getAddress(s.order.taker), marketId: BigInt(s.order.marketId), quantity: BigInt(s.order.quantity), expiry: BigInt(s.order.expiry), nonce: BigInt(s.order.nonce), salt: BigInt(s.order.salt) },
    signature: s.signature as Hex,
  }));
  const t = (await c.client.getBlock()).timestamp;
  return c.ex(who, "take", [{ marketId: id, outcome, side, limitPrice: limit, quantity: BigInt(q.quote.filled), minFill: 0n, deadline: t + 600n }, sources]);
}

beforeAll(async () => {
  c = await startChain(8612);
  expect(c.exchange.toLowerCase()).toBe(EXCHANGE.toLowerCase());
  const { openDb } = await import("@/server/db/client");
  (globalThis as unknown as { __mezonkDb?: Promise<unknown> }).__mezonkDb = openDb({ memory: true });
  ob = await import("@/server/orderbook");
  const { createIndexer } = await import("@/server/indexer/indexer");
  const { getDb } = await import("@/server/db/client");
  indexer = createIndexer({ client: c.client, db: getDb, chainId: 31611, address: c.exchange, deployBlock: c.deployBlock, confirmations: 0n });
  const t = (await c.client.getBlock()).timestamp;
  id = await c.createMarket({ metadata: meta, closeTime: t + 3n * 3600n, resolver: c.addr("resolver") });
}, 60_000);
afterAll(() => c?.stop());

describe("order book service on a real chain", () => {
  it("refuses signed orders while the market is still seeding", async () => {
    const { input } = await sign("carol", { outcome: YES, side: BUY, price: 40, qty: E(1) });
    expect(await status(() => ob.submitOrder(input))).toBe(409);
  });

  it("accepts a funded, correctly signed order and shows it on the book", async () => {
    await c.seedAndGraduate(id); // Yes bid 45 (escrowed), Yes ask 55 (escrowed)
    await c.ex("carol", "split", [id, E(20)]);
    const { input } = await sign("carol", { outcome: YES, side: SELL, price: 52, qty: E(10) });
    await expect(ob.submitOrder(input)).resolves.toMatchObject({ status: "open" });
    await indexer.runTick();
    const book = await ob.bookFor(Number(id));
    expect(book.asks[0]).toMatchObject({ yes: 52, shares: E(10).toString(), resting: "0" });
    expect(book.bids[0]).toMatchObject({ yes: 45 });
    expect(book.lastPrice).toBeNull(); // nothing has traded: the book has no price
    expect(book.mid).toBe(48.5);
  });

  it("rejects forged, unfunded and book-crossing orders", async () => {
    const forged = await sign("alice", { outcome: YES, side: SELL, price: 60, qty: E(1), maker: "carol" });
    expect(await status(() => ob.submitOrder(forged.input))).toBe(401);
    const unfunded = await sign("owner", { outcome: YES, side: SELL, price: 60, qty: E(1) }); // owner holds no shares
    expect(await status(() => ob.submitOrder(unfunded.input))).toBe(422);
    const crossing = await sign("owner", { outcome: YES, side: BUY, price: 53, qty: E(1) }); // above the 52 ask
    expect(await status(() => ob.submitOrder(crossing.input))).toBe(409);
  });

  it("quotes best-first across signed and escrowed liquidity, and the contract fills exactly that", async () => {
    const q = await ob.quoteFor(Number(id), { outcome: YES, side: BUY, quantity: E(15), limit: 60, taker: c.addr("owner") });
    expect(q.quote.steps.map((s) => [s.kind, s.takerPrice, s.quantity])).toEqual([
      ["signed", 52, E(10).toString()],
      ["resting", 55, E(5).toString()],
    ]);
    expect(BigInt(q.quote.notional)).toBe(E(5.2) + E(2.75));
    const before = await c.client.readContract({ address: c.exchange, abi: exchangeAbi, functionName: "sharesOf", args: [id, YES, c.addr("owner")] });
    await execute("owner", q, YES, BUY, 60);
    const after = await c.client.readContract({ address: c.exchange, abi: exchangeAbi, functionName: "sharesOf", args: [id, YES, c.addr("owner")] });
    expect(after - before).toBe(E(15));
    await indexer.runTick();
    const { signed } = await ob.ordersOf(c.addr("carol"), Number(id));
    expect(signed[0]).toMatchObject({ status: "filled", filled: E(10).toString() });
  });

  it("drops orders whose maker lost funding, and revives them when funding returns", async () => {
    const { input } = await sign("carol", { outcome: YES, side: SELL, price: 53, qty: E(10) });
    await ob.submitOrder(input);
    await c.ex("carol", "transferShares", [id, YES, c.addr("bob"), E(10)]); // carol now holds 0 Yes
    const q = await ob.quoteFor(Number(id), { outcome: YES, side: BUY, quantity: E(5), limit: 54, taker: c.addr("owner") });
    expect(q.quote.filled).toBe("0"); // the stale 53 offer is not quoted
    let { signed } = await ob.ordersOf(c.addr("carol"), Number(id));
    expect(signed.find((o) => o.price === 53)!.status).toBe("stale");
    await c.ex("bob", "transferShares", [id, YES, c.addr("carol"), E(10)]);
    await ob.sweepStaleOrders();
    ({ signed } = await ob.ordersOf(c.addr("carol"), Number(id)));
    expect(signed.find((o) => o.price === 53)!.status).toBe("open");
  });

  it("'removed' only hides an order; only an on-chain cancel makes the signature unusable", async () => {
    const { input, message, signature } = await sign("carol", { outcome: YES, side: SELL, price: 54, qty: E(2) });
    const { hash } = await ob.submitOrder(input);
    expect(await status(() => ob.removeOrder(hash, c.addr("alice")))).toBe(403);
    await ob.removeOrder(hash, c.addr("carol"));
    const src = [{ restingId: 0n, order: message, signature }];
    const t = (await c.client.getBlock()).timestamp;
    const params = { marketId: id, outcome: YES, side: BUY, limitPrice: 60, quantity: E(1), minFill: 0n, deadline: t + 600n };
    await c.ex("owner", "take", [params, src]); // still fillable: the signature is valid on-chain
    await c.ex("carol", "cancelSignedOrders", [[message]]);
    await expect(c.ex("owner", "take", [{ ...params, deadline: t + 900n }, src])).rejects.toThrow();
    await indexer.runTick();
    const { signed } = await ob.ordersOf(c.addr("carol"), Number(id));
    expect(signed.find((o) => o.hash === hash)!.status).toBe("cancelled");
  });

  it("reads the graduation check straight from the contract", async () => {
    const s = await ob.seedingStatus(Number(id));
    expect(s.graduatedAt).toBeGreaterThan(0);
    expect(s.policy.minSeeders).toBe(2);
    expect(s.check.open).toBe(false);
  });

  it("NO-side orders are matched by complement in the same book", async () => {
    // A No buyer hits the escrowed Yes bid at 45 by minting: pays 55 per share.
    const q = await ob.quoteFor(Number(id), { outcome: NO, side: BUY, quantity: E(4), limit: 56, taker: c.addr("carol") });
    expect(q.quote.steps[0]).toMatchObject({ kind: "resting", takerPrice: 55, complement: true });
    void NO;
  });
});
