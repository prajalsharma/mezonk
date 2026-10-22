"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useBalance, usePublicClient } from "wagmi";
import { deployment } from "@/lib/chain/config";
import { MEZO_BORROW, readBorrowParams, readTrove } from "@/lib/mezo/borrow";

/** Mezo's borrowing contracts on the configured network, or null where we haven't verified them (unknown chains). */
export const mezoBorrow = MEZO_BORROW[deployment.chainId] ?? null;

/**
 * Live Mezo loan state for the connected wallet: protocol parameters (price, fee, minimums), the wallet's loan, and
 * its BTC balance. Everything comes from chain; nothing is cached across a transaction (prepareOpen re-reads).
 */
export function useMezoLoan() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const enabled = !!mezoBorrow && !!client;
  const params = useQuery({
    queryKey: ["mezo-borrow-params", deployment.chainId],
    queryFn: () => readBorrowParams(client!, mezoBorrow!),
    enabled,
    refetchInterval: 30_000,
    retry: 1,
  });
  const trove = useQuery({
    queryKey: ["mezo-trove", deployment.chainId, address],
    queryFn: () => readTrove(client!, mezoBorrow!, address!),
    enabled: enabled && !!address,
    refetchInterval: 30_000,
    retry: 1,
  });
  const btc = useBalance({ address, chainId: deployment.chainId, query: { enabled: !!address, refetchInterval: 15_000 } });
  return { params, trove, btc: btc.data?.value, refetchBtc: btc.refetch };
}
