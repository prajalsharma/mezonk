import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { deployment } from "@/lib/chain/config";
import { deriveStage } from "@/lib/market/stage";
import { buildTimeline, type TimelineEventInput } from "@/lib/market/timeline";
import { evidenceHash, parseEvidence } from "@/lib/market/evidence";
import { getDb, schema } from "@/server/db/client";
import { chainNowMs } from "@/server/chain";
import { slugsFor } from "@/server/slugs";

const { markets, trades, chainEvents, positions, resolutionProposals, disputes, indexerState, evidence, evidenceDocuments } =
  schema;

export type MarketRow = typeof markets.$inferSelect;

export interface MarketSummary {
  id: number;
  question: string;
  category: string;
  structured: boolean;
  priceYes: number;
  priceYes24hAgo: number;
  liquidity: string;
  volume: string;
  volume24h: string;
  traders24h: number;
  tradeCount: number;
  createdAt: string;
  closeTime: string;
  stage: ReturnType<typeof deriveStage>;
  finalOutcome: number | null;
  trendingScore: number;
  /** Public URL slug; null until the indexer assigns one (seconds after creation). */
  slug: string | null;
}

/**
 * Trending score (documented in docs/architecture.md):
 *   score = volume24h_MUSD × sqrt(1 + distinctTraders24h)
 * Only open markets with at least one trade in the last 24h are eligible; others score 0.
 */
export function trendingScore(volume24hWei: bigint, traders24h: number, open: boolean): number {
  if (!open || volume24hWei === 0n) return 0;
  return (Number(volume24hWei / 10n ** 12n) / 1e6) * Math.sqrt(1 + traders24h);
}

function initialPrice(m: MarketRow) {
  return m.initialYesProbBps / 10_000;
}

async function stats24h(ids: number[], now: number) {
  if (!ids.length) return new Map<number, { vol: bigint; traders: number; price24h: number | null }>();
  const db = await getDb();
  const since = new Date(now - 86_400_000);
  const agg = await db
    .select({
      marketId: trades.marketId,
      vol: sql<string>`coalesce(sum(${trades.collateral}), 0)::text`,
      traders: sql<number>`count(distinct ${trades.trader})::int`,
    })
    .from(trades)
    .where(and(inArray(trades.marketId, ids), gte(trades.blockTime, since)))
    .groupBy(trades.marketId);
  // Last price at or before 24h ago, per market.
  const before = await db
    .selectDistinctOn([trades.marketId], { marketId: trades.marketId, price: trades.priceYesAfter })
    .from(trades)
    .where(and(inArray(trades.marketId, ids), lt(trades.blockTime, since)))
    .orderBy(trades.marketId, desc(trades.blockTime), desc(trades.eventId));
  const out = new Map<number, { vol: bigint; traders: number; price24h: number | null }>();
  for (const id of ids) out.set(id, { vol: 0n, traders: 0, price24h: null });
  for (const a of agg) Object.assign(out.get(a.marketId)!, { vol: BigInt(a.vol), traders: a.traders });
  for (const b of before) out.get(b.marketId)!.price24h = b.price;
  return out;
}

function summarize(m: MarketRow, s: { vol: bigint; traders: number; price24h: number | null }, now: number): MarketSummary {
  const stage = deriveStage(m, now);
  // Before any trade older than 24h exists, compare against the opening price if the market is younger than 24h.
  const youngerThan24h = now - m.createdAt.getTime() < 86_400_000;
  const price24h = s.price24h ?? (youngerThan24h ? initialPrice(m) : m.priceYes);
  return {
    id: m.marketId,
    question: m.question,
    category: m.category,
    structured: m.structured,
    priceYes: m.priceYes,
    priceYes24hAgo: price24h,
    liquidity: m.collateral,
    volume: m.volume,
    volume24h: s.vol.toString(),
    traders24h: s.traders,
    tradeCount: m.tradeCount,
    createdAt: m.createdAt.toISOString(),
    closeTime: m.closeTime.toISOString(),
    stage,
    finalOutcome: m.finalOutcome,
    trendingScore: trendingScore(s.vol, s.traders, stage.stage === "open"),
    slug: null,
  };
}

export interface ListParams {
  q?: string;
  category?: string;
  status?: "open" | "closing" | "resolving" | "resolved" | "all";
  sort?: "trending" | "volume" | "liquidity" | "thin" | "newest" | "closing" | "movement";
  minLiquidity?: bigint;
  closesWithinHours?: number;
  creator?: string;
  limit: number;
  offset: number;
}

