import { metadataHash, parseMetadata } from "@/lib/market/metadata";
import { yesPriceOf } from "@/lib/orderbook/math";

/**
 * Pure event replay for one order-book market. Given every stored event for that market (from the exchange,
 * factory, resolution and incentives contracts, in chain order) it derives the market row, taker trades,
 * maker-level fills, resting (escrowed) orders, positions, proposals and disputes. No I/O, so it is unit-tested
 * directly and re-running it is always safe (idempotent rebuilds, reorg recovery).
 *
 * All amounts are bigint. Prices are whole cents. Floats appear only in display-only ratios.
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

/** Per-market parameters not carried by events, read from `getMarket` at rebuild time. */
export interface MarketSnapshot {
  arbitrator: string;
  proposalWindow: number;
  challengeWindow: number;
  arbitrationWindow: number;
  proposerBond: bigint;
  disputeBond: bigint;
  takerFeeBps: number;
  seeders?: number;
}

const big = (v: unknown) => BigInt(v as string);
const lower = (v: unknown) => String(v).toLowerCase();
const cost = (q: bigint, cents: number) => (q * BigInt(cents)) / 100n;

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

export interface RestingAcc {
  orderId: number;
  marketId: number;
  maker: string;
  outcome: number;
  side: number;
  price: number;
  quantity: bigint;
  remaining: bigint;
  seed: boolean;
  status: "open" | "filled" | "cancelled";
  placedAt: Date;
  placedTx: string;
  closedAt: Date | null;
  closedTx: string | null;
}

export interface ReplayResult {
  market: Record<string, unknown>;
  trades: Array<Record<string, unknown>>;
  fills: Array<Record<string, unknown>>;
  resting: RestingAcc[];
  positions: PositionAcc[];
  proposals: Array<Record<string, unknown>>;
  disputes: Array<Record<string, unknown>>;
  graduation: Record<string, unknown> | null;
  incentives: Array<Record<string, unknown>>;
}

