import { metadataHash, parseMetadata } from "@/lib/market/metadata";

/**
 * Pure event replay. Given every stored event for one market (in chain order) it derives the
 * market row, trades, positions, proposals and disputes. No I/O, so it is unit-tested directly
 * and re-running it is always safe (idempotent rebuilds, reorg recovery).
 */

export interface StoredEvent {
  id: number;
  blockNumber: bigint;
  blockTime: Date;
  txHash: string;
  logIndex: number;
  eventName: string;
  args: Record<string, unknown>;
}

const big = (v: unknown) => BigInt(v as string);
const lower = (v: unknown) => String(v).toLowerCase();
const PRICE_SCALE = 1_000_000n;
const priceOf = (yes: bigint, no: bigint) => (yes + no === 0n ? 0 : Number((no * PRICE_SCALE) / (yes + no)) / 1e6);

export interface PositionAcc {
  account: string;
  yesShares: bigint;
  noShares: bigint;
  yesCost: bigint;
  noCost: bigint;
  realizedPnl: bigint;
  feesPaid: bigint;
  redeemed: boolean;
  redeemedPayout: bigint;
  isCreator: boolean;
  updatedBlock: bigint;
}

export interface ReplayResult {
  market: Record<string, unknown>;
  trades: Array<Record<string, unknown>>;
  positions: PositionAcc[];
  proposals: Array<Record<string, unknown>>;
  disputes: Array<Record<string, unknown>>;
}

