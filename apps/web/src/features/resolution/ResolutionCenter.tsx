"use client";

import Link from "next/link";
import { useAccount, useBlock } from "wagmi";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, Skeleton } from "@/components/ui/primitives";
import { StageStatus } from "@/components/markets/StageStatus";
import { useMarkets } from "@/hooks/useMarkets";
import { useMe } from "@/hooks/useSession";
import type { MarketSummaryDto } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { formatDuration, formatMusd } from "@/lib/format";
import type { Stage } from "@/lib/market/stage";

const GROUPS: Array<{ stage: Stage; title: string; blurb: string; who: "resolver" | "challenger" | "arbitrator" | "anyone" }> = [
  { stage: "closed", title: "Awaiting a proposal", blurb: "Trading has closed. The market's resolver must propose Yes, No or Invalid with evidence and a bond before the proposal window ends, or the market settles Invalid.", who: "resolver" },
  { stage: "proposed", title: "Challenge window open", blurb: "An outcome is on the table. Anyone except the resolver can challenge it with a bond and evidence.", who: "challenger" },
  { stage: "disputed", title: "Under arbitration", blurb: "A challenge was filed. The arbitrator must rule before the deadline, with a public rationale.", who: "arbitrator" },
];

/** Markets between close and finalization, grouped by what happens next. Stage and deadlines come from chain time. */
export function ResolutionCenter() {
  const { address } = useAccount();
  const me = useMe();
  const q = useMarkets({ status: "resolving", limit: 100, sort: "closing" });
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });
  const nowMs = block.data ? Number(block.data.timestamp) * 1000 : Date.now();
  const roles = me.data?.roles;

  if (q.isLoading) return <div className="space-y-3" aria-busy>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (q.isError) return <Notice tone="error" title="Couldn't load markets" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Retry</Button>}>{(q.error as Error).message}</Notice>;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <EmptyState title="Nothing is resolving right now" action={<ButtonLink href="/markets" size="sm" variant="secondary">Browse markets</ButtonLink>}>Markets appear here once trading closes and until the outcome is final.</EmptyState>;

  const finalizable = items.filter((m) => m.stage.finalizable);

  return (
    <div className="space-y-10">
      {address && (roles?.resolver || roles?.arbitrator) && (
        <Notice tone="info" title={roles.arbitrator ? "You're the protocol arbitrator" : "You're an approved resolver"}>
          Markets that need you specifically show their action on the market page. Only the resolver named at creation can propose on a given market.
        </Notice>
      )}
      {finalizable.length > 0 && (
        <section aria-labelledby="fin" className="space-y-3">
          <h2 id="fin" className="text-lg font-semibold">Ready to finalize</h2>
          <p className="max-w-prose text-sm text-ink-2">A deadline has passed. Anyone can send the finalize transaction; it only applies the outcome the rules already determine.</p>
          <Rows items={finalizable} nowMs={nowMs} />
        </section>
      )}
      {GROUPS.map((g) => {
        const rows = items.filter((m) => m.stage.stage === g.stage && !m.stage.finalizable);
        return (
          <section key={g.stage} aria-labelledby={`g-${g.stage}`} className="space-y-3">
            <div>
              <h2 id={`g-${g.stage}`} className="text-lg font-semibold">{g.title}</h2>
              <p className="max-w-prose text-sm text-ink-2">{g.blurb}</p>
            </div>
            {rows.length === 0 ? <p className="text-sm text-muted">None right now.</p> : <Rows items={rows} nowMs={nowMs} />}
          </section>
        );
      })}
    </div>
  );
}

function Rows({ items, nowMs }: { items: MarketSummaryDto[]; nowMs: number }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((m, i) => {
        const dl = m.stage.deadline ? new Date(m.stage.deadline).getTime() : null;
        const left = dl ? Math.max(0, Math.floor((dl - nowMs) / 1000)) : null;
        return (
          <li key={m.id} className="rise" style={{ "--i": i } as React.CSSProperties}>
            <Link href={`/markets/${m.id}#resolution`} className="group grid gap-1 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="min-w-0">
                <p className="font-semibold leading-snug group-hover:underline decoration-line underline-offset-4">{m.question}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                  <span>#{m.id}</span>
                  <span>{formatMusd(m.volume, { compact: true })} MUSD traded</span>
                  {m.stage.deadlineLabel && left !== null && <span className="tnum">{m.stage.deadlineLabel}: {left === 0 ? "passed" : `${formatDuration(left)} left`}</span>}
                </p>
              </div>
              <StageStatus stage={m.stage.stage} label={m.stage.label} finalOutcome={m.finalOutcome} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
