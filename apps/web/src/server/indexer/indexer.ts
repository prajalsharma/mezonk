import "server-only";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { BlockNotFoundError, parseEventLogs, type Address, type Hash, type PublicClient } from "viem";
import { deployment, LOG_RANGE_LIMIT } from "@/lib/chain/config";
import { exchangeAbi, protocolEventsAbi } from "@/lib/contracts/abi";
import { protocolAddresses } from "@/lib/chain/config";
import { publicClient } from "@/server/chain";
import { getDb, schema, type Db } from "@/server/db/client";
import { replayMarket, type MarketSnapshot, type StoredEvent } from "./replay";
import { linkPublishedMarket } from "@/server/governance";
import { ensureSlugs } from "@/server/slugs";
import { toJson } from "./serialize";

const {
  chainEvents,
  markets,
  trades,
  positions,
  resolutionProposals,
  disputes,
  indexerState,
  fills,
  restingOrders,
  marketGraduations,
  incentiveLedger,
  policies,
  orders,
} = schema;

export interface IndexerDeps {
  client: Pick<PublicClient, "getBlock" | "getBlockNumber" | "getLogs" | "readContract">;
  db: () => Promise<Db>;
  chainId: number;
  address: Address | null;
  deployBlock: bigint;
  /** Blocks behind head to stay. Mezo (CometBFT) has instant finality; this is defence in depth. */
  confirmations?: bigint;
}
/** Events that belong to the deployment rather than one market. */
const GLOBAL_EVENTS = new Set(["PolicyAdded", "PolicyActiveSet", "ReferrerSet", "ReferralClaimed", "SignedOrderCancelled", "MinNonceRaised"]);
/** How far back to rewind when a stored block hash no longer matches the chain. */
const REORG_REWIND = 64n;
const MAX_BLOCKS_PER_TICK = BigInt(process.env.INDEXER_MAX_BLOCKS_PER_TICK ?? "50000");
const RECONCILE_EVERY_MS = 5 * 60_000;

export interface TickResult {
  ok: boolean;
  fromBlock?: string;
  toBlock?: string;
  eventsInserted: number;
  marketsRebuilt: number;
  reorg: boolean;
  error?: string;
}

