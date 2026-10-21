"use client";

import { useAccount, useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, resolutionAbi } from "@/lib/contracts/abi";
import { CHAIN_STAGE, payoutFor, type MarketState } from "@/lib/market/permissions";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
/** MezonkExchange.Stage */
export const EX_STAGE = { Seeding: 0, Live: 1, Failed: 2, Closed: 3, Finalized: 4 } as const;
/** MezonkResolution.RStage */
const R_STAGE = { NotClosed: 0, AwaitingProposal: 1, Proposed: 2, Disputed: 3, Finalized: 4 } as const;

/**
 * Authoritative live state for one market, read straight from the exchange and resolution contracts.
 * Works even when the indexer/API is down, so users can always exit, get refunds and claim.
 */
export function useMarketChain(marketId: number) {
  const { address } = useAccount();
  const ex = deployment.marketsAddress;
  const res = deployment.resolutionAddress;
  const me = address ?? ZERO;
  const id = BigInt(marketId);
  const e = { address: ex!, abi: exchangeAbi, chainId: deployment.chainId } as const;
  const r = { address: res!, abi: resolutionAbi, chainId: deployment.chainId } as const;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...e, functionName: "getMarket", args: [id] },
      { ...e, functionName: "stageOf", args: [id] },
      { ...e, functionName: "sharesOf", args: [id, 0, me] },
      { ...e, functionName: "sharesOf", args: [id, 1, me] },
      { ...r, functionName: "bondCredits", args: [me] },
      { ...e, functionName: "paused" },
      { ...r, functionName: "states", args: [id] },
      { ...r, functionName: "stageOf", args: [id] },
      { ...e, functionName: "graduationCheck", args: [id] },
    ],
    query: { enabled: !!ex && !!res, refetchInterval: 8_000 },
  });
  const d = q.data;
  const ok = <T,>(i: number) => (d?.[i]?.status === "success" ? (d[i]!.result as T) : undefined);
  const raw = ok<{
    creator: string; resolver: string; arbitrator: string; createdAt: bigint; seedingDeadline: bigint; closeTime: bigint;
    graduatedAt: bigint; policyId: number; proposalWindow: number; challengeWindow: number; arbitrationWindow: number;
    finalOutcome: number; finalized: boolean; proposerBond: bigint; disputeBond: bigint; collateral: bigint; metadataHash: string;
  }>(0);
  const exStage = ok<number>(1);
  const st = ok<readonly [number, bigint, bigint, string, boolean]>(6);
  const rStage = ok<number>(7);
  const yes = ok<bigint>(2) ?? 0n;
  const no = ok<bigint>(3) ?? 0n;

  // The resolution-facing view the permission rules use.
  const market: MarketState | undefined = raw && {
    creator: raw.creator,
    resolver: raw.resolver,
    arbitrator: raw.arbitrator,
    disputer: st?.[3] ?? ZERO,
    closeTime: raw.closeTime,
    proposedAt: st?.[1] ?? 0n,
    disputedAt: st?.[2] ?? 0n,
    proposalWindow: raw.proposalWindow,
    challengeWindow: raw.challengeWindow,
    arbitrationWindow: raw.arbitrationWindow,
    proposedOutcome: st?.[0] ?? 0,
    finalOutcome: raw.finalOutcome,
    finalized: raw.finalized,
    liquidityClaimed: true,
    creatorFees: 0n,
    proposerBond: raw.proposerBond,
    disputeBond: raw.disputeBond,
    poolYes: 0n,
    poolNo: 0n,
  };
  let stage: number | undefined;
  if (exStage === EX_STAGE.Seeding || exStage === EX_STAGE.Failed) stage = CHAIN_STAGE.NotLive;
  else if (exStage === EX_STAGE.Live) stage = CHAIN_STAGE.Open;
  else if (rStage === R_STAGE.Finalized || exStage === EX_STAGE.Finalized) stage = CHAIN_STAGE.Finalized;
  else if (rStage === R_STAGE.Disputed) stage = CHAIN_STAGE.Disputed;
  else if (rStage === R_STAGE.Proposed) stage = CHAIN_STAGE.Proposed;
  else if (exStage === EX_STAGE.Closed) stage = CHAIN_STAGE.Closed;

  const g = ok<{ bestBid: number; bestAsk: number; bidDepth: bigint; askDepth: bigint; seeders: number; spreadOk: boolean; depthOk: boolean; seedersOk: boolean; open: boolean }>(8);
  return {
    market,
    raw,
    notFound: d?.[0]?.status === "failure",
    stage,
    exStage,
    graduation: g,
    yes,
    no,
    claimable: raw?.finalized ? payoutFor(raw.finalOutcome, yes, no) : 0n,
    bondCredits: ok<bigint>(4) ?? 0n,
    paused: ok<boolean>(5) ?? false,
    isLoading: q.isLoading,
    isError: q.isError,
    dataUpdatedAt: q.dataUpdatedAt,
    refetch: q.refetch,
    account: address,
  };
}

export type MarketChain = ReturnType<typeof useMarketChain>;
