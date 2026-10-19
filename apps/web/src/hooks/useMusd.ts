"use client";

import { erc20Abi } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";

/** Live MUSD balance and allowance for the protocol contract, read directly from chain. */
export function useMusd() {
  const { address } = useAccount();
  const enabled = !!address;
  const spender = deployment.marketsAddress;
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: deployment.musd, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId: deployment.chainId },
      {
        address: deployment.musd,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address!, spender ?? "0x0000000000000000000000000000000000000000"],
        chainId: deployment.chainId,
      },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });
  return {
    balance: q.data?.[0],
    allowance: q.data?.[1],
    isLoading: enabled && q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}
