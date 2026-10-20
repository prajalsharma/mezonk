"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { KeyValue, Notice, Skeleton } from "@/components/ui/primitives";
import { RulesPanel } from "@/components/markets/RulesPanel";
import { useOnchainRoles } from "@/hooks/useOnchainRoles";
import { useMe, useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import { reviewActionLabel, type ProposalDetailDto } from "@/lib/governance/dto";
import { REVIEW_CHECKLIST, statusLabel } from "@/lib/governance/proposal";
import { categoryLabel, serializeMetadata } from "@/lib/market/metadata";
import { formatDateTime, relativeTime } from "@/lib/format";
import { ProposalStatusDot } from "./ProposalBits";
import { PublishPanel } from "./PublishPanel";
import { ReviewPanel } from "./ReviewPanel";

const STEPS = ["Submitted", "Under review", "Approved", "Live"] as const;
const stepIndex: Record<string, number> = { draft: -1, submitted: 0, under_review: 1, changes_requested: 1, approved: 2, scheduled: 2, published: 3, rejected: 1, withdrawn: 0 };

export function ProposalView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const { address } = useAccount();
  const session = useSession();
  const me = useMe();
  const chainRoles = useOnchainRoles(address);
  const [withdrawing, setWithdrawing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Signed-in viewers get the privileged view (drafts, internal notes, policy check) when entitled.
  const q = useQuery({
    queryKey: ["proposal", id, session.signedIn],
    queryFn: () => (session.signedIn ? apiAuth<ProposalDetailDto>(`/api/proposals/${id}`) : apiGet<ProposalDetailDto>(`/api/proposals/${id}`)),
    refetchInterval: 15_000,
    refetchOnMount: "always",
  });
  const audit = useQuery({
    queryKey: ["audit", "proposal", id],
    queryFn: () => apiGet<{ entries: Array<{ actor: string; action: string; createdAt: string }> }>(`/api/audit?type=proposal&id=${id}`),
    refetchInterval: 30_000,
  });

  if (q.isLoading) return <div className="space-y-4" aria-busy><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40" /></div>;
  if (q.isError || !q.data) {
    return <Notice tone="error" title="Couldn't load this suggestion" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Retry</Button>}>{(q.error as Error)?.message ?? "It may have been withdrawn or is still a private draft."}</Notice>;
  }
  const { proposal: p, reviews, project, authorIsVerifiedRep } = q.data;
  const isAuthor = !!address && address.toLowerCase() === p.author;
  const isPublisher = !!address && address.toLowerCase() === p.publisher;
  const roles = me.data?.roles;
  // Curator status comes from chain so a connected curator is offered sign-in before any signature.
  const canReview = (chainRoles.curator || !!roles?.curator) && !isAuthor;
  const canWithdraw = isAuthor && ["draft", "submitted", "under_review", "changes_requested"].includes(p.status);
  const canEdit = isAuthor && ["draft", "changes_requested"].includes(p.status);
  const step = stepIndex[p.status] ?? 0;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["proposal", id] }), qc.invalidateQueries({ queryKey: ["proposals"] }), audit.refetch()]);

  async function withdraw() {
    setErr(null);
    if (!(await session.ensure())) return;
    try {
      await apiAuth(`/api/proposals/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "withdraw" }) });
      setWithdrawing(false);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const lastDecision = [...reviews].reverse().find((r) => ["reject", "request_changes", "approve"].includes(r.action) && !r.internal);

  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-8">
        {params.get("submitted") && p.status === "submitted" && (
          <Notice tone="success" title="Submitted for review">
            A curator will pick this up. You&apos;ll see each step here, and you can withdraw until it&apos;s approved.
          </Notice>
        )}
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <Link href="/proposals" className="hover:text-ink">Suggestions</Link>
            <span aria-hidden>/</span>
            <span>{categoryLabel[p.metadata.category]}</span>
            <span>v{p.version}</span>
            {p.sponsored && <span className="text-warn">Proposed by the project measured</span>}
          </div>
          <h1 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">{p.metadata.question}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
            <ProposalStatusDot status={p.status} />
            <span>Suggested by <Address address={p.author} you={address} label="Author" /></span>
            {authorIsVerifiedRep && project && <span className="text-success">Verified representative of {project.name}</span>}
            <span>{relativeTime(new Date(p.createdAt))}</span>
          </div>
        </header>

        <ol className="grid grid-cols-4 gap-1 text-xs font-semibold" aria-label="Progress">
          {STEPS.map((s, i) => {
            const state = p.status === "rejected" && i === 1 ? "rejected" : p.status === "withdrawn" ? "off" : i < step ? "done" : i === step ? "current" : "todo";
            return (
              <li key={s} className="space-y-1.5">
                <span aria-hidden className={`block h-1 rounded-full ${state === "done" ? "bg-success" : state === "current" ? "bg-ink" : state === "rejected" ? "bg-danger" : "bg-line"}`} />
                <span className={state === "todo" || state === "off" ? "text-muted" : state === "rejected" ? "text-danger" : "text-ink"}>{state === "rejected" ? "Rejected" : s}</span>
              </li>
            );
          })}
        </ol>

        {lastDecision && (p.status === "rejected" || p.status === "changes_requested" || p.status === "approved") && (
          <Notice tone={p.status === "rejected" ? "error" : p.status === "approved" ? "success" : "warn"} title={reviewActionLabel[lastDecision.action]}>
            {lastDecision.reason || (p.status === "approved" ? "Every item on the review checklist passed." : "No reason was recorded.")}
            {lastDecision.duplicateOf && <> Duplicate of <Link className="underline" href={`/proposals/${lastDecision.duplicateOf}`}>another suggestion</Link>.</>}
            {p.status === "changes_requested" && isAuthor && <p className="mt-2"><Link href={`/suggest?edit=${p.id}`} className="font-semibold underline">Edit and resubmit</Link></p>}
          </Notice>
        )}
        {p.status === "published" && p.marketId && (
          <Notice tone="success" title={`Live as market #${p.marketId}`} action={<ButtonLink href={`/markets/${p.marketId}`} size="sm">Open the market</ButtonLink>}>
            The rules below are hashed on-chain and can no longer change.
          </Notice>
        )}

        {p.metadata.description && <p className="max-w-prose text-ink-2">{p.metadata.description}</p>}

        <RulesPanel meta={p.metadata} raw={serializeMetadata(p.metadata)} onchainHash={p.metadataHash} closeTime={new Date(p.closeTime)} context="proposal" />

        <section className="space-y-3" aria-labelledby="why">
          <h2 id="why" className="text-lg font-semibold">Why this market</h2>
          <p className="max-w-prose text-ink-2">{p.rationale}</p>
          {(p.sponsored || p.conflicts) && (
            <div className="rounded-md border border-warn/40 bg-warn-soft px-3.5 py-3 text-sm">
              <p className="font-semibold">Disclosure</p>
              <p className="text-ink-2">{p.conflicts || "The author or sponsor has a stake in this outcome."}</p>
            </div>
          )}
          {p.references.length > 0 && (
            <ul className="space-y-1 text-sm">
              {p.references.map((r) => (
                <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer nofollow" className="underline decoration-line underline-offset-2 hover:text-ink">{r.label || r.url}</a></li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="history">
          <h2 id="history" className="text-lg font-semibold">Review history</h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet. Once submitted, every decision and reason appears here.</p>
          ) : (
            <ol className="space-y-4 border-l border-line pl-4">
              {reviews.map((r) => (
                <li key={r.id} className="relative text-sm">
                  <span aria-hidden className={`absolute -left-[1.3rem] top-1.5 size-2 rounded-full ${r.action === "approve" || r.action === "publish" ? "bg-success" : r.action === "reject" ? "bg-danger" : r.action === "request_changes" ? "bg-warn" : "bg-line"}`} />
                  <p className="font-semibold">
                    {reviewActionLabel[r.action] ?? r.action}
                    {r.internal && <span className="ml-2 text-xs font-normal text-muted">internal note</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {r.reviewer === "chain" ? "On-chain" : <Address address={r.reviewer} you={address} label="Reviewer" />} · {formatDateTime(new Date(r.createdAt))} · v{r.proposalVersion}
                  </p>
                  {r.reason && <p className="mt-1 text-ink-2">{r.reason}</p>}
                  {r.checklist && (
                    <ul className="mt-1 grid gap-0.5 text-xs text-ink-2 sm:grid-cols-2">
                      {REVIEW_CHECKLIST.map(([k, label]) => (
                        <li key={k} className="flex items-center gap-1.5"><Check className={`size-3 ${r.checklist![k] ? "text-success" : "text-line"}`} aria-hidden />{label}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <details className="group text-sm">
          <summary className="cursor-pointer font-semibold text-ink-2 hover:text-ink">Audit trail</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-ink-2">
            {(audit.data?.entries ?? []).map((e, i) => (
              <li key={i}>{new Date(e.createdAt).toISOString()} · {e.actor === "chain" ? "chain" : e.actor} · {e.action}</li>
            ))}
            {audit.data && audit.data.entries.length === 0 && <li>No entries.</li>}
          </ul>
        </details>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
          <KeyValue label="Status">{statusLabel[p.status]}</KeyValue>
          <KeyValue label="Trading closes">{formatDateTime(new Date(p.closeTime))}</KeyValue>
          <KeyValue label="Event evaluated">{formatDateTime(new Date(p.metadata.resolvesAt))}</KeyValue>
          <KeyValue label="Source"><a href={p.metadata.source.url} target="_blank" rel="noreferrer nofollow" className="underline decoration-line underline-offset-2">{p.metadata.source.name}</a></KeyValue>
          {project && <KeyValue label="Project">{project.name}{project.status === "verified" ? "" : " (unverified)"}</KeyValue>}
          {p.resolver && <KeyValue label="Resolver"><Address address={p.resolver} label="Resolver" /></KeyValue>}
          {p.status !== "draft" && <KeyValue label="Publisher"><Address address={p.publisher} you={address} label="Publisher" /></KeyValue>}
          {p.assignedCurator && <KeyValue label="Curator"><Address address={p.assignedCurator} you={address} label="Curator" /></KeyValue>}
          {p.launchWindow && <KeyValue label="Launch window">{p.launchWindow}</KeyValue>}
          <KeyValue label="Rules hash"><span className="break-all font-mono text-xs">{p.metadataHash.slice(0, 10)}…{p.metadataHash.slice(-6)}</span></KeyValue>
        </dl>

        {(p.status === "approved" || p.status === "scheduled") && p.approval && (
          isPublisher ? (
            <PublishPanel proposal={p} onPublished={refresh} />
          ) : (
            <Notice tone="info" title="Waiting for the publisher">
              Only <Address address={p.publisher} label="Publisher" /> can publish this market, with the curator&apos;s signature and seed liquidity. The approval expires {formatDateTime(Number(p.approval.deadline) * 1000)}.
            </Notice>
          )
        )}

        {canReview && ["submitted", "under_review", "changes_requested"].includes(p.status) && (
          session.signedIn ? (
            <ReviewPanel detail={q.data} onDone={refresh} />
          ) : (
            <Notice tone="info" title="You're a curator" action={<Button size="sm" loading={session.busy} onClick={() => session.ensure()}>Sign in to review</Button>}>
              {session.error ?? "One free signature unlocks the review tools for this tab."}
            </Notice>
          )
        )}

        {(canEdit || canWithdraw) && (
          <div className="flex flex-wrap gap-2">
            {canEdit && <ButtonLink href={`/suggest?edit=${p.id}`} variant="secondary" size="sm">Edit</ButtonLink>}
            {canWithdraw && <Button variant="danger" size="sm" onClick={() => setWithdrawing(true)}>Withdraw</Button>}
          </div>
        )}
        {err && <Notice tone="error">{err}</Notice>}

        <Dialog open={withdrawing} onClose={() => setWithdrawing(false)} title="Withdraw this suggestion?" footer={<><Button variant="ghost" onClick={() => setWithdrawing(false)}>Keep it</Button><Button variant="danger" onClick={withdraw}>Withdraw</Button></>}>
          <p className="text-sm text-ink-2">It leaves the review queue and stops being public. You can suggest it again later as a new suggestion.</p>
        </Dialog>
        {p.status === "withdrawn" && isAuthor && <Button variant="secondary" size="sm" onClick={() => router.push("/suggest")}>Suggest another</Button>}
      </aside>
    </article>
  );
}
