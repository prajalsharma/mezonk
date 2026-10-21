"use client";

import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, type Hash } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useTx } from "@/hooks/useTx";
import { deployment } from "@/lib/chain/config";
import { evidenceHash } from "@/lib/market/evidence";
import type { EvidenceDraft } from "./EvidenceComposer";

export type Outcome = "yes" | "no" | "invalid";

/**
 * Publishes an evidence document, then (if a bond is required) approves exactly the bond,
 * then sends the contract call that commits the document hash. Each step is a separate,
 * confirmed transaction; nothing is reported as done until its receipt is mined.
 */
export interface Confirmed {
  label: string;
  hash: string;
}

export function useResolutionAction(marketId: number, onDone: (c?: Confirmed) => void) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const qc = useQueryClient();

  async function publish(kind: "proposal" | "dispute" | "arbitration", draft: EvidenceDraft, outcome?: Outcome) {
    const body = {
      v: 1,
      kind,
      marketId,
      ...(outcome ? { outcome } : {}),
      summary: draft.summary.trim(),
      links: draft.links
        .filter((l) => l.url.trim())
        .map((l) => ({ url: l.url.trim(), label: l.label.trim(), ...(l.sha256.trim() ? { sha256: l.sha256.trim() } : {}) })),
      author: address,
      createdAt: new Date().toISOString(),
    };
    const r = await fetch("/api/evidence-documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message ?? "Couldn't publish the evidence document.");
    // Never trust the server's hash: recompute it from the returned bytes.
    if (evidenceHash(j.raw).toLowerCase() !== String(j.hash).toLowerCase()) {
      throw new Error("The evidence service returned a document that does not match its hash.");
    }
    return { hash: j.hash as Hash, uri: j.uri as string };
  }

  async function ensureAllowance(amount: bigint) {
    // Bonds are held by MezonkResolution, so that is the spender (not the exchange).
    if (amount === 0n || !address || !deployment.resolutionAddress || !client) return true;
    const allowance = await client.readContract({
      address: deployment.musd,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, deployment.resolutionAddress],
    });
    if (allowance >= amount) return true;
    return tx.run({
      label: "Approve bond",
      send: () =>
        writeContractAsync({
          address: deployment.musd,
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.resolutionAddress!, amount],
          chainId: deployment.chainId,
        }),
    });
  }

  /** Returns an onConfirmed handler that refreshes data and reports the confirmed tx upward. */
  const confirmed = (label: string) => (hash: string) => refreshAll({ label, hash });

  function refreshAll(c?: Confirmed) {
    void qc.invalidateQueries({ queryKey: ["resolution", marketId] });
    void qc.invalidateQueries({ queryKey: ["markets"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
    // Ask the backend to pull the new event now rather than on its next tick.
    void fetch(`/api/markets/${marketId}/refresh`, { method: "POST" }).finally(() =>
      qc.invalidateQueries({ queryKey: ["resolution", marketId] }),
    );
    onDone(c);
  }

  return { tx, publish, ensureAllowance, refreshAll, confirmed, writeContractAsync, client, address };
}
