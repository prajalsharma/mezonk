"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field, Notice, inputClass } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import { approvalTypes } from "@/lib/governance/approval";
import type { ProposalDetailDto } from "@/lib/governance/dto";
import { REVIEW_CHECKLIST, type ChecklistKey } from "@/lib/governance/proposal";

type Mode = "idle" | "approve" | "reject" | "changes" | "note";

interface ApprovalPayload {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  approval: { metadataHash: `0x${string}`; creator: `0x${string}`; resolver: `0x${string}`; closeTime: string; deadline: string; nonce: `0x${string}` };
}

/**
 * Curator workspace for one proposal. Approval signs the exact EIP-712 payload the server builds,
 * so the key never leaves the curator's wallet and the server can only store what was signed.
 */
export function ReviewPanel({ detail, onDone }: { detail: ProposalDetailDto; onDone: () => Promise<unknown> }) {
  const { proposal: p, check } = detail;
  const { address } = useAccount();
  const session = useSession();
  const { signTypedDataAsync } = useSignTypedData();
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [internal, setInternal] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState("");
  const [checklist, setChecklist] = useState<Record<ChecklistKey, boolean>>(() => Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, false])) as Record<ChecklistKey, boolean>);
  const [resolver, setResolver] = useState(p.resolver ?? "");
  const [publisher, setPublisher] = useState(p.publisher);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolvers = useQuery({ queryKey: ["resolvers"], queryFn: () => apiGet<{ resolvers: Array<{ address: string }> }>("/api/resolvers") });
  const mine = p.assignedCurator === address?.toLowerCase();
  const assignedElsewhere = !!p.assignedCurator && !mine;
  const allChecked = REVIEW_CHECKLIST.every(([k]) => checklist[k]);
  const blocking = check?.issues.filter((i) => i.blocking) ?? [];

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      if (!(await session.ensure())) return false;
      await apiAuth(`/api/proposals/${p.id}/review`, { method: "POST", body: JSON.stringify(body) });
      await onDone();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!allChecked) return;
    setBusy(true);
    setErr(null);
    try {
      if (!(await session.ensure())) return;
      // Resolver and publisher are bound into the signature, so assign first, then fetch the exact payload.
      if (resolver !== (p.resolver ?? "") || publisher !== p.publisher) {
        await apiAuth(`/api/proposals/${p.id}/review`, { method: "POST", body: JSON.stringify({ action: "assign", resolver, publisher, reason: "" }) });
      }
      const payload = await apiAuth<ApprovalPayload>(`/api/proposals/${p.id}/approval`);
      const a = payload.approval;
      const signature = await signTypedDataAsync({
        domain: payload.domain,
        types: approvalTypes,
        primaryType: "MarketApproval",
        message: { metadataHash: a.metadataHash, creator: a.creator, resolver: a.resolver, closeTime: BigInt(a.closeTime), deadline: BigInt(a.deadline), nonce: a.nonce },
      });
      await apiAuth(`/api/proposals/${p.id}/review`, { method: "POST", body: JSON.stringify({ action: "approve", reason, checklist, signature, approval: a, internal: false }) });
      setMode("idle");
      await onDone();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(/rejected|denied/i.test(msg) ? "You declined the signature in your wallet. Nothing was approved." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4" aria-labelledby="review">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="review" className="font-semibold">Curator review</h2>
          <p className="text-sm text-ink-2">
            {p.status === "submitted" && "Unclaimed. Pick it up to review."}
            {p.status === "under_review" && (mine ? "You're reviewing this." : <>Being reviewed by <Address address={p.assignedCurator!} label="Curator" /></>)}
            {p.status === "changes_requested" && "Waiting for the author to make changes."}
          </p>
        </div>
      </div>

      {check && (
        <div className="space-y-2">
          {check.issues.map((i) => (
            <p key={i.message} className={cx("text-sm", i.blocking ? "text-danger" : "text-warn")}>{i.blocking ? "Blocking: " : "Check: "}{i.message}</p>
          ))}
          {check.similarMarkets.length > 0 && (
            <p className="text-sm text-warn">
              Similar live markets:{" "}
              {check.similarMarkets.map((m, i) => <span key={m.id}>{i > 0 && ", "}<Link className="underline" href={`/markets/${m.id}`} target="_blank">#{m.id}</Link></span>)}
            </p>
          )}
          {check.similarProposals.length > 0 && (
            <p className="text-sm text-warn">
              Similar suggestions:{" "}
              {check.similarProposals.map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link className="underline" href={`/proposals/${s.id}`} target="_blank">{s.question.slice(0, 40)}…</Link></span>)}
            </p>
          )}
          {check.issues.length === 0 && check.similarMarkets.length === 0 && check.similarProposals.length === 0 && <p className="text-sm text-success">Automated checks found nothing.</p>}
        </div>
      )}

      {p.status === "submitted" && !assignedElsewhere && (
        <Button className="w-full" loading={busy} onClick={() => post({ action: "claim", reason: "", internal: false })}>Pick up for review</Button>
      )}
      {assignedElsewhere && <p className="text-sm text-muted">Only the assigned curator can act. They can release it back to the queue.</p>}

      {(mine || p.status === "changes_requested") && mode === "idle" && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => setMode("approve")} disabled={blocking.length > 0 || p.status !== "under_review"}>Approve</Button>
          <Button variant="danger" onClick={() => setMode("reject")} disabled={p.status !== "under_review"}>Reject</Button>
          <Button variant="secondary" onClick={() => setMode("changes")} disabled={p.status !== "under_review"}>Request changes</Button>
          <Button variant="ghost" onClick={() => setMode("note")}>Add a note</Button>
          {mine && <Button variant="ghost" className="col-span-2" loading={busy} onClick={() => post({ action: "unassign", reason: "", internal: false })}>Release to the queue</Button>}
        </div>
      )}

      {mode === "approve" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void approve(); }}>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Checklist (all required)</legend>
            {REVIEW_CHECKLIST.map(([k, label]) => (
              <label key={k} className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={checklist[k]} onChange={(e) => setChecklist((c) => ({ ...c, [k]: e.target.checked }))} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Resolver" htmlFor="rv" hint="Proposes the outcome after close. Owner-approved resolvers only.">
            {resolvers.data?.resolvers.length ? (
              <Select id="rv" value={resolver} onChange={(e) => setResolver(e.target.value)} className="w-full font-mono text-sm">
                <option value="">Choose…</option>
                {resolvers.data.resolvers.map((r) => <option key={r.address} value={r.address}>{r.address}</option>)}
              </Select>
            ) : (
              <p className="text-sm text-warn">{resolvers.isLoading ? "Loading approved resolvers…" : "No approved resolvers are indexed yet."}</p>
            )}
          </Field>
          <Field label="Publisher" htmlFor="pb" hint="The approved creator who seeds and publishes. Defaults to the author; must not be you.">
            <input id="pb" value={publisher} onChange={(e) => setPublisher(e.target.value.trim())} className={cx(inputClass, "font-mono text-sm")} spellCheck={false} />
          </Field>
          <Field label="Note to the author (optional)" htmlFor="ar">
            <textarea id="ar" rows={2} maxLength={1200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </Field>
          <p className="text-xs text-muted">Approving asks your wallet for one typed-data signature. It binds these exact rules, the publisher, resolver and close time, and can be used once.</p>
          {err && <Notice tone="error">{err}</Notice>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode("idle")} disabled={busy}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={busy} disabled={!allChecked || !/^0x[0-9a-fA-F]{40}$/.test(resolver) || !/^0x[0-9a-fA-F]{40}$/.test(publisher)}>Sign and approve</Button>
          </div>
        </form>
      )}

      {(mode === "reject" || mode === "changes" || mode === "note") && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await post({ action: mode === "reject" ? "reject" : mode === "changes" ? "request_changes" : "note", reason, internal: mode === "note" ? internal : false, duplicateOf: duplicateOf || undefined });
            if (ok) {
              setMode("idle");
              setReason("");
            }
          }}
        >
          <Field label={mode === "note" ? "Note" : "Reason (shown to the author)"} htmlFor="rs" hint={mode === "note" ? undefined : "At least 10 characters. Say what would make it approvable."} error={reason.trim().length > 0 && reason.trim().length < 10 && mode !== "note" ? "A little more detail, please." : null}>
            <textarea id="rs" rows={3} maxLength={1200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} autoFocus />
          </Field>
          {mode === "reject" && check && check.similarProposals.length + check.similarMarkets.length > 0 && (
            <Field label="Duplicate of (optional)" htmlFor="dup">
              <Select id="dup" value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} className="w-full">
                <option value="">Not a duplicate</option>
                {check.similarProposals.map((s) => <option key={s.id} value={s.id}>{s.question}</option>)}
              </Select>
            </Field>
          )}
          {mode === "note" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal (curators only, never shown to the author)
            </label>
          )}
          {err && <Notice tone="error">{err}</Notice>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode("idle")} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={mode === "reject" ? "danger" : "primary"} className="flex-1" loading={busy} disabled={mode !== "note" && reason.trim().length < 10}>
              {mode === "reject" ? "Reject" : mode === "changes" ? "Request changes" : "Save note"}
            </Button>
          </div>
        </form>
      )}
      {mode === "idle" && err && <Notice tone="error">{err}</Notice>}
    </section>
  );
}
