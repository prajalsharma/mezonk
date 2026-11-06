"use client";

import { useQuery } from "@tanstack/react-query";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { KeyValue, Notice, Skeleton, Status } from "@/components/ui/primitives";
import { useHealth } from "@/hooks/useHealth";
import { apiGet } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";

interface IndexerStatus {
  status: null | {
    lastBlock: string;
    headBlock: string | null;
    lagBlocks: number | null;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    reorgsHandled: number;
    lastReconcileAt: string | null;
    reconcileMismatches: Array<{ marketId: number; field: string; indexed: string; chain: string }>;
    stale: boolean;
  };
}

const ago = (s: string | null) => (s ? relativeTime(new Date(s)) : "never");

export function StatusView() {
  const h = useHealth();
  const idx = useQuery({ queryKey: ["indexer-status"], queryFn: () => apiGet<IndexerStatus>("/api/indexer/status"), refetchInterval: 15_000 });
  if (h.isLoading) return <Skeleton className="h-64 w-full" />;
  if (h.isError || !h.data) {
    return <Notice tone="error" title="The status API is unreachable">The site&apos;s backend is down. The contract and your funds are unaffected; you can still interact with the contract directly.</Notice>;
  }
  const d = h.data;
  const s = idx.data?.status;
  const row = (ok: boolean, label: string, warn = false) => <Status tone={ok ? "yes" : warn ? "warn" : "no"}>{label}</Status>;
  return (
    <div className="space-y-6">
      <Notice tone={d.ok ? "success" : "warn"} title={d.ok ? "All systems working" : "Something needs attention"}>
        {d.ok ? "Chain, contract, database and indexer are all reachable and current." : "See the details below. On-chain state is always authoritative."}
      </Notice>
      <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
        <KeyValue label="Network">{d.chain.localFork ? `Local fork of ${d.chain.name}` : d.chain.name} · chain {d.chain.chainId}</KeyValue>
        <KeyValue label="RPC">{row(d.rpc.ok, d.rpc.ok ? `Block ${d.rpc.blockNumber} · ${d.rpc.latencyMs} ms` : "Unreachable")}</KeyValue>
        <KeyValue label="Market contract">{d.chain.contract ? <Address address={d.chain.contract} label="Contract" /> : row(false, "Not deployed", true)}</KeyValue>
        <KeyValue label="Trading">{row(d.chain.ready, d.chain.ready ? "Available" : d.chain.message, true)}</KeyValue>
        <KeyValue label="Database">{row(d.db.ok, d.db.ok ? "Connected" : "Unreachable")}</KeyValue>
      </dl>
      <h2 className="text-xl font-semibold">Indexer</h2>
      {!s ? (
        <p className="text-sm text-ink-2">The indexer hasn&apos;t run yet for this deployment.</p>
      ) : (
        <>
          <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
            <KeyValue label="State">{row(!s.stale && !s.lastError, s.stale ? "Behind" : s.lastError ? "Erroring" : "Current", s.stale)}</KeyValue>
            <KeyValue label="Indexed block · chain head">{s.lastBlock} · {s.headBlock ?? "—"}</KeyValue>
            <KeyValue label="Lag">{s.lagBlocks ?? "—"} blocks</KeyValue>
            <KeyValue label="Last successful run">{ago(s.lastSuccessAt)}</KeyValue>
            <KeyValue label="Last error">{s.lastError ? `${ago(s.lastErrorAt)}: ${s.lastError.slice(0, 120)}` : "None"}</KeyValue>
            <KeyValue label="Reorgs handled">{s.reorgsHandled}</KeyValue>
            <KeyValue label="Last reconciliation with contract">{ago(s.lastReconcileAt)}</KeyValue>
            <KeyValue label="Mismatches found">{s.reconcileMismatches.length}</KeyValue>
          </dl>
          {s.reconcileMismatches.length > 0 && (
            <Notice tone="warn" title="Indexed data differs from the contract">
              <ul className="space-y-1 font-mono text-xs">
                {s.reconcileMismatches.slice(0, 10).map((m) => (
                  <li key={`${m.marketId}-${m.field}`}>market #{m.marketId} {m.field}: indexed {m.indexed}, chain {m.chain}</li>
                ))}
              </ul>
              <p className="mt-1">Market pages read these values from the chain directly, so trading and claims are unaffected.</p>
            </Notice>
          )}
        </>
      )}
      <Button variant="secondary" size="sm" onClick={() => { void h.refetch(); void idx.refetch(); }}>Check again</Button>
    </div>
  );
}
