import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { erc20Abi, getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi } from "@/lib/contracts/abi";
import {
  aggregateBook,
  bookPosition,
  BUY,
  cost,
  exchangeDomain,
  LOT,
  ORDER_TYPES,
  quote,
  SELL,
  type Liquidity,
  type Quote,
} from "@/lib/orderbook/math";
import { chainNowMs, publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";

const { orders, restingOrders, markets } = schema;
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_EXPIRY_S = 90 * 86400;
const MAX_OPEN_PER_MAKER = 200;

export class BookError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const deny = (status: number, code: string, message: string) => new BookError(status, code, message);

const uint = z.string().regex(/^\d{1,78}$/);
export const signedOrderSchema = z.object({
  maker: z.string().refine((s) => isAddress(s), "maker"),
  taker: z.string().refine((s) => isAddress(s), "taker").default(ZERO),
  marketId: uint,
  outcome: z.number().int().min(0).max(1),
  side: z.number().int().min(0).max(1),
  price: z.number().int().min(1).max(99),
  quantity: uint,
  expiry: uint,
  nonce: uint,
  salt: uint,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
export type SignedOrderInput = z.infer<typeof signedOrderSchema>;

const toMessage = (o: SignedOrderInput) => ({
  maker: getAddress(o.maker),
  taker: getAddress(o.taker),
  marketId: BigInt(o.marketId),
  outcome: o.outcome,
  side: o.side,
  price: o.price,
  quantity: BigInt(o.quantity),
  expiry: BigInt(o.expiry),
  nonce: BigInt(o.nonce),
  salt: BigInt(o.salt),
});

function exchange(): Address {
  if (!deployment.marketsAddress) throw deny(503, "no_deployment", "No exchange is configured");
  return deployment.marketsAddress;
}

/** Live funding check for one signed order (what the contract will check at settlement). */
async function funded(o: { maker: string; marketId: number; outcome: number; side: number; price: number; remaining: bigint }) {
  const ex = exchange();
  if (o.side === BUY) {
    const need = cost(o.remaining, o.price);
    const [bal, allow] = await Promise.all([
      publicClient.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "balanceOf", args: [o.maker as Address] }),
      publicClient.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "allowance", args: [o.maker as Address, ex] }),
    ]);
    if (bal < need) return { ok: false, reason: "maker's MUSD balance is below the order" };
    if (allow < need) return { ok: false, reason: "maker's MUSD approval is below the order" };
    return { ok: true, reason: null };
  }
  const shares = await publicClient.readContract({
    address: ex,
    abi: exchangeAbi,
    functionName: "sharesOf",
    args: [BigInt(o.marketId), o.outcome, o.maker as Address],
  });
  return shares >= o.remaining ? { ok: true, reason: null } : { ok: false, reason: "maker no longer holds the shares" };
}

/** Every open, fillable piece of liquidity for a market: escrowed resting orders and open signed orders. */
export async function marketLiquidity(marketId: number): Promise<Liquidity[]> {
  const db = await getDb();
  const [rest, signed] = await Promise.all([
    db.select().from(restingOrders).where(and(eq(restingOrders.marketId, marketId), eq(restingOrders.status, "open"))),
    db
      .select()
      .from(orders)
      .where(and(eq(orders.marketId, marketId), eq(orders.status, "open"), eq(orders.chainId, deployment.chainId), sql`${orders.expiry} > now()`)),
  ]);
  return [
    ...rest.map((r) => ({
      kind: "resting" as const,
      ref: String(r.orderId),
      maker: r.maker,
      outcome: r.outcome,
      side: r.side,
      price: r.price,
      available: BigInt(r.remaining),
    })),
    ...signed
      .filter((o) => o.taker === ZERO)
      .map((o) => ({
        kind: "signed" as const,
        ref: o.hash,
        maker: o.maker,
        outcome: o.outcome,
        side: o.side,
        price: o.price,
        available: BigInt(o.quantity) - BigInt(o.filled),
      })),
  ];
}

export interface BookSnapshot {
  bids: Array<{ yes: number; shares: string; resting: string; orders: number }>;
  asks: Array<{ yes: number; shares: string; resting: string; orders: number }>;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  /** Midpoint of the best bid and ask. Indicative only: not a trade, not an executable price. */
  mid: number | null;
  /** Price of the last real fill, or null if there has never been one. */
  lastPrice: number | null;
  bidNotional: string;
  askNotional: string;
}

