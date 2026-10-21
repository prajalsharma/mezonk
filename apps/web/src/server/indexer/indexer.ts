import "server-only";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { BlockNotFoundError, parseEventLogs, type Address, type Hash, type PublicClient } from "viem";
import { deployment, LOG_RANGE_LIMIT } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { publicClient } from "@/server/chain";
import { getDb, schema, type Db } from "@/server/db/client";
import { replayMarket, type StoredEvent } from "./replay";
import { linkPublishedMarket } from "@/server/governance";
import { ensureSlugs } from "@/server/slugs";
import { toJson } from "./serialize";

const { chainEvents, markets, trades, positions, resolutionProposals, disputes, indexerState } = schema;

export interface IndexerDeps {
  client: Pick<PublicClient, "getBlock" | "getBlockNumber" | "getLogs" | "readContract">;
  db: () => Promise<Db>;
  chainId: number;
  address: Address | null;
  deployBlock: bigint;
  /** Blocks behind head to stay. Mezo (CometBFT) has instant finality; this is defence in depth. */
  confirmations?: bigint;
}
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
      const logs = await publicClient.getLogs({ address, fromBlock: start, toBlock: end });
      const parsed = parseEventLogs({ abi: mezonkMarketsAbi, logs, strict: false });

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
          const actor = (args.trader ?? args.account ?? args.creator ?? args.resolver ?? args.disputer ??
            args.arbitrator ?? null) as string | null;
          if (mid != null) touched.add(mid);
          const b = blocks.get(l.blockNumber!)!;
          return {
            chainId: chainId,
            contract: address.toLowerCase(),
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
      }

      const endBlock = await publicClient.getBlock({ blockNumber: end });
      await db
        .update(indexerState)
        .set({ lastBlock: end, lastBlockHash: endBlock.hash, headBlock: head + CONFIRMATIONS })
        .where(eq(indexerState.key, key));
      lastBlock = end;
    }

    // 3. Rebuild derived tables for every touched market.
    for (const id of touched) await rebuildMarket(id);
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
  });

  await db.transaction(async (tx) => {
    await tx.delete(trades).where(eq(trades.marketId, marketId));
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
}

/**
 * Compare indexed pools, collateral and finality against direct contract reads.
 * Mismatches are recorded for /api/indexer/status; they never overwrite chain data silently.
 */
async function reconcile(limit = 25, onlyIds?: number[]) {
  const address = deps.address;
  if (!address) return [];
  const db = await getDb();
  const rows = await db
    .select({
      marketId: markets.marketId,
      poolYes: markets.poolYes,
      poolNo: markets.poolNo,
      collateral: markets.collateral,
      finalOutcome: markets.finalOutcome,
    })
    .from(markets)
    .where(onlyIds?.length ? inArray(markets.marketId, onlyIds) : undefined)
    .orderBy(sql`${markets.updatedAt} desc`)
    .limit(limit);

  const mismatches: Array<{ marketId: number; field: string; indexed: string; chain: string }> = [];
  for (const r of rows) {
    const m = await publicClient.readContract({
      address,
      abi: mezonkMarketsAbi,
      functionName: "getMarket",
      args: [BigInt(r.marketId)],
    });
    const cmp = (field: string, indexed: string, chain: string) => {
      if (indexed !== chain) mismatches.push({ marketId: r.marketId, field, indexed, chain });
    };
    cmp("poolYes", r.poolYes, m.poolYes.toString());
    cmp("poolNo", r.poolNo, m.poolNo.toString());
    cmp("collateral", r.collateral, m.collateral.toString());
    cmp("finalized", String(r.finalOutcome != null), String(m.finalized));
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

  return { runTick, rebuildMarket, reconcile, resetIndex };
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
