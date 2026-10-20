"use client";

import { useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";

/**
 * Protocol roles for a wallet, read straight from the contract. Needs no sign-in, so the UI can
 * offer role-specific entry points (Curate, Resolve, "sign in to review") before any signature.
 */
export function useOnchainRoles(address?: string) {
  const base = { address: deployment.marketsAddress!, abi: mezonkMarketsAbi, chainId: deployment.chainId } as const;
  const a = address as `0x${string}` | undefined;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...base, functionName: "isCurator", args: [a!] },
      { ...base, functionName: "isCreator", args: [a!] },
      { ...base, functionName: "isResolver", args: [a!] },
      { ...base, functionName: "owner" },
      { ...base, functionName: "config" },
    ],
    query: { enabled: deployment.ready && !!a, staleTime: 30_000 },
  });
  const r = q.data;
  const low = address?.toLowerCase();
  const cfg = r?.[4]?.result as readonly unknown[] | undefined;
  return {
    curator: r?.[0]?.result === true,
    creator: r?.[1]?.result === true,
    resolver: r?.[2]?.result === true,
    owner: !!low && String(r?.[3]?.result ?? "").toLowerCase() === low,
    arbitrator: !!low && !!cfg && String(cfg[10]).toLowerCase() === low,
    isLoading: q.isLoading,
  };
}
