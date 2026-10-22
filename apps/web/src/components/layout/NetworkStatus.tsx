"use client";

import { Status } from "@/components/ui/primitives";
import { useHealth } from "@/hooks/useHealth";
import { deployment } from "@/lib/chain/config";

/** Dot + network name. The dot colour and tooltip carry the state; the banner below the header explains problems. */
export function NetworkStatus({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, isError } = useHealth();
  // Compact (narrow headers): "Testnet" alone fits next to the wallet button on a phone.
  const name = deployment.isLocalFork ? "Local fork" : compact && deployment.chain.testnet ? "Testnet" : deployment.chain.name;
  let tone: "yes" | "warn" | "no" | "muted" = "muted";
  let text = name;
  let title = "Checking network status";
  if (isError) {
    tone = "no";
    text = compact ? "Offline" : "Data service offline";
    title = "The MEZONK API is unreachable. On-chain state is unaffected.";
  } else if (data && !isLoading) {
    if (!data.rpc.ok) {
      tone = "no";
      text = compact ? "RPC down" : `${name} · RPC unreachable`;
      title = "The Mezo RPC did not respond.";
    } else if (!data.chain.ready) {
      tone = "warn";
      text = name; // the banner under the header explains; the dot and tooltip carry the state
      title = data.chain.message;
    } else if (!data.indexer || data.indexer.stale) {
      tone = "warn";
      text = name;
      title = "Indexed data is behind the chain. Balances and trades shown from the chain are still live.";
    } else {
      tone = "yes";
      text = name;
      title = `Block ${data.rpc.blockNumber} · indexer ${data.indexer.lagBlocks ?? 0} blocks behind`;
    }
  }
  return (
    <span title={title} className="whitespace-nowrap">
      <Status tone={tone}>{text}</Status>
    </span>
  );
}
