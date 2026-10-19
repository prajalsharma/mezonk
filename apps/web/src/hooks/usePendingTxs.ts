"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { deployment } from "@/lib/chain/config";

export interface PendingTx {
  hash: `0x${string}`;
  marketId: number;
  kind: string;
  at: number;
  status: "pending" | "confirmed" | "failed";
}

const KEY = "mezonk:pending-claims";
const read = (): PendingTx[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};

/**
 * Submitted claim transactions remembered in this browser, re-checked against the chain.
 * A receipt is the only thing that moves an entry out of "pending".
 */
export function usePendingTxs() {
  const client = usePublicClient({ chainId: deployment.chainId });
  const [items, setItems] = useState<PendingTx[]>([]);
  const save = (xs: PendingTx[]) => {
    setItems(xs);
    try {
      localStorage.setItem(KEY, JSON.stringify(xs.slice(-30)));
    } catch {
      /* storage off */
    }
  };
  useEffect(() => setItems(read()), []);

  const add = useCallback((t: Omit<PendingTx, "status" | "at">) => save([...read(), { ...t, at: Date.now(), status: "pending" }]), []);

  useEffect(() => {
    if (!client || !items.some((i) => i.status === "pending")) return;
    const iv = setInterval(async () => {
      const cur = read();
      let changed = false;
      for (const t of cur.filter((x) => x.status === "pending")) {
        const r = await client.getTransactionReceipt({ hash: t.hash }).catch(() => null);
        if (r) {
          t.status = r.status === "success" ? "confirmed" : "failed";
          changed = true;
        }
      }
      if (changed) save(cur);
    }, 5000);
    return () => clearInterval(iv);
  }, [client, items]);

  return { items, add };
}