export async function bookFor(marketId: number): Promise<BookSnapshot> {
  const db = await getDb();
  const liq = await marketLiquidity(marketId);
  const { bids, asks } = aggregateBook(liq);
  const [m] = await db.select({ priceYes: markets.priceYes }).from(markets).where(eq(markets.marketId, marketId));
  const bestBid = bids[0]?.yes ?? null;
  const bestAsk = asks[0]?.yes ?? null;
  const s = (x: bigint) => x.toString();
  return {
    bids: bids.map((l) => ({ yes: l.yes, shares: s(l.shares), resting: s(l.resting), orders: l.orders })),
    asks: asks.map((l) => ({ yes: l.yes, shares: s(l.shares), resting: s(l.resting), orders: l.orders })),
    bestBid,
    bestAsk,
    spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
    mid: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
    lastPrice: m?.priceYes == null ? null : Math.round(m.priceYes * 100),
    bidNotional: s(bids.reduce((a, l) => a + cost(l.shares, l.yes), 0n)),
    askNotional: s(asks.reduce((a, l) => a + cost(l.shares, 100 - l.yes), 0n)),
  };
}

/** Best bid/ask per market (resting + signed), for lists. */
export async function bookTops(ids: number[]) {
  const out = new Map<number, { bestBid: number | null; bestAsk: number | null; depth: bigint }>();
  if (!ids.length) return out;
  const db = await getDb();
  const [rest, signed] = await Promise.all([
    db.select().from(restingOrders).where(and(inArray(restingOrders.marketId, ids), eq(restingOrders.status, "open"))),
    db
      .select()
      .from(orders)
      .where(and(inArray(orders.marketId, ids), eq(orders.status, "open"), sql`${orders.expiry} > now()`)),
  ]);
  for (const id of ids) out.set(id, { bestBid: null, bestAsk: null, depth: 0n });
  const add = (id: number, outcome: number, side: number, price: number, avail: bigint) => {
    if (avail <= 0n) return;
    const t = out.get(id)!;
    const p = bookPosition(outcome, side, price);
    if (p.book === "bid") t.bestBid = t.bestBid == null ? p.yes : Math.max(t.bestBid, p.yes);
    else t.bestAsk = t.bestAsk == null ? p.yes : Math.min(t.bestAsk, p.yes);
    t.depth += cost(avail, price);
  };
  for (const r of rest) add(r.marketId, r.outcome, r.side, r.price, BigInt(r.remaining));
  for (const o of signed) add(o.marketId, o.outcome, o.side, o.price, BigInt(o.quantity) - BigInt(o.filled));
  return out;
}

/** Accept a signed order into the book after every check the contract would make, plus no crossing. */
export async function submitOrder(input: SignedOrderInput) {
  const ex = exchange();
  const msg = toMessage(input);
  const marketId = Number(msg.marketId);
  if (msg.quantity === 0n || msg.quantity % LOT !== 0n) throw deny(422, "bad_lot", "Quantity must be a positive multiple of 0.01 shares");
  const nowS = BigInt(Math.floor((await chainNowMs()) / 1000));
  if (msg.expiry <= nowS + 30n) throw deny(422, "expired", "The order expires too soon");
  if (msg.expiry > nowS + BigInt(MAX_EXPIRY_S)) throw deny(422, "expiry_too_far", "Orders can last at most 90 days");

  const stage = await publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "stageOf", args: [msg.marketId] }).catch(() => null);
  if (stage !== 1) throw deny(409, "not_live", "Signed orders are only accepted while the market is live. During seeding, place an escrowed seed order instead.");

  const valid = await publicClient
    .verifyTypedData({
      address: msg.maker,
      domain: exchangeDomain(deployment.chainId, ex),
      types: ORDER_TYPES,
      primaryType: "Order",
      message: msg,
      signature: input.signature as Hex,
    })
    .catch(() => false);
  if (!valid) throw deny(401, "bad_signature", "The signature doesn't match this order and maker");

  const hash = (await publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "orderHash", args: [msg] })).toLowerCase();
  const [cancelled, filled, minNonce] = await Promise.all([
    publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "cancelledOrder", args: [hash as Hex] }),
    publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "filledOf", args: [hash as Hex] }),
    publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "minNonce", args: [msg.maker] }),
  ]);
  if (cancelled) throw deny(409, "cancelled", "This order was cancelled on-chain");
  if (msg.nonce < minNonce) throw deny(409, "nonce", "This order's nonce was invalidated on-chain");
  const remaining = msg.quantity - filled;
  if (remaining <= 0n) throw deny(409, "filled", "This order is already filled");

  const f = await funded({ maker: msg.maker, marketId, outcome: msg.outcome, side: msg.side, price: msg.price, remaining });
  if (!f.ok) throw deny(422, "unfunded", `Not accepted: the ${f.reason}.`);

  // A resting maker order must not cross the book: it should take instead.
  const liq = await marketLiquidity(marketId);
  const { bids, asks } = aggregateBook(liq.filter((l) => l.maker.toLowerCase() !== msg.maker.toLowerCase()));
  const pos = bookPosition(msg.outcome, msg.side, msg.price);
  if (pos.book === "bid" && asks[0] && pos.yes >= asks[0].yes) throw deny(409, "crosses", `This would cross an ask at ${asks[0].yes}¢. Trade against it instead.`);
  if (pos.book === "ask" && bids[0] && pos.yes <= bids[0].yes) throw deny(409, "crosses", `This would cross a bid at ${bids[0].yes}¢. Trade against it instead.`);

  const db = await getDb();
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.maker, msg.maker.toLowerCase()), eq(orders.status, "open")));
  if (n >= MAX_OPEN_PER_MAKER) throw deny(429, "too_many", "Too many open orders for this wallet");

  const row = {
    hash,
    chainId: deployment.chainId,
    exchange: ex.toLowerCase(),
    marketId,
    maker: msg.maker.toLowerCase(),
    taker: msg.taker.toLowerCase(),
    outcome: msg.outcome,
    side: msg.side,
    price: msg.price,
    quantity: msg.quantity.toString(),
    filled: filled.toString(),
    expiry: new Date(Number(msg.expiry) * 1000),
    nonce: msg.nonce.toString(),
    salt: msg.salt.toString(),
    signature: input.signature.toLowerCase(),
    status: "open",
  };
  await db.insert(orders).values(row).onConflictDoNothing({ target: orders.hash });
  return { hash, status: "open" as const };
}

