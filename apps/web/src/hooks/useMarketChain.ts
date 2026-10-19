"use client";

import { useAccount, useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/**
 * Authoritative live state for one market, read straight from the contract.
 * Works even when the indexer/API is down, so users can always trade out and claim.
 */
export function useMarketChain(marketId: number) {
  const { address } = useAccount();
  const addr = deployment.marketsAddress;
  const me = address ?? ZERO;
  const id = BigInt(marketId);
  const base = { address: addr!, abi: mezonkMarketsAbi, chainId: deployment.chainId } as const;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...base, functionName: "getMarket", args: [id] },
      { ...base, functionName: "stageOf", args: [id] },
      { ...base, functionName: "yesBalance", args: [id, me] },
      { ...base, functionName: "noBalance", args: [id, me] },
      { ...base, functionName: "claimable", args: [id, me] },
      { ...base, functionName: "bondCredits", args: [me] },
      { ...base, functionName: "paused" },
    ],
    query: { enabled: !!addr, refetchInterval: 8_000 },
  });
  const r = q.data;
  const market = r?.[0]?.status === "success" ? r[0].result : undefined;
  const notFound = r?.[0]?.status === "failure";
  return {
    market,
    notFound,
    stage: r?.[1]?.status === "success" ? (r[1].result as number) : undefined,
    yes: r?.[2]?.status === "success" ? (r[2].result as bigint) : 0n,
    no: r?.[3]?.status === "success" ? (r[3].result as bigint) : 0n,
    claimable: r?.[4]?.status === "success" ? (r[4].result as bigint) : 0n,
    bondCredits: r?.[5]?.status === "success" ? (r[5].result as bigint) : 0n,
    paused: r?.[6]?.status === "success" ? (r[6].result as boolean) : false,
    isLoading: q.isLoading,
    isError: q.isError,
    dataUpdatedAt: q.dataUpdatedAt,
    refetch: q.refetch,
    account: address,
  };
}

export type MarketChain = ReturnType<typeof useMarketChain>;
