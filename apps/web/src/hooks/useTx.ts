"use client";

import { useCallback, useState } from "react";
import type { Hash } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { deployment, explorerTx } from "@/lib/chain/config";
import { explainError } from "@/lib/contracts/errors";

export type TxPhase =
  | "idle"
  | "validating"
  | "awaiting-wallet"
  | "confirming"
  | "confirmed"
  | "failed"
  | "replaced";

export interface TxState {
  phase: TxPhase;
  hash?: Hash;
  error?: string;
  label?: string;
}

export const phaseText: Record<TxPhase, string> = {
  idle: "",
  validating: "Checking the latest quote…",
  "awaiting-wallet": "Confirm in your wallet…",
  confirming: "Submitted. Waiting for confirmation…",
  confirmed: "Confirmed on-chain.",
  failed: "Transaction failed.",
  replaced: "Transaction was replaced in your wallet.",
};

/**
 * Explicit transaction state machine. Success is only reported after the receipt
 * is mined with status "success". `validate` runs right before the wallet prompt
 * (fresh quote, allowance, balance) and may throw to abort with a message.
 */
export function useTx() {
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const client = usePublicClient({ chainId: deployment.chainId });
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const run = useCallback(
    async (opts: {
      label: string;
      validate?: () => Promise<void>;
      send: () => Promise<Hash>;
      onConfirmed?: (hash: Hash) => void;
    }): Promise<boolean> => {
      if (!isConnected) {
        setState({ phase: "failed", error: "Connect a wallet first.", label: opts.label });
        return false;
      }
      try {
        if (chainId !== deployment.chainId) {
          await switchChainAsync({ chainId: deployment.chainId });
        }
        setState({ phase: "validating", label: opts.label });
        if (opts.validate) await opts.validate();
        setState({ phase: "awaiting-wallet", label: opts.label });
        const hash = await opts.send();
        setState({ phase: "confirming", hash, label: opts.label });
        let replacedBy: Hash | undefined;
        const receipt = await client!.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 180_000,
          onReplaced: (r) => {
            if (r.reason !== "repriced") replacedBy = r.transaction.hash;
          },
        });
        if (replacedBy) {
          setState({ phase: "replaced", hash: replacedBy, label: opts.label, error: "Your wallet replaced or cancelled this transaction." });
          return false;
        }
        if (receipt.status !== "success") {
          setState({ phase: "failed", hash, label: opts.label, error: "The transaction reverted on-chain. No funds moved." });
          return false;
        }
        setState({ phase: "confirmed", hash: receipt.transactionHash, label: opts.label });
        opts.onConfirmed?.(receipt.transactionHash);
        return true;
      } catch (e) {
        setState((s) => ({ phase: "failed", hash: s.hash, label: opts.label, error: explainError(e) }));
        return false;
      }
    },
    [chainId, client, isConnected, switchChainAsync],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  const busy = state.phase === "validating" || state.phase === "awaiting-wallet" || state.phase === "confirming";
  return { state, run, reset, busy, explorer: state.hash ? explorerTx(state.hash) : undefined };
}