export function replayMarket(
  marketId: number,
  events: StoredEvent[],
  ctx: { chainId: number; contract: string },
): ReplayResult | null {
  const created = events.find((e) => e.eventName === "MarketCreated");
  if (!created) return null;

  const a = created.args;
  const m = a.market as Record<string, unknown>;
  const raw = String(a.metadata);
  const meta = parseMetadata(raw);

  const market: Record<string, unknown> = {
    marketId,
    chainId: ctx.chainId,
    contract: ctx.contract.toLowerCase(),
    creator: lower(a.creator),
    resolver: lower(a.resolver),
    arbitrator: lower(m.arbitrator),
    metadataRaw: raw,
    metadataHash: String(m.metadataHash),
    // Only treat metadata as structured when it parses AND matches the on-chain hash.
    structured: !!meta && metadataHash(raw) === String(m.metadataHash),
    question: meta?.question ?? raw.slice(0, 160),
    description: meta?.description ?? "",
    category: meta?.category ?? "other",
    rules: meta?.rules ?? null,
    sourceName: meta?.source.name ?? null,
    sourceUrl: meta?.source.url ?? null,
    resolvesAt: meta ? new Date(meta.resolvesAt) : null,
    createdAt: created.blockTime,
    createdBlock: created.blockNumber,
    createdTx: created.txHash,
    closeTime: new Date(Number(m.closeTime) * 1000),
    feeBps: Number(m.feeBps),
    protocolFeeShareBps: Number(m.protocolFeeShareBps),
    proposalWindow: Number(m.proposalWindow),
    challengeWindow: Number(m.challengeWindow),
    arbitrationWindow: Number(m.arbitrationWindow),
    proposerBond: String(m.proposerBond),
    disputeBond: String(m.disputeBond),
    initialLiquidity: String(m.collateral),
    initialYesProbBps: Number(a.initialYesProbBps),
    proposedOutcome: null,
    proposedAt: null,
    challengeDeadline: null,
    disputer: null,
    disputedAt: null,
    arbitrationDeadline: null,
    finalOutcome: null,
    finalizedAt: null,
    finalizeReason: null,
  };

  let poolYes = big(m.poolYes);
  let poolNo = big(m.poolNo);
  let collateral = big(m.collateral);
  let volume = 0n;
  let lastTradeAt: Date | null = null;
  let lastBlock = created.blockNumber;

  const positions = new Map<string, PositionAcc>();
  const pos = (acct: string, block: bigint) => {
    const key = acct.toLowerCase();
    let p = positions.get(key);
    if (!p) {
      p = {
        account: key,
        yesShares: 0n,
        noShares: 0n,
        yesCost: 0n,
        noCost: 0n,
        realizedPnl: 0n,
        feesPaid: 0n,
        redeemed: false,
        redeemedPayout: 0n,
        isCreator: false,
        updatedBlock: block,
      };
      positions.set(key, p);
    }
    p.updatedBlock = block;
    return p;
  };

  // Creator's seeded outright shares are costed at the opening price of that side.
  const p0 = priceOf(poolYes, poolNo);
  const creatorPos = pos(lower(a.creator), created.blockNumber);
  creatorPos.isCreator = true;
  const cYes = big(a.creatorYes);
  const cNo = big(a.creatorNo);
  creatorPos.yesShares = cYes;
  creatorPos.noShares = cNo;
  creatorPos.yesCost = (cYes * BigInt(Math.round(p0 * 1e6))) / PRICE_SCALE;
  creatorPos.noCost = (cNo * BigInt(Math.round((1 - p0) * 1e6))) / PRICE_SCALE;

  const trades: ReplayResult["trades"] = [];
  const proposals: ReplayResult["proposals"] = [];
  const disputes: ReplayResult["disputes"] = [];
  const traders = new Set<string>();

  for (const e of events) {
    if (e.id === created.id) continue;
    lastBlock = e.blockNumber;
    const x = e.args;
    switch (e.eventName) {
      case "Trade": {
        const isYes = Boolean(x.isYes);
        const isBuy = Boolean(x.isBuy);
        const coll = big(x.collateralAmount);
        const fee = big(x.fee);
        const shares = big(x.shares);
        const trader = lower(x.trader);
        poolYes = big(x.poolYes);
        poolNo = big(x.poolNo);
        collateral = isBuy ? collateral + (coll - fee) : collateral - coll;
        volume += coll;
        lastTradeAt = e.blockTime;
        traders.add(trader);
        trades.push({
          eventId: e.id,
          marketId,
          trader,
          side: isYes ? "yes" : "no",
          isBuy,
          collateral: coll.toString(),
          fee: fee.toString(),
          shares: shares.toString(),
          poolYes: poolYes.toString(),
          poolNo: poolNo.toString(),
          priceYesAfter: priceOf(poolYes, poolNo),
          blockNumber: e.blockNumber,
          blockTime: e.blockTime,
          txHash: e.txHash,
        });
        const p = pos(trader, e.blockNumber);
        p.feesPaid += fee;
        if (isBuy) {
          if (isYes) {
            p.yesShares += shares;
            p.yesCost += coll;
          } else {
            p.noShares += shares;
            p.noCost += coll;
          }
        } else {
          const held = isYes ? p.yesShares : p.noShares;
          const cost = isYes ? p.yesCost : p.noCost;
          const removed = held === 0n ? 0n : (cost * shares) / held;
          p.realizedPnl += coll - fee - removed;
          if (isYes) {
            p.yesShares -= shares;
            p.yesCost -= removed;
          } else {
            p.noShares -= shares;
            p.noCost -= removed;
          }
        }
        break;
      }
      case "OutcomeProposed": {
        market.proposedOutcome = Number(x.outcome);
        market.proposedAt = e.blockTime;
        market.challengeDeadline = new Date(Number(x.challengeDeadline) * 1000);
        proposals.push({
          eventId: e.id,
          marketId,
          proposer: lower(x.resolver),
          outcome: Number(x.outcome),
          evidenceHash: String(x.evidenceHash),
          evidenceUri: String(x.evidenceURI ?? ""),
          challengeDeadline: new Date(Number(x.challengeDeadline) * 1000),
          txHash: e.txHash,
        });
        break;
      }
      case "OutcomeDisputed": {
        market.disputer = lower(x.disputer);
        market.disputedAt = e.blockTime;
        market.arbitrationDeadline = new Date(Number(x.arbitrationDeadline) * 1000);
        disputes.push({
          eventId: e.id,
          marketId,
          disputer: lower(x.disputer),
          evidenceHash: String(x.evidenceHash),
          evidenceUri: String(x.evidenceURI ?? ""),
          arbitrationDeadline: new Date(Number(x.arbitrationDeadline) * 1000),
          ruling: null,
          txHash: e.txHash,
        });
        break;
      }
      case "DisputeArbitrated": {
        const d = disputes[disputes.length - 1];
        if (d) d.ruling = Number(x.outcome);
        break;
      }
      case "MarketFinalized": {
        market.finalOutcome = Number(x.outcome);
        market.finalizedAt = e.blockTime;
        market.finalizeReason = Number(x.reason);
        break;
      }
      case "Redeemed": {
        const p = pos(lower(x.account), e.blockNumber);
        const payout = big(x.payout);
        collateral -= payout;
        p.realizedPnl += payout - p.yesCost - p.noCost;
        p.yesShares = 0n;
        p.noShares = 0n;
        p.yesCost = 0n;
        p.noCost = 0n;
        p.redeemed = true;
        p.redeemedPayout += payout;
        break;
      }
      case "LiquidityClaimed": {
        collateral -= big(x.payout);
        poolYes = 0n;
        poolNo = 0n;
        break;
      }
      default:
        break;
    }
  }

  Object.assign(market, {
    poolYes: poolYes.toString(),
    poolNo: poolNo.toString(),
    collateral: collateral.toString(),
    // After LP withdrawal the pool is empty; keep the last traded price for display.
    priceYes: poolYes + poolNo === 0n ? (trades.at(-1)?.priceYesAfter ?? p0) : priceOf(poolYes, poolNo),
    volume: volume.toString(),
    tradeCount: trades.length,
    traderCount: traders.size,
    lastTradeAt,
    lastEventBlock: lastBlock,
    updatedAt: new Date(),
  });

  return { market, trades, positions: [...positions.values()], proposals, disputes };
}
