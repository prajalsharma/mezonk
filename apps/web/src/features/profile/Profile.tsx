"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, Skeleton } from "@/components/ui/primitives";
import { MarketList } from "@/components/markets/MarketList";
import { useMarkets } from "@/hooks/useMarkets";
import { apiGet } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import type { ProposalDto } from "@/lib/governance/dto";
import { ProposalRow } from "@/features/governance/ProposalBits";

/**
 * Public profile. Reputation here means review outcomes and resolution conduct, never trading profit:
 * approved suggestions, published markets, and markets this wallet resolved that stood unchallenged.
 */
export function Profile({ address }: { address: string }) {
  const { address: you } = useAccount();
  const proposals = useQuery({
    queryKey: ["proposals", "author", address],
    queryFn: () => apiGet<{ items: ProposalDto[] }>(`/api/proposals?author=${address}&limit=100`),
  });
  const created = useMarkets({ creator: address, limit: 50, sort: "newest" });
  const base = { address: deployment.marketsAddress!, abi: mezonkMarketsAbi, chainId: deployment.chainId } as const;
  const roles = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...base, functionName: "isCurator", args: [address as `0x${string}`] },
      { ...base, functionName: "isCreator", args: [address as `0x${string}`] },
      { ...base, functionName: "isResolver", args: [address as `0x${string}`] },
    ],
    query: { enabled: deployment.ready, staleTime: 60_000 },
  });
  const roleNames = ["Curator", "Approved creator", "Resolver"].filter((_, i) => roles.data?.[i]?.result === true);

  const items = proposals.data?.items ?? [];
  const approved = items.filter((p) => ["approved", "scheduled", "published"].includes(p.status)).length;
  const published = items.filter((p) => p.status === "published").length;
  const rejected = items.filter((p) => p.status === "rejected").length;
  const createdCount = created.data?.total ?? 0;

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">Profile</p>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold"><Address address={address} you={you} label="Profile address" /></h1>
        {roleNames.length > 0 && <p className="text-sm text-ink-2">On-chain roles: {roleNames.join(" · ")}</p>}
      </header>

      <section aria-labelledby="rep" className="space-y-3">
        <h2 id="rep" className="text-lg font-semibold">Track record</h2>
        <p className="max-w-prose text-sm text-ink-2">Counted from public review decisions and on-chain markets. Trading results are private to each wallet and never part of reputation.</p>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["Suggested", items.length],
            ["Approved", approved],
            ["Published", published],
            ["Markets created", createdCount],
          ].map(([label, n]) => (
            <div key={label} className="border-t border-line pt-2">
              <dd className="tnum text-2xl font-semibold">{proposals.isLoading ? "–" : n}</dd>
              <dt className="text-sm text-ink-2">{label}</dt>
            </div>
          ))}
        </dl>
        {rejected > 0 && <p className="text-xs text-muted">{rejected} rejected. Rejection reasons are on each suggestion.</p>}
      </section>

      <section aria-labelledby="sug" className="space-y-3">
        <h2 id="sug" className="text-lg font-semibold">Suggestions</h2>
        {proposals.isLoading && <Skeleton className="h-14" />}
        {proposals.isError && <Notice tone="error" action={<Button size="sm" variant="secondary" onClick={() => proposals.refetch()}>Retry</Button>}>Couldn&apos;t load suggestions.</Notice>}
        {proposals.data && items.length === 0 && <EmptyState title="No public suggestions" action={you?.toLowerCase() === address ? <ButtonLink href="/suggest" size="sm">Suggest a market</ButtonLink> : undefined} />}
        {items.length > 0 && <ul className="divide-y divide-line">{items.map((p, i) => <ProposalRow key={p.id} p={p} index={i} href={`/proposals/${p.id}`} />)}</ul>}
      </section>

      <section aria-labelledby="mk" className="space-y-3">
        <h2 id="mk" className="text-lg font-semibold">Markets created</h2>
        <MarketList items={created.data?.items} isLoading={created.isLoading} error={created.error as Error | null} empty="No markets published by this wallet" />
      </section>
    </div>
  );
}