export function replayMarket(
  marketId: number,
  events: StoredEvent[],
  ctx: { chainId: number; contract: string; snapshot?: MarketSnapshot | null },
): ReplayResult | null {
  events = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  const created = events.find((e) => e.eventName === "MarketCreated");
  if (!created) return null;

  const a = created.args;
  const raw = String(a.metadata);
  const meta = parseMetadata(raw);
  const snap = ctx.snapshot;

  const market: Record<string, unknown> = {
    marketId,
    chainId: ctx.chainId,
    contract: ctx.contract.toLowerCase(),
    creator: lower(a.creator),
    resolver: lower(a.resolver),
    arbitrator: snap?.arbitrator.toLowerCase() ?? "",
    metadataRaw: raw,
    metadataHash: String(a.metadataHash),
    // Only treat metadata as structured when it parses AND matches the on-chain hash.
    structured: !!meta && metadataHash(raw) === String(a.metadataHash),
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
    closeTime: new Date(Number(a.closeTime) * 1000),
    seedingDeadline: new Date(Number(a.seedingDeadline) * 1000),
    policyId: Number(a.policyId),
    graduatedAt: null,
    feeBps: snap?.takerFeeBps ?? 0,
    protocolFeeShareBps: null,
    proposalWindow: snap?.proposalWindow ?? 0,
    challengeWindow: snap?.challengeWindow ?? 0,
    arbitrationWindow: snap?.arbitrationWindow ?? 0,
    proposerBond: (snap?.proposerBond ?? 0n).toString(),
    disputeBond: (snap?.disputeBond ?? 0n).toString(),
    initialLiquidity: null,
    initialYesProbBps: null,
    poolYes: null,
    poolNo: null,
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

  let collateral = 0n;
  let volume = 0n;
  let lastPrice: number | null = null;
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
  /** Add `q` shares of `outcome` at total cost `c` (average-cost basis). */
  const acquire = (p: PositionAcc, outcome: number, q: bigint, c: bigint) => {
    if (outcome === 0) {
      p.yesShares += q;
      p.yesCost += c;
    } else {
      p.noShares += q;
      p.noCost += c;
    }
  };
  /** Remove `q` shares of `outcome`; returns the cost basis removed. */
  const release = (p: PositionAcc, outcome: number, q: bigint) => {
    const held = outcome === 0 ? p.yesShares : p.noShares;
    const basis = outcome === 0 ? p.yesCost : p.noCost;
    const removed = held === 0n ? 0n : (basis * (q > held ? held : q)) / held;
    if (outcome === 0) {
      p.yesShares -= q;
      p.yesCost -= removed;
    } else {
      p.noShares -= q;
      p.noCost -= removed;
    }
    return removed;
  };

  const trades: ReplayResult["trades"] = [];
  const fills: ReplayResult["fills"] = [];
  const resting = new Map<number, RestingAcc>();
  const proposals: ReplayResult["proposals"] = [];
  const disputes: ReplayResult["disputes"] = [];
  const incentives: ReplayResult["incentives"] = [];
  let graduation: ReplayResult["graduation"] = null;
  const traders = new Set<string>();

  for (const e of events) {
    if (e.id === created.id) continue;
    lastBlock = e.blockNumber;
    const x = e.args;
    switch (e.eventName) {
      case "Graduated": {
        market.graduatedAt = e.blockTime;
        graduation = {
          marketId,
          policyId: Number(market.policyId),
          bestBid: Number(x.bestBid),
          bestAsk: Number(x.bestAsk),
          bidDepth: String(x.bidDepth),
          askDepth: String(x.askDepth),
          seeders: Number(x.seeders),
          blockTime: e.blockTime,
          txHash: e.txHash,
        };
        break;
      }
      case "OrderPlaced": {
        const id = Number(x.orderId);
        resting.set(id, {
          orderId: id,
          marketId,
          maker: lower(x.maker),
          outcome: Number(x.outcome),
          side: Number(x.side),
          price: Number(x.price),
          quantity: big(x.quantity),
          remaining: big(x.quantity),
          seed: Boolean(x.seed),
          status: "open",
          placedAt: e.blockTime,
          placedTx: e.txHash,
          closedAt: null,
          closedTx: null,
        });
        break;
      }
      case "OrderCancelled": {
        const o = resting.get(Number(x.orderId));
        if (o) {
          o.remaining = 0n;
          o.status = "cancelled";
          o.closedAt = e.blockTime;
          o.closedTx = e.txHash;
        }
        break;
      }
      case "Fill": {
        const maker = lower(x.maker);
        const taker = lower(x.taker);
        const mo = Number(x.makerOutcome);
        const ms = Number(x.makerSide); // 0 buy, 1 sell
        const p = Number(x.makerPrice);
        const q = big(x.quantity);
        const complement = Boolean(x.complement);
        const fee = big(x.takerFee);
        const yp = yesPriceOf(mo, p);
        traders.add(maker);
        traders.add(taker);
        lastPrice = yp;
        lastTradeAt = e.blockTime;
        if (Boolean(x.resting)) {
          const o = resting.get(Number(BigInt(String(x.orderRef))));
          if (o) {
            o.remaining -= q;
            if (o.remaining === 0n) {
              o.status = "filled";
              o.closedAt = e.blockTime;
              o.closedTx = e.txHash;
            }
          }
        }
        fills.push({
          eventId: e.id,
          marketId,
          orderRef: String(x.orderRef),
          resting: Boolean(x.resting),
          maker,
          taker,
          makerOutcome: mo,
          makerSide: ms,
          makerPrice: p,
          quantity: q.toString(),
          complement,
          takerFee: fee.toString(),
          yesPrice: yp,
          blockNumber: e.blockNumber,
          blockTime: e.blockTime,
          txHash: e.txHash,
        });

        const mp = pos(maker, e.blockNumber);
        const tp = pos(taker, e.blockNumber);
        const makerCash = cost(q, p);
        const otherCash = cost(q, 100 - p);
        tp.feesPaid += fee;
        if (ms === 0) {
          acquire(mp, mo, q, makerCash); // maker bought `mo` at p
          if (!complement) {
            // taker sold `mo` at p
            tp.realizedPnl += makerCash - fee - release(tp, mo, q);
          } else {
            acquire(tp, 1 - mo, q, otherCash + fee); // taker bought the other side; set minted
            collateral += q;
          }
        } else {
          mp.realizedPnl += makerCash - release(mp, mo, q); // maker sold `mo` at p
          if (!complement) {
            acquire(tp, mo, q, makerCash + fee);
          } else {
            tp.realizedPnl += otherCash - fee - release(tp, 1 - mo, q); // taker sold the other side; set merged
            collateral -= q;
          }
        }
        break;
      }
      case "TakeSettled": {
        const taker = lower(x.taker);
        const filled = big(x.filled);
        const notional = big(x.notional);
        const outcome = Number(x.outcome);
        // Average price of the taker's outcome, display only.
        const avg = filled === 0n ? 0 : Number((notional * 1_000_000n) / filled) / 1e6;
        volume += notional;
        trades.push({
          eventId: e.id,
          marketId,
          trader: taker,
          side: outcome === 0 ? "yes" : "no",
          isBuy: Number(x.side) === 0,
          collateral: notional.toString(),
          fee: String(x.fee),
          shares: filled.toString(),
          poolYes: null,
          poolNo: null,
          priceYesAfter: outcome === 0 ? avg : 1 - avg,
          blockNumber: e.blockNumber,
          blockTime: e.blockTime,
          txHash: e.txHash,
        });
        break;
      }
      case "Split": {
        const q = big(x.amount);
        const p = pos(lower(x.account), e.blockNumber);
        // A complete set costs exactly 1; split the basis evenly between the two sides.
        acquire(p, 0, q, q / 2n);
        acquire(p, 1, q, q - q / 2n);
        collateral += q;
        break;
      }
      case "Merged": {
        const q = big(x.amount);
        const p = pos(lower(x.account), e.blockNumber);
        p.realizedPnl += q - release(p, 0, q) - release(p, 1, q);
        collateral -= q;
        break;
      }
      case "SharesTransferred": {
        const q = big(x.amount);
        const o = Number(x.outcome);
        const from = pos(lower(x.from), e.blockNumber);
        const moved = release(from, o, q);
        acquire(pos(lower(x.to), e.blockNumber), o, q, moved);
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
          rulingRationaleHash: null,
          rulingRationaleUri: null,
          rulingTxHash: null,
          txHash: e.txHash,
        });
        break;
      }
      case "DisputeArbitrated": {
        const d = disputes[disputes.length - 1];
        if (d) {
          d.ruling = Number(x.outcome);
          d.rulingRationaleHash = String(x.rationaleHash ?? "");
          d.rulingRationaleUri = String(x.rationaleURI ?? "");
          d.rulingTxHash = e.txHash;
        }
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
        // Only free shares are burned; escrowed sell orders must be cancelled first (they return to free).
        const y = big(x.yesBurned);
        const n = big(x.noBurned);
        p.realizedPnl += payout - release(p, 0, y) - release(p, 1, n);
        p.redeemed = true;
        p.redeemedPayout += payout;
        break;
      }
      case "RebateAccrued":
      case "RebateClaimed":
      case "RebatesSwept":
      case "ReferralAccrued": {
        const kind = { RebateAccrued: "rebate_accrued", RebateClaimed: "rebate_claimed", RebatesSwept: "rebates_swept", ReferralAccrued: "referral_accrued" }[e.eventName]!;
        incentives.push({
          eventId: e.id,
          kind,
          marketId,
          account: x.seeder ? lower(x.seeder) : x.referrer ? lower(x.referrer) : null,
          counterparty: null,
          amount: String(x.amount ?? "0"),
          blockTime: e.blockTime,
          txHash: e.txHash,
        });
        break;
      }
      default:
        break;
    }
  }

  // Resting book summary (escrowed orders only), in YES-price terms.
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  let escrowed = 0n;
  let seedOrders = 0;
  const seedMakers = new Set<string>();
  for (const o of resting.values()) {
    if (o.seed) {
      seedOrders++;
      if (o.status === "open" || market.graduatedAt) seedMakers.add(o.maker);
    }
    if (o.status !== "open" || o.remaining === 0n) continue;
    if (o.side === 0) escrowed += cost(o.remaining, o.price);
    const y = yesPriceOf(o.outcome, o.price);
    const isBid = (o.outcome === 0) === (o.side === 0);
    if (isBid) bestBid = bestBid == null ? y : Math.max(bestBid, y);
    else bestAsk = bestAsk == null ? y : Math.min(bestAsk, y);
  }

  Object.assign(market, {
    collateral: collateral.toString(),
    priceYes: lastPrice == null ? null : lastPrice / 100,
    bestBid,
    bestAsk,
    escrowed: escrowed.toString(),
    seedOrderCount: seedOrders,
    seederCount: snap?.seeders ?? seedMakers.size,
    volume: volume.toString(),
    tradeCount: trades.length,
    traderCount: traders.size,
    lastTradeAt,
    lastEventBlock: lastBlock,
    updatedAt: new Date(),
  });

  return {
    market,
    trades,
    fills,
    resting: [...resting.values()],
    positions: [...positions.values()],
    proposals,
    disputes,
    graduation,
    incentives,
  };
}