export function createIndexer(deps: IndexerDeps) {
  const { client: publicClient, chainId } = deps;
  /** The exchange plus the three contracts its constructor created. */
  const watched = (): Address[] => {
    if (!deps.address) return [];
    const p = protocolAddresses(deps.address);
    return [p.marketsAddress, p.resolutionAddress, p.factoryAddress, p.incentivesAddress];
  };
  const CONFIRMATIONS = deps.confirmations ?? BigInt(process.env.INDEXER_CONFIRMATIONS ?? "2");
  const stateKey = () => `${chainId}:${deps.address?.toLowerCase()}`;
  const getDb = deps.db;
  let running: Promise<TickResult> | null = null;

  /** Single-flight wrapper: concurrent callers share one run. */
  function runTick(): Promise<TickResult> {
    running ??= tick().finally(() => {
      running = null;
    });
    return running;
  }

  /** True when the stored block hash no longer matches the canonical chain (or the block vanished). */
  async function hashChanged(block: bigint, hash: string) {
    try {
      return (await publicClient.getBlock({ blockNumber: block })).hash !== hash;
    } catch (e) {
      if (e instanceof BlockNotFoundError) return true;
      throw e;
    }
  }

async function tick(): Promise<TickResult> {
  const address = deps.address;
  if (!address) {
    return { ok: false, eventsInserted: 0, marketsRebuilt: 0, reorg: false, error: "no-deployment" };
  }
  const db = await getDb();
  const key = stateKey();
  const now = new Date();

  let [state] = await db.select().from(indexerState).where(eq(indexerState.key, key));
  if (!state) {
    [state] = await db
      .insert(indexerState)
      .values({ key, lastBlock: deps.deployBlock > 0n ? deps.deployBlock - 1n : 0n })
      .returning();
  }
  if (!state) throw new Error("indexer state missing");

  try {
    const touched = new Set<number>();
    let globalTouched = false;
    let reorg = false;
    let lastBlock = state.lastBlock;

    // 1. Reorg check: the block we stopped at must still have the same hash.
    if (state.lastBlockHash && lastBlock > 0n) {
      if (await hashChanged(lastBlock, state.lastBlockHash)) {
        reorg = true;
        const rewindTo = lastBlock > REORG_REWIND ? lastBlock - REORG_REWIND : 0n;
        const removed = await db
          .delete(chainEvents)
          .where(and(eq(chainEvents.chainId, chainId), gte(chainEvents.blockNumber, rewindTo)))
          .returning({ marketId: chainEvents.marketId });
        removed.forEach((r) => r.marketId != null && touched.add(r.marketId));
        globalTouched = true;
        lastBlock = rewindTo - 1n;
        await db
          .update(indexerState)
          .set({ lastBlock, lastBlockHash: null, reorgsHandled: sql`${indexerState.reorgsHandled} + 1` })
          .where(eq(indexerState.key, key));
      }
    }

    // 2. Pull logs in RPC-sized chunks.
    const head = (await publicClient.getBlockNumber({ cacheTime: 0 })) - CONFIRMATIONS;
    const from = lastBlock + 1n;
    const target = head < from + MAX_BLOCKS_PER_TICK ? head : from + MAX_BLOCKS_PER_TICK - 1n;
    let inserted = 0;

    for (let start = from; start <= target; start += LOG_RANGE_LIMIT) {
      const end = start + LOG_RANGE_LIMIT - 1n > target ? target : start + LOG_RANGE_LIMIT - 1n;
      const logs = await publicClient.getLogs({ address: watched(), fromBlock: start, toBlock: end });
      const parsed = parseEventLogs({ abi: protocolEventsAbi, logs, strict: false });

      if (parsed.length) {
        const blockNums = [...new Set(parsed.map((l) => l.blockNumber!))];
        const blocks = new Map<bigint, { time: Date; hash: Hash }>();
        for (const bn of blockNums) {
          const b = await publicClient.getBlock({ blockNumber: bn });
          blocks.set(bn, { time: new Date(Number(b.timestamp) * 1000), hash: b.hash });
        }
        const rows = parsed.map((l) => {
          const args = (l.args ?? {}) as Record<string, unknown>;
          const mid = args.marketId != null ? Number(args.marketId) : null;
          const actor = (args.taker ?? args.maker ?? args.account ?? args.seeder ?? args.referrer ?? args.creator ??
            args.resolver ?? args.disputer ?? args.arbitrator ?? null) as string | null;
          if (mid != null) touched.add(mid);
          const b = blocks.get(l.blockNumber!)!;
          return {
            chainId: chainId,
            contract: l.address.toLowerCase(),
            blockNumber: l.blockNumber!,
            blockHash: l.blockHash!,
            blockTime: b.time,
            txHash: l.transactionHash!,
            logIndex: l.logIndex!,
            eventName: l.eventName ?? "Unknown",
            marketId: mid,
            actor: actor?.toLowerCase() ?? null,
            args: toJson(args) as Record<string, unknown>,
          };
        });
        const res = await db
          .insert(chainEvents)
          .values(rows)
          .onConflictDoNothing({ target: [chainEvents.chainId, chainEvents.txHash, chainEvents.logIndex] })
          .returning({ id: chainEvents.id });
        inserted += res.length;
        if (rows.some((r) => GLOBAL_EVENTS.has(r.eventName))) globalTouched = true;
      }

      const endBlock = await publicClient.getBlock({ blockNumber: end });
      await db
        .update(indexerState)
        .set({ lastBlock: end, lastBlockHash: endBlock.hash, headBlock: head + CONFIRMATIONS })
        .where(eq(indexerState.key, key));
      lastBlock = end;
    }

    // 3. Rebuild derived tables for every touched market, then deployment-wide tables.
    for (const id of touched) await rebuildMarket(id);
    if (globalTouched) await rebuildGlobal();
    await expireOrders().catch((e) => console.error("[indexer] orders", e));
    // Public slugs for new markets (and the one-time backfill for existing ones). Never rewrites a slug.
    await ensureSlugs().catch((e) => console.error("[indexer] slugs", e));

    await db
      .update(indexerState)
      .set({ lastRunAt: now, lastSuccessAt: now, lastError: null, headBlock: head + CONFIRMATIONS })
      .where(eq(indexerState.key, key));

    if (!state.lastReconcileAt || now.getTime() - state.lastReconcileAt.getTime() > RECONCILE_EVERY_MS) {
      await reconcile().catch(() => undefined);
    }

    return {
      ok: true,
      fromBlock: from.toString(),
      toBlock: lastBlock.toString(),
      eventsInserted: inserted,
      marketsRebuilt: touched.size,
      reorg,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
    await db
      .update(indexerState)
      .set({ lastRunAt: now, lastError: msg, lastErrorAt: now })
      .where(eq(indexerState.key, key));
    return { ok: false, eventsInserted: 0, marketsRebuilt: 0, reorg: false, error: msg };
  }
}

/** Parameters events don't carry (windows, bonds, arbitrator, fee), read once per rebuild from the chain. */
async function snapshot(marketId: number): Promise<MarketSnapshot | null> {
  if (!deps.address) return null;
  try {
    const m = await publicClient.readContract({ address: deps.address, abi: exchangeAbi, functionName: "getMarket", args: [BigInt(marketId)] });
    const p = await publicClient.readContract({ address: deps.address, abi: exchangeAbi, functionName: "getPolicy", args: [m.policyId] });
    const g = await publicClient.readContract({ address: deps.address, abi: exchangeAbi, functionName: "graduationCheck", args: [BigInt(marketId)] });
    return {
      arbitrator: m.arbitrator,
      proposalWindow: m.proposalWindow,
      challengeWindow: m.challengeWindow,
      arbitrationWindow: m.arbitrationWindow,
      proposerBond: m.proposerBond,
      disputeBond: m.disputeBond,
      takerFeeBps: p.takerFeeBps,
      seeders: g.seeders,
    };
  } catch {
    return null; // replay still works; the next rebuild fills these in
  }
}

/** Recompute every derived row for one market from its raw events, atomically. */
async function rebuildMarket(marketId: number) {
  const db = await getDb();
  const evs = await db
    .select()
    .from(chainEvents)
    .where(and(eq(chainEvents.chainId, chainId), eq(chainEvents.marketId, marketId)))
    .orderBy(asc(chainEvents.blockNumber), asc(chainEvents.logIndex));

  const result = replayMarket(marketId, evs as StoredEvent[], {
    chainId: chainId,
    contract: deps.address ?? "",
    snapshot: await snapshot(marketId),
  });

  await db.transaction(async (tx) => {
    await tx.delete(trades).where(eq(trades.marketId, marketId));
    await tx.delete(fills).where(eq(fills.marketId, marketId));
    await tx.delete(restingOrders).where(eq(restingOrders.marketId, marketId));
    await tx.delete(marketGraduations).where(eq(marketGraduations.marketId, marketId));
    await tx.delete(incentiveLedger).where(eq(incentiveLedger.marketId, marketId));
    await tx.delete(positions).where(eq(positions.marketId, marketId));
    await tx.delete(resolutionProposals).where(eq(resolutionProposals.marketId, marketId));
    await tx.delete(disputes).where(eq(disputes.marketId, marketId));
    if (!result) {
      await tx.delete(markets).where(eq(markets.marketId, marketId));
      return;
    }
    const row = result.market as typeof markets.$inferInsert;
    await tx.insert(markets).values(row).onConflictDoUpdate({ target: markets.marketId, set: row });
    if (result.trades.length) await tx.insert(trades).values(result.trades as (typeof trades.$inferInsert)[]);
    if (result.fills.length) await tx.insert(fills).values(result.fills as (typeof fills.$inferInsert)[]);
    if (result.resting.length) {
      await tx.insert(restingOrders).values(
        result.resting.map((o) => ({ ...o, quantity: o.quantity.toString(), remaining: o.remaining.toString() })),
      );
    }
    if (result.graduation) await tx.insert(marketGraduations).values(result.graduation as typeof marketGraduations.$inferInsert);
    if (result.incentives.length) {
      await tx.insert(incentiveLedger).values(result.incentives as (typeof incentiveLedger.$inferInsert)[]);
    }
    if (result.proposals.length) {
      await tx.insert(resolutionProposals).values(result.proposals as (typeof resolutionProposals.$inferInsert)[]);
    }
    if (result.disputes.length) await tx.insert(disputes).values(result.disputes as (typeof disputes.$inferInsert)[]);
    if (result.positions.length) {
      await tx.insert(positions).values(
        result.positions.map((p) => ({
          marketId,
          account: p.account,
          yesShares: p.yesShares.toString(),
          noShares: p.noShares.toString(),
          yesCost: p.yesCost.toString(),
          noCost: p.noCost.toString(),
          realizedPnl: p.realizedPnl.toString(),
          feesPaid: p.feesPaid.toString(),
          redeemed: p.redeemed,
          redeemedPayout: p.redeemedPayout.toString(),
          isCreator: p.isCreator,
          updatedBlock: p.updatedBlock,
        })),
      );
    }
  });

  // Governance link: the MarketApprovalUsed nonce ties this market to the proposal it was approved as.
  // Outside the transaction on purpose; a workflow-store failure must never roll back chain data.
  const used = evs.find((e) => e.eventName === "MarketApprovalUsed");
  const nonce = (used?.args as { nonce?: string } | undefined)?.nonce;
  if (nonce) await linkPublishedMarket(marketId, nonce).catch(() => undefined);

  // Signed orders whose fills appear on-chain: record the filled amount (the chain is the authority).
  const signedFills = new Map<string, bigint>();
  for (const f of result?.fills ?? []) {
    if (f.resting) continue;
    const h = String(f.orderRef).toLowerCase();
    signedFills.set(h, (signedFills.get(h) ?? 0n) + BigInt(String(f.quantity)));
  }
  for (const [hash, filled] of signedFills) {
    await db
      .update(orders)
      .set({
        filled: filled.toString(),
        status: sql`case when ${orders.quantity} <= ${filled.toString()}::numeric then 'filled' else ${orders.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(orders.hash, hash));
  }
}

/** Events without a market: policies, referrer links, referral claims, signed-order cancellations. */
async function rebuildGlobal() {
  const db = await getDb();
  const evs = await db
    .select()
    .from(chainEvents)
    .where(and(eq(chainEvents.chainId, chainId), inArray(chainEvents.eventName, [...GLOBAL_EVENTS])))
    .orderBy(asc(chainEvents.blockNumber), asc(chainEvents.logIndex));
  const pol = new Map<number, typeof policies.$inferInsert>();
  const ledger: (typeof incentiveLedger.$inferInsert)[] = [];
  const cancelled: string[] = [];
  const nonceFloor = new Map<string, bigint>();
  for (const e of evs) {
    const x = e.args as Record<string, unknown>;
    if (e.eventName === "PolicyAdded") {
      pol.set(Number(x.policyId), { policyId: Number(x.policyId), params: x.policy as object, active: true, addedAt: e.blockTime, txHash: e.txHash });
    } else if (e.eventName === "PolicyActiveSet") {
      const p = pol.get(Number(x.policyId));
      if (p) p.active = Boolean(x.active);
    } else if (e.eventName === "ReferrerSet") {
      ledger.push({ eventId: e.id, kind: "referrer_set", account: String(x.account).toLowerCase(), counterparty: String(x.referrer).toLowerCase(), amount: "0", blockTime: e.blockTime, txHash: e.txHash });
    } else if (e.eventName === "ReferralClaimed") {
      ledger.push({ eventId: e.id, kind: "referral_claimed", account: String(x.referrer).toLowerCase(), amount: String(x.amount), blockTime: e.blockTime, txHash: e.txHash });
    } else if (e.eventName === "SignedOrderCancelled") {
      cancelled.push(String(x.orderHash).toLowerCase());
    } else if (e.eventName === "MinNonceRaised") {
      nonceFloor.set(String(x.maker).toLowerCase(), BigInt(String(x.minNonce)));
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(policies);
    if (pol.size) await tx.insert(policies).values([...pol.values()]);
    await tx.delete(incentiveLedger).where(sql`${incentiveLedger.marketId} is null`);
    if (ledger.length) await tx.insert(incentiveLedger).values(ledger);
  });
  if (cancelled.length) {
    await db.update(orders).set({ status: "cancelled", statusReason: "cancelled on-chain", updatedAt: new Date() }).where(inArray(orders.hash, cancelled));
  }
  for (const [maker, floor] of nonceFloor) {
    await db
      .update(orders)
      .set({ status: "cancelled", statusReason: "nonce invalidated on-chain", updatedAt: new Date() })
      .where(and(eq(orders.maker, maker), sql`${orders.nonce} < ${floor.toString()}::numeric`, eq(orders.status, "open")));
  }
}

/** Book hygiene: expired signed orders leave the book (the contract skips them anyway). */
async function expireOrders() {
  const db = await getDb();
  await db
    .update(orders)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(orders.status, "open"), sql`${orders.expiry} <= now()`));
}

/**
 * Compare indexed collateral, escrow, graduation and finality against direct contract reads.
 * Mismatches are recorded for /api/indexer/status; they never overwrite chain data silently.
 */
async function reconcile(limit = 25, onlyIds?: number[]) {
  const address = deps.address;
  if (!address) return [];
  const db = await getDb();
  const rows = await db
    .select({
      marketId: markets.marketId,
      collateral: markets.collateral,
      graduatedAt: markets.graduatedAt,
      finalOutcome: markets.finalOutcome,
      bestBid: markets.bestBid,
      bestAsk: markets.bestAsk,
    })
    .from(markets)
    .where(onlyIds?.length ? inArray(markets.marketId, onlyIds) : eq(markets.contract, address.toLowerCase()))
    .orderBy(sql`${markets.updatedAt} desc`)
    .limit(limit);

  const mismatches: Array<{ marketId: number; field: string; indexed: string; chain: string }> = [];
  for (const r of rows) {
    const m = await publicClient.readContract({ address, abi: exchangeAbi, functionName: "getMarket", args: [BigInt(r.marketId)] });
    const [bid, ask] = await publicClient.readContract({ address, abi: exchangeAbi, functionName: "bestPrices", args: [BigInt(r.marketId)] });
    const cmp = (field: string, indexed: string, chain: string) => {
      if (indexed !== chain) mismatches.push({ marketId: r.marketId, field, indexed, chain });
    };
    cmp("collateral", r.collateral, m.collateral.toString());
    cmp("graduated", String(r.graduatedAt != null), String(m.graduatedAt > 0n));
    cmp("finalized", String(r.finalOutcome != null), String(m.finalized));
    cmp("bestBid", String(r.bestBid ?? 0), String(bid));
    cmp("bestAsk", String(r.bestAsk ?? 0), String(ask));
  }
  await db
    .update(indexerState)
    .set({ lastReconcileAt: new Date(), reconcileMismatches: mismatches })
    .where(eq(indexerState.key, stateKey()));
  return mismatches;
}

/** Full backfill: clears this deployment's events and cursor so the next ticks re-index from deploy block. */
async function resetIndex() {
  const db = await getDb();
  const ids = await db.select({ id: markets.marketId }).from(markets);
  await db.delete(chainEvents).where(eq(chainEvents.chainId, chainId));
  if (ids.length) await db.delete(markets).where(inArray(markets.marketId, ids.map((i) => i.id)));
  await db.delete(indexerState).where(eq(indexerState.key, stateKey()));
}

  return { runTick, rebuildMarket, rebuildGlobal, reconcile, resetIndex };
}

/** Production instance wired to the configured deployment. */
export const indexer = createIndexer({
  client: publicClient,
  db: getDb,
  chainId: deployment.chainId,
  address: deployment.ready ? deployment.marketsAddress : null,
  deployBlock: deployment.deployBlock,
});
export const runIndexerTick = indexer.runTick;
