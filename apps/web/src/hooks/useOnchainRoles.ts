"use client";

import { useReadContracts } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, factoryAbi } from "@/lib/contracts/abi";

/**
 * Protocol roles for a wallet, read straight from the factory and exchange. Needs no sign-in, so the UI can
 * offer role-specific entry points (Curate, Resolve, "sign in to review") before any signature.
 */
export function useOnchainRoles(address?: string) {
  const f = { address: deployment.factoryAddress!, abi: factoryAbi, chainId: deployment.chainId } as const;
  const a = address as `0x${string}` | undefined;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...f, functionName: "isCurator", args: [a!] },
      { ...f, functionName: "isCreator", args: [a!] },
      { ...f, functionName: "isResolver", args: [a!] },
      { address: deployment.marketsAddress!, abi: exchangeAbi, chainId: deployment.chainId, functionName: "owner" },
      { ...f, functionName: "config" },
    ],
    query: { enabled: deployment.ready && !!a, staleTime: 30_000 },
  });
  const r = q.data;
  const low = address?.toLowerCase();
  const cfg = r?.[4]?.result as { arbitrator?: string } | undefined;
  return {
    curator: r?.[0]?.result === true,
    creator: r?.[1]?.result === true,
    resolver: r?.[2]?.result === true,
    owner: !!low && String(r?.[3]?.result ?? "").toLowerCase() === low,
    arbitrator: !!low && String(cfg?.arbitrator ?? "").toLowerCase() === low,
    isLoading: q.isLoading,
  };
}
