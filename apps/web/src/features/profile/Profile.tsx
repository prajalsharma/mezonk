"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Avatar } from "@/components/profile/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Segmented } from "@/components/ui/primitives";
import { ProfileEditor } from "@/features/profile/ProfileEditor";
import { ProposalStatusDot } from "@/features/governance/ProposalBits";
import { deployment } from "@/lib/chain/config";
import { factoryAbi } from "@/lib/contracts/abi";
import { relativeTime } from "@/lib/format";
import type { ProposalStatus } from "@/lib/governance/proposal";
import { outcomeLabel } from "@/lib/market/stage";

export interface ProfileData {
  profile: { wallet: string; username: string | null; displayName: string | null; bio: string; avatarUrl: string | null; createdAt: string | null };
  markets: Array<{ id: number; question: string; slug: string | null; createdAt: string; finalOutcome: number | null }>;
  suggestions: Array<{ id: string; status: string; question: string; marketId: number | null }>;
  comments: Array<{ id: number; marketId: number; body: string; createdAt: string; slug: string | null; question: string }>;
}

type Tab = "markets" | "suggestions" | "comments";

/**
 * Public profile. Reputation here is what the wallet published, suggested and said in public,
 * never trading profit (which stays private to each wallet).
 */
export function Profile({ data }: { data: ProfileData }) {
  const { address: you } = useAccount();
  const p = data.profile;
  const mine = !!you && you.toLowerCase() === p.wallet.toLowerCase();
  const [tab, setTab] = useState<Tab>("markets");
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const base = { address: deployment.factoryAddress!, abi: factoryAbi, chainId: deployment.chainId } as const;
  const roles = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...base, functionName: "isCurator", args: [p.wallet as `0x${string}`] },
      { ...base, functionName: "isCreator", args: [p.wallet as `0x${string}`] },
      { ...base, functionName: "isResolver", args: [p.wallet as `0x${string}`] },
    ],
    query: { enabled: deployment.ready, staleTime: 60_000 },
  });
  const roleNames = ["Curator", "Approved creator", "Resolver"].filter((_, i) => roles.data?.[i]?.result === true);
  const approved = data.suggestions.filter((s) => ["approved", "scheduled", "published"].includes(s.status)).length;

  return (
    <div className="space-y-8">
      <header className="panel relative overflow-hidden p-6 md:p-8">
        <div aria-hidden className="grid-bg absolute inset-0" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-5">
            <Avatar address={p.wallet} url={p.avatarUrl} size={88} className="ring-2" />
            <div className="min-w-0 space-y-1.5">
              <h1 className="display truncate text-4xl md:text-5xl">{p.displayName ?? "Unnamed wallet"}</h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
                {p.username && <span className="mono">@{p.username}</span>}
                <Address address={p.wallet} you={you} label="Wallet" />
                {p.createdAt && <span className="text-muted">joined {relativeTime(new Date(p.createdAt))}</span>}
              </p>
              {roleNames.length > 0 && (
                <p className="flex flex-wrap gap-1.5 pt-1">
                  {roleNames.map((r) => (
                    <span key={r} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-line">{r} · on-chain</span>
                  ))}
                </p>
              )}
            </div>
          </div>
          {mine && <Button variant="secondary" onClick={() => setEditing(true)}>{p.username ? "Edit profile" : "Set up profile"}</Button>}
        </div>
        {p.bio && <p className="relative mt-5 max-w-2xl whitespace-pre-wrap text-ink-2">{p.bio}</p>}
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Markets created", data.markets.length],
          ["Suggestions", data.suggestions.length],
          ["Approved", approved],
          ["Comments", data.comments.length],
        ].map(([l, n]) => (
          <div key={l} className="panel px-4 py-3">
            <dd className="mono text-2xl font-semibold">{n}</dd>
            <dt className="text-xs text-muted">{l}</dt>
          </div>
        ))}
      </dl>

      <Segmented
        value={tab}
        onChange={setTab}
        label="Profile section"
        className="w-full sm:max-w-md"
        options={[
          { value: "markets", label: "Markets" },
          { value: "suggestions", label: "Suggestions" },
          { value: "comments", label: "Comments" },
        ]}
      />

      {tab === "markets" &&
        (data.markets.length ? (
          <ul className="panel divide-y divide-line">
            {data.markets.map((m) => (
              <li key={m.id}>
                <Link href={`/markets/${m.slug ?? m.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2">
                  <span className="font-medium">{m.question}</span>
                  <span className="mono shrink-0 text-xs text-muted">{m.finalOutcome != null ? `Resolved ${outcomeLabel(m.finalOutcome)}` : relativeTime(new Date(m.createdAt))}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No markets published by this wallet" />
        ))}
      {tab === "suggestions" &&
        (data.suggestions.length ? (
          <ul className="panel divide-y divide-line">
            {data.suggestions.map((s) => (
              <li key={s.id}>
                <Link href={`/proposals/${s.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2">
                  <span className="font-medium">{s.question}</span>
                  <ProposalStatusDot status={s.status as ProposalStatus} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No public suggestions" action={mine ? <ButtonLink href="/suggest" size="sm">Suggest a market</ButtonLink> : undefined} />
        ))}
      {tab === "comments" &&
        (data.comments.length ? (
          <ul className="panel divide-y divide-line">
            {data.comments.map((c) => (
              <li key={c.id} className="space-y-1 px-5 py-4">
                <Link href={`/markets/${c.slug ?? c.marketId}#discussion`} className="text-sm font-medium text-ink-2 hover:text-ink">{c.question}</Link>
                <p className="line-clamp-3 whitespace-pre-wrap break-words">{c.body}</p>
                <p className="mono text-xs text-muted">{relativeTime(new Date(c.createdAt))}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No comments yet" />
        ))}

      {mine && <ProfileEditor open={editing} onClose={() => { setEditing(false); router.refresh(); }} firstRun={!p.username} />}
    </div>
  );
}
