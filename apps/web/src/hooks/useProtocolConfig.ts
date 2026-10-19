"use client";

import { useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";

export interface ProtocolConfig {
  feeBps: number;
  protocolFeeShareBps: number;
  minDuration: number;
  maxDuration: number;
  proposalWindow: number;
  challengeWindow: number;
  arbitrationWindow: number;
  minLiquidity: bigint;
  proposerBond: bigint;
  disputeBond: bigint;
  arbitrator: `0x${string}`;
}

/** Live protocol parameters for new markets, read from the contract. */
export function useProtocolConfig() {
  const base = { address: deployment.marketsAddress!, abi: mezonkMarketsAbi, chainId: deployment.chainId } as const;
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...base, functionName: "config" },
      { ...base, functionName: "paused" },
      { ...base, functionName: "MAX_METADATA_BYTES" },
    ],
    query: { enabled: deployment.ready, refetchInterval: 60_000 },
  });
  const c = q.data?.[0] as readonly [number, number, number, number, number, number, number, bigint, bigint, bigint, `0x${string}`] | undefined;
  const config: ProtocolConfig | undefined = c && {
    feeBps: c[0],
    protocolFeeShareBps: c[1],
    minDuration: c[2],
    maxDuration: c[3],
    proposalWindow: c[4],
    challengeWindow: c[5],
    arbitrationWindow: c[6],
    minLiquidity: c[7],
    proposerBond: c[8],
    disputeBond: c[9],
    arbitrator: c[10],
  };
  return {
    config,
    paused: q.data?.[1] as boolean | undefined,
    maxMetadataBytes: q.data?.[2] !== undefined ? Number(q.data[2]) : 8192,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