export async function listMarkets(p: ListParams) {
  const db = await getDb();
  const conds = [eq(markets.chainId, deployment.chainId)];
  if (p.q) {
    const like = `%${p.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(markets.question, like), ilike(markets.description, like))!);
  }
  if (p.category) conds.push(eq(markets.category, p.category));
  if (p.creator) conds.push(eq(markets.creator, p.creator.toLowerCase()));
  const rows = await db.select().from(markets).where(and(...conds));
  const now = await chainNowMs();
  const s = await stats24h(rows.map((r) => r.marketId), now);
  let list = rows.map((r) => summarize(r, s.get(r.marketId)!, now));

  list = list.filter((m) => {
    const st = m.stage.stage;
    if (p.minLiquidity && BigInt(m.liquidity) < p.minLiquidity) return false;
    if (p.closesWithinHours && (st !== "open" || new Date(m.closeTime).getTime() - now > p.closesWithinHours * 3.6e6))
      return false;
    switch (p.status ?? "all") {
      case "open":
        return st === "open";
      case "closing":
        return st === "open" && new Date(m.closeTime).getTime() - now < 48 * 3.6e6;
      case "resolving":
        return st === "closed" || st === "proposed" || st === "disputed";
      case "resolved":
        return st === "resolved" || st === "invalid";
      default:
        return true;
    }
  });

  const big = (x: string) => BigInt(x);
  const cmpBig = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);
  const sorters: Record<NonNullable<ListParams["sort"]>, (a: MarketSummary, b: MarketSummary) => number> = {
    trending: (a, b) => b.trendingScore - a.trendingScore || cmpBig(big(a.volume), big(b.volume)),
    volume: (a, b) => cmpBig(big(a.volume), big(b.volume)),
    liquidity: (a, b) => cmpBig(big(a.liquidity), big(b.liquidity)),
    thin: (a, b) => cmpBig(big(b.liquidity), big(a.liquidity)),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    closing: (a, b) => a.closeTime.localeCompare(b.closeTime),
    movement: (a, b) => Math.abs(b.priceYes - b.priceYes24hAgo) - Math.abs(a.priceYes - a.priceYes24hAgo),
  };
  list.sort(sorters[p.sort ?? "newest"]);
  const items = list.slice(p.offset, p.offset + p.limit);
  const slugs = await slugsFor(items.map((m) => m.id));
  return { total: list.length, items: items.map((m) => ({ ...m, slug: slugs.get(m.id) ?? null })) };
}

export async function getMarket(id: number) {
  const db = await getDb();
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.chainId, deployment.chainId), eq(markets.marketId, id)));
  if (!m) return null;
  const now = await chainNowMs();
  const s = await stats24h([id], now);
  const slug = (await slugsFor([id])).get(id) ?? null;
  return { row: m, summary: { ...summarize(m, s.get(id)!, now), slug } };
}

export async function getHistory(id: number) {
  const db = await getDb();
  const m = await getMarket(id);
  if (!m) return null;
  const rows = await db
    .select({ t: trades.blockTime, p: trades.priceYesAfter, tx: trades.txHash })
    .from(trades)
    .where(eq(trades.marketId, id))
    .orderBy(trades.blockTime, trades.eventId);
  return [
    { t: m.row.createdAt.toISOString(), p: m.row.initialYesProbBps / 10_000, tx: m.row.createdTx },
    ...rows.map((r) => ({ t: r.t.toISOString(), p: r.p, tx: r.tx })),
  ];
}

export async function getEvents(opts: { marketId?: number; actor?: string; limit: number; before?: number }) {
  const db = await getDb();
  const conds = [eq(chainEvents.chainId, deployment.chainId)];
  if (opts.marketId != null) conds.push(eq(chainEvents.marketId, opts.marketId));
  if (opts.actor) conds.push(eq(chainEvents.actor, opts.actor.toLowerCase()));
  if (opts.before) conds.push(lt(chainEvents.id, opts.before));
  const rows = await db
    .select({
      id: chainEvents.id,
      eventName: chainEvents.eventName,
      marketId: chainEvents.marketId,
      actor: chainEvents.actor,
      args: chainEvents.args,
      blockNumber: chainEvents.blockNumber,
      blockTime: chainEvents.blockTime,
      txHash: chainEvents.txHash,
      question: markets.question,
    })
    .from(chainEvents)
    .leftJoin(markets, eq(markets.marketId, chainEvents.marketId))
    .where(and(...conds))
    .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
    .limit(opts.limit);
  return rows.map((r) => ({
    ...r,
    blockNumber: r.blockNumber.toString(),
    blockTime: r.blockTime.toISOString(),
    // Drop the bulky metadata payload from activity feeds.
    args: r.eventName === "MarketCreated" ? { creator: (r.args as Record<string, unknown>).creator } : r.args,
  }));
}

export async function getPortfolio(account: string) {
  const db = await getDb();
  const rows = await db
    .select({ p: positions, m: markets })
    .from(positions)
    .innerJoin(markets, eq(markets.marketId, positions.marketId))
    .where(eq(positions.account, account.toLowerCase()));
  const created = await db
    .select()
    .from(markets)
    .where(and(eq(markets.chainId, deployment.chainId), eq(markets.creator, account.toLowerCase())));
  const now = await chainNowMs();
  return {
    positions: rows.map(({ p, m }) => ({
      marketId: m.marketId,
      question: m.question,
      category: m.category,
      priceYes: m.priceYes,
      poolYes: m.poolYes,
      poolNo: m.poolNo,
      feeBps: m.feeBps,
      closeTime: m.closeTime.toISOString(),
      stage: deriveStage(m, now),
      finalOutcome: m.finalOutcome,
      yesShares: p.yesShares,
      noShares: p.noShares,
      yesCost: p.yesCost,
      noCost: p.noCost,
      realizedPnl: p.realizedPnl,
      feesPaid: p.feesPaid,
      redeemed: p.redeemed,
      redeemedPayout: p.redeemedPayout,
      isCreator: p.isCreator,
    })),
    created: created.map((m) => ({
      marketId: m.marketId,
      question: m.question,
      stage: deriveStage(m, now),
      initialLiquidity: m.initialLiquidity,
      volume: m.volume,
      finalOutcome: m.finalOutcome,
    })),
  };
}

export async function getResolution(id: number) {
  const db = await getDb();
  const m = await getMarket(id);
  if (!m) return null;
  const [props, disps, community, evs] = await Promise.all([
    db.select().from(resolutionProposals).where(eq(resolutionProposals.marketId, id)),
    db.select().from(disputes).where(eq(disputes.marketId, id)),
    db.select().from(evidence).where(eq(evidence.marketId, id)).orderBy(desc(evidence.createdAt)).limit(50),
    db
      .select()
      .from(chainEvents)
      .where(and(eq(chainEvents.chainId, deployment.chainId), eq(chainEvents.marketId, id)))
      .orderBy(chainEvents.blockNumber, chainEvents.logIndex),
  ]);

  const timeline = buildTimeline(m.row, evs as TimelineEventInput[], await chainNowMs());

  // Evidence documents referenced by on-chain hashes. Each is re-verified here: keccak256(raw) must equal the hash.
  const hashes = [...new Set(timeline.flatMap((t) => (t.evidence ? [t.evidence.hash.toLowerCase()] : [])))];
  const docs = hashes.length
    ? await db.select().from(evidenceDocuments).where(inArray(evidenceDocuments.hash, hashes))
    : [];
  const documents = Object.fromEntries(
    hashes.map((h) => {
      const d = docs.find((x) => x.hash === h);
      if (!d) return [h, { status: "missing" as const }];
      const verified = evidenceHash(d.raw).toLowerCase() === h;
      return [h, { status: verified ? ("verified" as const) : ("mismatch" as const), raw: d.raw, doc: parseEvidence(d.raw) }];
    }),
  );

  return {
    stage: m.summary.stage,
    structured: m.row.structured,
    resolver: m.row.resolver,
    arbitrator: m.row.arbitrator,
    creator: m.row.creator,
    proposerBond: m.row.proposerBond,
    disputeBond: m.row.disputeBond,
    challengeWindow: m.row.challengeWindow,
    proposalWindow: m.row.proposalWindow,
    arbitrationWindow: m.row.arbitrationWindow,
    closeTime: m.row.closeTime.toISOString(),
    finalOutcome: m.row.finalOutcome,
    finalizeReason: m.row.finalizeReason,
    finalizedAt: m.row.finalizedAt?.toISOString() ?? null,
    proposals: props,
    disputes: disps,
    timeline,
    documents,
    communityEvidence: community,
    indexer: await getIndexerStatus(),
  };
}

export async function saveEvidenceDocument(raw: string, kind: string, marketId: number, author: string) {
  const db = await getDb();
  const hash = evidenceHash(raw).toLowerCase();
  await db
    .insert(evidenceDocuments)
    .values({ hash, raw, kind, marketId, author })
    .onConflictDoNothing({ target: evidenceDocuments.hash });
  return hash;
}

export async function getEvidenceDocument(hash: string) {
  const db = await getDb();
  const [d] = await db.select().from(evidenceDocuments).where(eq(evidenceDocuments.hash, hash.toLowerCase()));
  return d ?? null;
}

export async function getIndexerStatus() {
  const db = await getDb();
  const [state] = await db
    .select()
    .from(indexerState)
    .where(eq(indexerState.key, `${deployment.chainId}:${deployment.marketsAddress?.toLowerCase()}`));
  if (!state) return null;
  const lag = state.headBlock != null ? Number(state.headBlock - state.lastBlock) : null;
  return {
    lastBlock: state.lastBlock.toString(),
    headBlock: state.headBlock?.toString() ?? null,
    lagBlocks: lag,
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt?.toISOString() ?? null,
    reorgsHandled: state.reorgsHandled,
    lastReconcileAt: state.lastReconcileAt?.toISOString() ?? null,
    reconcileMismatches: (state.reconcileMismatches as unknown[] | null) ?? [],
    stale: !state.lastSuccessAt || Date.now() - state.lastSuccessAt.getTime() > 120_000,
  };
}
