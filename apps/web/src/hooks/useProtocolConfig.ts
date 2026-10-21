"use client";

import { useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, factoryAbi } from "@/lib/contracts/abi";

export interface ProtocolConfig {
  minLiveDuration: number;
  maxDuration: number;
  proposalWindow: number;
  challengeWindow: number;
  arbitrationWindow: number;
  proposerBond: bigint;
  disputeBond: bigint;
  arbitrator: `0x${string}`;
}

/** Live publication/resolution parameters for new markets (factory) and the pause flag (exchange). */
export function useProtocolConfig() {
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: deployment.factoryAddress!, abi: factoryAbi, chainId: deployment.chainId, functionName: "config" },
      { address: deployment.marketsAddress!, abi: exchangeAbi, chainId: deployment.chainId, functionName: "paused" },
      { address: deployment.factoryAddress!, abi: factoryAbi, chainId: deployment.chainId, functionName: "MAX_METADATA_BYTES" },
    ],
    query: { enabled: deployment.ready, refetchInterval: 60_000 },
  });
  return {
    config: q.data?.[0] as ProtocolConfig | undefined,
    paused: q.data?.[1] as boolean | undefined,
    maxMetadataBytes: q.data?.[2] !== undefined ? Number(q.data[2]) : 8192,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}

/** The newest policy on-chain (what a new approval would most likely bind) and whether it is active. */
export function useLatestPolicy() {
  const e = { address: deployment.marketsAddress!, abi: exchangeAbi, chainId: deployment.chainId } as const;
  const count = useReadContracts({ allowFailure: false, contracts: [{ ...e, functionName: "policyCount" }], query: { enabled: deployment.ready } });
  const id = (count.data?.[0] as number | undefined) ?? 0;
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...e, functionName: "getPolicy", args: [id] },
      { ...e, functionName: "policyActive", args: [id] },
    ],
    query: { enabled: deployment.ready && id > 0 },
  });
  return { id, policy: q.data?.[0], active: q.data?.[1] as boolean | undefined, isLoading: count.isLoading || q.isLoading };
}