/** Hide an order from the book (maker only). The signature stays valid on-chain until cancelled there. */
export async function removeOrder(hash: string, wallet: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.hash, hash.toLowerCase()));
  if (!o) throw deny(404, "not_found", "No such order");
  if (o.maker !== wallet.toLowerCase()) throw deny(403, "not_maker", "Only the maker can remove this order");
  if (o.status !== "open" && o.status !== "stale") throw deny(409, "closed", `This order is already ${o.status}`);
  await db.update(orders).set({ status: "removed", statusReason: "removed by maker (not cancelled on-chain)", updatedAt: new Date() }).where(eq(orders.hash, o.hash));
  return { hash: o.hash, status: "removed" as const };
}

export async function ordersOf(maker: string, marketId?: number) {
  const db = await getDb();
  const conds = [eq(orders.maker, maker.toLowerCase())];
  if (marketId) conds.push(eq(orders.marketId, marketId));
  const signed = await db.select().from(orders).where(and(...conds)).orderBy(sql`${orders.createdAt} desc`).limit(200);
  const rconds = [eq(restingOrders.maker, maker.toLowerCase())];
  if (marketId) rconds.push(eq(restingOrders.marketId, marketId));
  const resting = await db.select().from(restingOrders).where(and(...rconds)).orderBy(sql`${restingOrders.placedAt} desc`).limit(200);
  return { signed, resting };
}

/** Full signed order for settlement (contract struct + signature). */
async function signedSources(hashes: string[]) {
  if (!hashes.length) return new Map<string, typeof orders.$inferSelect>();
  const db = await getDb();
  const rows = await db.select().from(orders).where(inArray(orders.hash, hashes));
  return new Map(rows.map((r) => [r.hash, r]));
}

export interface QuoteResponse {
  quote: Omit<Quote, "steps" | "requested" | "filled" | "unfilled" | "notional" | "fee"> & {
    requested: string;
    filled: string;
    unfilled: string;
    notional: string;
    fee: string;
    steps: Array<{ kind: "signed" | "resting"; ref: string; quantity: string; takerPrice: number; complement: boolean }>;
  };
  /** Ready for MezonkExchange.take: in fill order. */
  sources: Array<{
    restingId: string;
    order: { maker: string; taker: string; marketId: string; outcome: number; side: number; price: number; quantity: string; expiry: string; nonce: string; salt: string };
    signature: string;
  }>;
  feeBps: number;
}

/**
 * What a taker would get right now, with each signed order's funding re-checked on-chain first. The client
 * submits exactly these sources; the contract re-validates everything, so a stale quote fails safely.
 */
