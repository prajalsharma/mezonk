"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, Segmented, Skeleton } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useMe, useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import type { ProjectDto, ProposalDto } from "@/lib/governance/dto";
import { ProposalRow } from "./ProposalBits";

type Tab = "queue" | "mine" | "decided" | "projects" | "reports";

/** Curator home: what needs a decision, what's mine, what was decided, and representative claims to verify. */
export function CuratorDashboard() {
  const { address, isConnected } = useAccount();
  const session = useSession();
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("queue");

  useEffect(() => {
    if (isConnected && !session.signedIn && !session.busy) void session.ensure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const isCurator = !!me.data?.roles.curator;
  const queue = useQuery({
    queryKey: ["proposals", "queue", session.wallet],
    enabled: session.signedIn && isCurator,
    queryFn: () => apiAuth<{ items: ProposalDto[] }>("/api/proposals?queue=1&limit=100"),
    refetchInterval: 15_000,
  });
  const decided = useQuery({
    queryKey: ["proposals", "decided"],
    enabled: tab === "decided",
    queryFn: () => apiGet<{ items: ProposalDto[] }>("/api/proposals?status=approved,published,rejected&limit=100"),
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => apiGet<{ projects: ProjectDto[] }>("/api/projects"), enabled: tab === "projects" });

  if (!isConnected) return <Notice tone="info" title="Connect the curator wallet" action={<WalletButton />} />;
  if (!session.signedIn) {
    return (
      <Notice tone="info" title="Sign in to review" action={<Button size="sm" loading={session.busy} onClick={() => session.ensure()}>Sign in</Button>}>
        {session.error ?? "One signature proves you control this wallet. Your curator role is read from the contract."}
      </Notice>
    );
  }
  if (me.isLoading) return <Skeleton className="h-24" />;
  if (!isCurator) {
    return (
      <Notice tone="warn" title="This wallet isn't an approved curator">
        Curators are appointed on-chain by the protocol owner (<code className="font-mono text-xs">setCurator</code>). Connected: <Address address={address!} label="Wallet" />.
      </Notice>
    );
  }

  const items = queue.data?.items ?? [];
  const unclaimed = items.filter((p) => p.status === "submitted");
  const mine = items.filter((p) => p.assignedCurator === address?.toLowerCase() && p.status === "under_review");
  const others = items.filter((p) => p.status === "under_review" && p.assignedCurator !== address?.toLowerCase());
  const waiting = items.filter((p) => p.status === "changes_requested");
  const approved = items.filter((p) => p.status === "approved" || p.status === "scheduled");

  const list = (rows: ProposalDto[], empty: string) =>
    rows.length === 0 ? <p className="py-6 text-sm text-muted">{empty}</p> : <ul className="divide-y divide-line">{rows.map((p, i) => <ProposalRow key={p.id} p={p} index={i} href={`/proposals/${p.id}`} />)}</ul>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Unclaimed", unclaimed.length],
          ["Yours", mine.length],
          ["Awaiting author", waiting.length],
          ["Approved, unpublished", approved.length],
        ].map(([label, n]) => (
          <div key={label} className="border-t border-line pt-2">
            <p className="tnum text-2xl font-semibold">{queue.isLoading ? "–" : n}</p>
            <p className="text-sm text-ink-2">{label}</p>
          </div>
        ))}
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        label="Section"
        className="w-full sm:max-w-xl"
        options={[
          { value: "queue", label: "Queue" },
          { value: "mine", label: "Yours" },
          { value: "decided", label: "Decided" },
          { value: "projects", label: "Projects" },
          { value: "reports", label: "Reports" },
        ]}
      />

      {queue.isError && <Notice tone="error" title="Couldn't load the queue" action={<Button size="sm" variant="secondary" onClick={() => queue.refetch()}>Retry</Button>}>{(queue.error as Error).message}</Notice>}

      {tab === "queue" && (
        <div className="space-y-8">
          <section aria-labelledby="unclaimed">
            <h2 id="unclaimed" className="text-lg font-semibold">Unclaimed</h2>
            {queue.isLoading ? <Skeleton className="mt-3 h-14" /> : list(unclaimed, "Nothing waiting. New suggestions land here the moment an author submits them.")}
          </section>
          <section aria-labelledby="inreview">
            <h2 id="inreview" className="text-lg font-semibold">In review by other curators</h2>
            {list(others, "None.")}
          </section>
          <section aria-labelledby="waiting">
            <h2 id="waiting" className="text-lg font-semibold">Awaiting the author</h2>
            {list(waiting, "None.")}
          </section>
          <section aria-labelledby="approvedq">
            <h2 id="approvedq" className="text-lg font-semibold">Approved, not yet published</h2>
            <p className="text-sm text-ink-2">The publisher seeds and publishes. Approvals expire on their own if nobody does.</p>
            {list(approved, "None.")}
          </section>
        </div>
      )}
      {tab === "mine" && (
        <section aria-labelledby="yours">
          <h2 id="yours" className="text-lg font-semibold">Yours to decide</h2>
          {list(mine, "You haven't picked anything up. Claim a suggestion from the queue.")}
        </section>
      )}
      {tab === "decided" && (
        <section aria-labelledby="dec">
          <h2 id="dec" className="text-lg font-semibold">Recent decisions</h2>
          {decided.isLoading ? <Skeleton className="mt-3 h-14" /> : list(decided.data?.items ?? [], "No decisions yet.")}
        </section>
      )}
      {tab === "reports" && <ReportsTab />}
      {tab === "projects" && (
        <section aria-labelledby="proj" className="space-y-4">
          <h2 id="proj" className="text-lg font-semibold">Project representatives</h2>
          <p className="max-w-prose text-sm text-ink-2">
            Verifying a representative is a disclosure, not a power: their markets about the project carry a &ldquo;proposed by the project measured&rdquo; label. Check the proof link actually belongs to the project before verifying.
          </p>
          {projects.isLoading && <Skeleton className="h-14" />}
          {projects.data && projects.data.projects.length === 0 && <EmptyState title="No projects registered yet" />}
          <ul className="divide-y divide-line">
            {(projects.data?.projects ?? []).map((pr) => (
              <li key={pr.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold">{pr.name}</span>
                  <span className="font-mono text-xs text-muted">{pr.id}</span>
                  {pr.website && <a href={pr.website} target="_blank" rel="noreferrer nofollow" className="text-sm underline decoration-line underline-offset-2">{pr.website.replace(/^https:\/\//, "")}</a>}
                  <span className={`text-xs ${pr.status === "verified" ? "text-success" : "text-muted"}`}>{pr.status}</span>
                </div>
                {pr.description && <p className="max-w-prose text-sm text-ink-2">{pr.description}</p>}
                <ul className="space-y-1.5">
                  {pr.representatives.map((r) => (
                    <RepRow key={r.wallet} projectId={pr.id} rep={r} you={address} onDone={() => Promise.all([qc.invalidateQueries({ queryKey: ["projects"] }), projects.refetch()])} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RepRow({ projectId, rep, you, onDone }: { projectId: string; rep: ProjectDto["representatives"][number]; you?: string; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const self = !!you && you.toLowerCase() === rep.wallet;
  async function verdict(v: "verified" | "revoked") {
    setBusy(true);
    setErr(null);
    try {
      await apiAuth(`/api/projects/${projectId}/verify`, { method: "POST", body: JSON.stringify({ wallet: rep.wallet, verdict: v, reason: "" }) });
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Address address={rep.wallet} you={you} label="Representative" />
      {rep.proofUrl ? <a href={rep.proofUrl} target="_blank" rel="noreferrer nofollow" className="underline decoration-line underline-offset-2">proof</a> : <span className="text-muted">no proof link</span>}
      <span className={rep.status === "verified" ? "text-success" : rep.status === "revoked" ? "text-danger" : "text-muted"}>{rep.status}</span>
      {!self && rep.status !== "verified" && <Button size="sm" variant="secondary" loading={busy} onClick={() => verdict("verified")}>Verify</Button>}
      {!self && rep.status === "verified" && <Button size="sm" variant="ghost" loading={busy} onClick={() => verdict("revoked")}>Revoke</Button>}
      {err && <span className="text-danger">{err}</span>}
    </li>
  );
}

interface ReportRow {
  reportId: number;
  reason: string;
  reporter: string;
  createdAt: string;
  comment: { id: number; marketId: number; author: string; body: string | null; status: string };
}

/** Reported comments. Hiding or restoring is audited on the server and resolves every open report on that comment. */
function ReportsTab() {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => apiAuth<{ reports: ReportRow[] }>("/api/curate/reports"), refetchInterval: 30_000 });
  const [err, setErr] = useState<string | null>(null);
  async function act(id: number, action: "hide" | "restore") {
    const reason = window.prompt(action === "hide" ? "Why hide this comment? (shown to the author)" : "Why keep it visible?")?.trim();
    if (!reason) return;
    setErr(null);
    try {
      await apiAuth(`/api/comments/${id}/moderate`, { method: "POST", body: JSON.stringify({ action, reason }) });
      await q.refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  if (q.isLoading) return <Skeleton className="h-14" />;
  if (q.isError) return <Notice tone="error" title="Couldn't load reports">{(q.error as Error).message}</Notice>;
  const rows = q.data?.reports ?? [];
  return (
    <section aria-labelledby="reports-h" className="space-y-3">
      <h2 id="reports-h" className="text-lg font-semibold">Reported comments</h2>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {rows.length === 0 ? (
        <EmptyState title="No open reports" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.reportId} className="space-y-2 py-4">
              <p className="text-sm text-ink-2">
                Reported: <span className="text-ink">{r.reason}</span> · by <Address address={r.reporter} label="Reporter" />
              </p>
              <blockquote className="whitespace-pre-wrap break-words rounded-md bg-sunk p-3 text-sm">{r.comment.body ?? "(deleted by author)"}</blockquote>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">by <Address address={r.comment.author} label="Author" /> on</span>
                <a href={`/markets/${r.comment.marketId}#discussion`} className="underline decoration-line underline-offset-2">market #{r.comment.marketId}</a>
                <span className="flex-1" />
                {r.comment.status === "visible" && <Button size="sm" variant="danger" onClick={() => act(r.comment.id, "hide")}>Hide</Button>}
                <Button size="sm" variant="ghost" onClick={() => act(r.comment.id, "restore")}>{r.comment.status === "hidden" ? "Restore" : "Dismiss"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
