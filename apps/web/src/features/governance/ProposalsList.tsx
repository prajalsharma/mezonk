"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, Segmented, Skeleton } from "@/components/ui/primitives";
import { Chip } from "@/components/ui/Select";
import { useMe, useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import type { ProposalDto } from "@/lib/governance/dto";
import { PROPOSAL_STATUS, statusLabel, type ProposalStatus } from "@/lib/governance/proposal";
import { ProposalRow } from "./ProposalBits";

type Scope = "all" | "mine" | "publish";
const PUBLIC_FILTERS: ProposalStatus[] = ["submitted", "under_review", "changes_requested", "approved", "published", "rejected"];

export function ProposalsList() {
  const params = useSearchParams();
  const session = useSession();
  const me = useMe();
  const [scope, setScope] = useState<Scope>(params.get("mine") ? "mine" : params.get("publish") ? "publish" : "all");
  const [status, setStatus] = useState<ProposalStatus | "">("");

  useEffect(() => {
    if (scope !== "all" && session.wallet && !session.signedIn) void session.ensure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, session.wallet]);

  const q = useQuery({
    queryKey: ["proposals", scope, status, session.signedIn, session.wallet],
    enabled: scope === "all" || session.signedIn,
    queryFn: () => {
      const s = new URLSearchParams({ limit: "100" });
      if (status) s.set("status", status);
      if (scope === "mine") s.set("mine", "1");
      if (scope === "publish") s.set("publish", "1");
      return scope === "all" ? apiGet<{ total: number; items: ProposalDto[] }>(`/api/proposals?${s}`) : apiAuth<{ total: number; items: ProposalDto[] }>(`/api/proposals?${s}`);
    },
    refetchInterval: 20_000,
  });

  const canPublish = !!me.data?.roles.creator;
  const options: Array<{ value: Scope; label: string }> = [
    { value: "all", label: "Everyone's" },
    { value: "mine", label: "Mine" },
    ...(canPublish ? [{ value: "publish" as const, label: "To publish" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={scope} onChange={setScope} options={options} label="Which suggestions" className="w-full sm:w-auto sm:min-w-[20rem]" />
        <ButtonLink href="/suggest" size="sm">Suggest a market</ButtonLink>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        <Chip pressed={status === ""} onClick={() => setStatus("")}>Any status</Chip>
        {(scope === "all" ? PUBLIC_FILTERS : PROPOSAL_STATUS).map((s) => (
          <Chip key={s} pressed={status === s} onClick={() => setStatus(status === s ? "" : s)}>{statusLabel[s]}</Chip>
        ))}
      </div>

      {scope !== "all" && !session.wallet && <Notice tone="info" title="Connect a wallet to see your suggestions" />}
      {scope !== "all" && session.wallet && !session.signedIn && (
        <Notice tone="info" title="Sign in to see your suggestions" action={<Button size="sm" loading={session.busy} onClick={() => session.ensure()}>Sign in</Button>}>
          {session.error ?? "One free signature, no transaction."}
        </Notice>
      )}

      {q.isLoading && (
        <ul className="space-y-3" aria-busy>
          {Array.from({ length: 5 }).map((_, i) => <li key={i}><Skeleton className="h-14" /></li>)}
        </ul>
      )}
      {q.isError && <Notice tone="error" title="Couldn't load suggestions" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Retry</Button>}>{(q.error as Error).message}</Notice>}
      {q.data && q.data.items.length === 0 && (
        <EmptyState
          title={scope === "publish" ? "Nothing approved is waiting for you" : scope === "mine" ? "You haven't suggested a market yet" : "No suggestions match"}
          action={scope !== "publish" ? <ButtonLink href="/suggest" size="sm">Suggest one</ButtonLink> : undefined}
        >
          {scope === "all" ? "Suggestions appear here once their author submits them for review." : scope === "publish" ? "Approved suggestions assigned to your wallet appear here with a publish button." : undefined}
        </EmptyState>
      )}
      {q.data && q.data.items.length > 0 && (
        <ul className="divide-y divide-line">
          {q.data.items.map((p, i) => <ProposalRow key={p.id} p={p} index={i} href={`/proposals/${p.id}`} />)}
        </ul>
      )}
    </div>
  );
}