export async function quoteFor(marketId: number, t: { outcome: number; side: number; quantity: bigint; limit: number; taker?: string }): Promise<QuoteResponse> {
  const db = await getDb();
  const [m] = await db.select({ feeBps: markets.feeBps }).from(markets).where(eq(markets.marketId, marketId));
  if (!m) throw deny(404, "not_found", "No such market");
  let liq = await marketLiquidity(marketId);
  let q = quote(liq, { ...t, feeBps: m.feeBps });
  // Re-check signed makers we'd hit; drop and mark the stale ones, then quote again (bounded).
  for (let round = 0; round < 3; round++) {
    const stale: string[] = [];
    await Promise.all(
      q.steps
        .filter((s) => s.liquidity.kind === "signed")
        .map(async (s) => {
          const f = await funded({ ...s.liquidity, marketId, remaining: s.liquidity.available }).catch(() => ({ ok: true, reason: null }));
          if (!f.ok) stale.push(s.liquidity.ref);
        }),
    );
    if (!stale.length) break;
    await db.update(orders).set({ status: "stale", statusReason: "maker funding changed", updatedAt: new Date() }).where(inArray(orders.hash, stale));
    liq = liq.filter((l) => !stale.includes(l.ref));
    q = quote(liq, { ...t, feeBps: m.feeBps });
  }
  const full = await signedSources(q.steps.filter((s) => s.liquidity.kind === "signed").map((s) => s.liquidity.ref));
  const sources = q.steps.map((s) => {
    if (s.liquidity.kind === "resting") {
      return {
        restingId: s.liquidity.ref,
        order: { maker: ZERO, taker: ZERO, marketId: "0", outcome: 0, side: 0, price: 0, quantity: "0", expiry: "0", nonce: "0", salt: "0" },
        signature: "0x",
      };
    }
    const o = full.get(s.liquidity.ref)!;
    return {
      restingId: "0",
      order: {
        maker: getAddress(o.maker),
        taker: getAddress(o.taker),
        marketId: String(o.marketId),
        outcome: o.outcome,
        side: o.side,
        price: o.price,
        quantity: o.quantity,
        expiry: String(Math.floor(o.expiry.getTime() / 1000)),
        nonce: o.nonce,
        salt: o.salt,
      },
      signature: o.signature,
    };
  });
  return {
    quote: {
      requested: q.requested.toString(),
      filled: q.filled.toString(),
      unfilled: q.unfilled.toString(),
      notional: q.notional.toString(),
      fee: q.fee.toString(),
      bestPrice: q.bestPrice,
      worstPrice: q.worstPrice,
      steps: q.steps.map((s) => ({ kind: s.liquidity.kind, ref: s.liquidity.ref, quantity: s.quantity.toString(), takerPrice: s.takerPrice, complement: s.complement })),
    },
    sources,
    feeBps: m.feeBps,
  };
}

/** Periodic hygiene: mark unfunded open orders stale and revive stale ones whose funding came back. */
export async function sweepStaleOrders(limit = 200) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(and(inArray(orders.status, ["open", "stale"]), eq(orders.chainId, deployment.chainId), sql`${orders.expiry} > now()`))
    .limit(limit);
  let changed = 0;
  for (const o of rows) {
    const f = await funded({ maker: o.maker, marketId: o.marketId, outcome: o.outcome, side: o.side, price: o.price, remaining: BigInt(o.quantity) - BigInt(o.filled) }).catch(() => null);
    if (!f) continue;
    const next = f.ok ? "open" : "stale";
    if (next !== o.status) {
      await db.update(orders).set({ status: next, statusReason: f.reason, updatedAt: new Date() }).where(eq(orders.hash, o.hash));
      changed++;
    }
  }
  return { checked: rows.length, changed };
}

/** Seeding view: the on-chain graduation check plus the market's policy, straight from the contract. */
export async function seedingStatus(marketId: number) {
  const ex = exchange();
  const id = BigInt(marketId);
  const [m, g] = await Promise.all([
    publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "getMarket", args: [id] }),
    publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "graduationCheck", args: [id] }),
  ]);
  const p = await publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "getPolicy", args: [m.policyId] });
  return {
    policyId: m.policyId,
    seedingDeadline: Number(m.seedingDeadline),
    graduatedAt: Number(m.graduatedAt),
    check: {
      bestBid: g.bestBid,
      bestAsk: g.bestAsk,
      bidDepth: g.bidDepth.toString(),
      askDepth: g.askDepth.toString(),
      seeders: g.seeders,
      spreadOk: g.spreadOk,
      depthOk: g.depthOk,
      seedersOk: g.seedersOk,
      open: g.open,
      ready: g.open && g.spreadOk && g.depthOk && g.seedersOk,
    },
    policy: {
      minBidDepth: p.minBidDepth.toString(),
      minAskDepth: p.minAskDepth.toString(),
      minSeederNotional: p.minSeederNotional.toString(),
      minSeeders: p.minSeeders,
      maxSpread: p.maxSpread,
      band: p.band,
      seedingPeriod: p.seedingPeriod,
      minRest: p.minRest,
      takerFeeBps: p.takerFeeBps,
      rebateShareBps: p.rebateShareBps,
      referralShareBps: p.referralShareBps,
      rebatePeriod: p.rebatePeriod,
      claimWindow: p.claimWindow,
      rebateCapPerMarket: p.rebateCapPerMarket.toString(),
      rebateCapPerWallet: p.rebateCapPerWallet.toString(),
      rebateBudget: p.rebateBudget.toString(),
      referralCapPerMarket: p.referralCapPerMarket.toString(),
    },
  };
}

export const SIDE = { BUY, SELL };
