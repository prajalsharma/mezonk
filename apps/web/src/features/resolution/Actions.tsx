"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { KeyValue, Notice, Segmented } from "@/components/ui/primitives";
import { TxStatus } from "@/components/trading/TxStatus";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { deployment } from "@/lib/chain/config";
import { formatDateTime, formatDuration, formatMusd } from "@/lib/format";
import { outcomeToCode } from "@/lib/market/evidence";
import { outcomeLabel } from "@/lib/market/stage";
import type { Availability } from "@/lib/market/permissions";
import { EvidenceComposer, emptyEvidence, validateEvidence, type EvidenceDraft } from "./EvidenceComposer";
import { useResolutionAction, type Outcome } from "./useResolutionAction";

const OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "invalid", label: "Invalid" },
];

function Countdown({ seconds }: { seconds?: number }) {
  if (seconds === undefined) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const txt = h >= 48 ? `${Math.floor(h / 24)} days` : h ? `${h}h ${m}m` : `${m}m`;
  return (
    <span className={seconds < 600 ? "text-warn" : "text-ink-2"}>
      {txt} left{seconds < 600 ? ". A transaction mined after the deadline will revert." : ""}
    </span>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

// ───────────────────────── Propose ─────────────────────────

export function ProposeAction({
  marketId,
  avail,
  bond,
  challengeWindow,
  rules,
  onDone,
}: {
  marketId: number;
  avail: Availability;
  bond: bigint;
  challengeWindow: number;
  rules: ReactNode;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>("yes");
  const [draft, setDraft] = useState<EvidenceDraft>(emptyEvidence);
  const [review, setReview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = useResolutionAction(marketId, onDone);

  async function send() {
    setReview(false);
    let doc: { hash: `0x${string}`; uri: string };
    try {
      doc = await a.publish("proposal", draft, outcome);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!(await a.ensureAllowance(bond))) return;
    await a.tx.run({
      label: "Propose outcome",
      validate: async () => {
        const stage = await a.client!.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "stageOf", args: [BigInt(marketId)] });
        if (stage !== 1) throw new Error("The market is no longer waiting for a proposal. Refresh to see its state.");
      },
      send: () =>
        a.writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: "proposeOutcome",
          args: [BigInt(marketId), outcomeToCode[outcome], doc.hash, doc.uri],
          chainId: deployment.chainId,
        }),
      onConfirmed: a.refreshAll,
    });
  }

  return (
    <Step title="Propose the outcome">
      <p className="text-sm text-ink-2">
        You are this market&apos;s resolver. <Countdown seconds={avail.secondsLeft} />
      </p>
      <details className="rounded-md border border-line px-3 py-2 text-sm">
        <summary className="cursor-pointer font-semibold">Resolution rules for this market</summary>
        <div className="pt-3">{rules}</div>
      </details>
      <Segmented label="Proposed outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} />
      <EvidenceComposer
        value={draft}
        onChange={(d) => {
          setDraft(d);
          setErr(null);
        }}
        summaryLabel="Why this outcome"
        summaryHint="Cite the rule that applies and what the source shows. This text is hashed and committed on-chain."
      />
      <dl className="divide-y divide-line border-y border-line">
        <KeyValue label="Proposal bond">{formatMusd(bond)} MUSD</KeyValue>
        <KeyValue label="Challenge window">{formatDuration(challengeWindow)}</KeyValue>
      </dl>
      <p className="text-sm text-ink-2">
        Your bond is returned if nobody challenges, or if the arbitrator agrees with you. If a challenge succeeds, the
        challenger receives your bond.
      </p>
      {err && <Notice tone="error">{err}</Notice>}
      <Button
        className="w-full"
        disabled={!avail.available || a.tx.busy}
        loading={a.tx.busy}
        onClick={() => {
          const v = validateEvidence(draft);
          if (v) return setErr(v);
          setReview(true);
        }}
      >
        Review proposal
      </Button>
      <TxStatus state={a.tx.state} onRetry={send} />
      <Dialog
        open={review}
        onClose={() => setReview(false)}
        title="Review proposal"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(false)}>Back</Button>
            <Button onClick={send}>Publish evidence and sign</Button>
          </>
        }
      >
        <dl className="divide-y divide-line">
          <KeyValue label="Outcome">{outcomeLabel(outcomeToCode[outcome])}</KeyValue>
          <KeyValue label="Bond">{formatMusd(bond)} MUSD</KeyValue>
          <KeyValue label="Evidence links">{draft.links.filter((l) => l.url.trim()).length}</KeyValue>
        </dl>
        <p className="mt-3 text-sm text-ink-2">
          Up to three steps: publish the evidence document, approve the bond if needed, then sign the proposal. The
          proposal is final only after the challenge window passes with no successful challenge.
        </p>
      </Dialog>
    </Step>
  );
}

// ───────────────────────── Challenge ─────────────────────────

export function DisputeAction({
  marketId,
  avail,
  bond,
  proposedOutcome,
  challengeDeadline,
  onDone,
}: {
  marketId: number;
  avail: Availability;
  bond: bigint;
  proposedOutcome: number;
  challengeDeadline: Date;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<EvidenceDraft>(emptyEvidence);
  const [claimed, setClaimed] = useState<Outcome>(proposedOutcome === 1 ? "no" : "yes");
  const [review, setReview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = useResolutionAction(marketId, onDone);

  async function send() {
    setReview(false);
    let doc: { hash: `0x${string}`; uri: string };
    try {
      doc = await a.publish("dispute", draft, claimed);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!(await a.ensureAllowance(bond))) return;
    await a.tx.run({
      label: "Challenge",
      validate: async () => {
        const stage = await a.client!.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "stageOf", args: [BigInt(marketId)] });
        if (stage !== 2) throw new Error("This proposal is no longer open to challenge. It may already have been challenged.");
      },
      send: () =>
        a.writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: "dispute",
          args: [BigInt(marketId), doc.hash, doc.uri],
          chainId: deployment.chainId,
        }),
      onConfirmed: a.refreshAll,
    });
  }

  return (
    <Step title={`Challenge the proposed outcome (${outcomeLabel(proposedOutcome)})`}>
      <p className="text-sm text-ink-2">
        Deadline {formatDateTime(challengeDeadline)}. <Countdown seconds={avail.secondsLeft} />
      </p>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">What the correct outcome is</p>
        <Segmented label="Outcome you believe is correct" value={claimed} onChange={setClaimed} options={OUTCOMES.filter((o) => outcomeToCode[o.value] !== proposedOutcome)} />
      </div>
      <EvidenceComposer value={draft} onChange={(d) => { setDraft(d); setErr(null); }} summaryLabel="Reason for the challenge" summaryHint="Point to the rule and the evidence that contradicts the proposal." />
      <dl className="divide-y divide-line border-y border-line">
        <KeyValue label="Challenge bond">{formatMusd(bond)} MUSD</KeyValue>
      </dl>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
        <li>Only one challenge per proposal. Yours freezes the outcome until the arbitrator rules.</li>
        <li>If the arbitrator rules anything other than {outcomeLabel(proposedOutcome)}, you get your bond back plus the resolver&apos;s bond.</li>
        <li>If the arbitrator upholds {outcomeLabel(proposedOutcome)}, the resolver receives your bond.</li>
        <li>If the arbitrator doesn&apos;t rule in time, the market settles as Invalid and both bonds are refunded.</li>
      </ul>
      {err && <Notice tone="error">{err}</Notice>}
      <Button className="w-full" variant="danger" disabled={!avail.available || a.tx.busy} loading={a.tx.busy} onClick={() => { const v = validateEvidence(draft); if (v) return setErr(v); setReview(true); }}>
        Review challenge
      </Button>
      <TxStatus state={a.tx.state} onRetry={send} />
      <Dialog open={review} onClose={() => setReview(false)} title="Review challenge" footer={<><Button variant="secondary" onClick={() => setReview(false)}>Back</Button><Button variant="danger" onClick={send}>Publish evidence and sign</Button></>}>
        <dl className="divide-y divide-line">
          <KeyValue label="Challenging">Proposed {outcomeLabel(proposedOutcome)}</KeyValue>
          <KeyValue label="You claim">{outcomeLabel(outcomeToCode[claimed])}</KeyValue>
          <KeyValue label="Bond at stake">{formatMusd(bond)} MUSD</KeyValue>
        </dl>
      </Dialog>
    </Step>
  );
}

// ───────────────────────── Arbitrate ─────────────────────────

export function ArbitrateAction({
  marketId,
  avail,
  proposedOutcome,
  arbitrationDeadline,
  onDone,
}: {
  marketId: number;
  avail: Availability;
  proposedOutcome: number;
  arbitrationDeadline: Date;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>("yes");
  const [draft, setDraft] = useState<EvidenceDraft>(emptyEvidence);
  const [review, setReview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = useResolutionAction(marketId, onDone);
  const upholds = outcomeToCode[outcome] === proposedOutcome;

  async function send() {
    setReview(false);
    let doc: { hash: `0x${string}`; uri: string };
    try {
      doc = await a.publish("arbitration", draft, outcome);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    await a.tx.run({
      label: "Ruling",
      validate: async () => {
        const stage = await a.client!.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "stageOf", args: [BigInt(marketId)] });
        if (stage !== 3) throw new Error("There is no open challenge to rule on anymore.");
      },
      send: () =>
        a.writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: "arbitrate",
          args: [BigInt(marketId), outcomeToCode[outcome], doc.hash, doc.uri],
          chainId: deployment.chainId,
        }),
      onConfirmed: a.refreshAll,
    });
  }

  return (
    <Step title="Rule on the challenge">
      <p className="text-sm text-ink-2">
        You are this market&apos;s arbitrator. Rule by {formatDateTime(arbitrationDeadline)}. <Countdown seconds={avail.secondsLeft} />
      </p>
      <Segmented label="Final outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} />
      <p className="text-sm text-ink-2">
        {upholds
          ? `This upholds the proposal. The resolver receives both bonds.`
          : `This overturns the proposal (${outcomeLabel(proposedOutcome)}). The challenger receives both bonds.`}{" "}
        Your ruling is final and settles the market immediately.
      </p>
      <EvidenceComposer value={draft} onChange={(d) => { setDraft(d); setErr(null); }} summaryLabel="Rationale" summaryHint="Required. Explain which rule decided it and which evidence you relied on. Published and hash-committed." />
      {err && <Notice tone="error">{err}</Notice>}
      <Button className="w-full" disabled={!avail.available || a.tx.busy} loading={a.tx.busy} onClick={() => { const v = validateEvidence(draft); if (v) return setErr(v); setReview(true); }}>
        Review ruling
      </Button>
      <TxStatus state={a.tx.state} onRetry={send} />
      <Dialog open={review} onClose={() => setReview(false)} title="Confirm final ruling" footer={<><Button variant="secondary" onClick={() => setReview(false)}>Back</Button><Button onClick={send}>Publish rationale and sign</Button></>}>
        <Notice tone="warn" title="This cannot be undone">The market settles as {outcomeLabel(outcomeToCode[outcome])} the moment this transaction is mined.</Notice>
        <dl className="mt-3 divide-y divide-line">
          <KeyValue label="Ruling">{outcomeLabel(outcomeToCode[outcome])}</KeyValue>
          <KeyValue label="Bonds go to">{upholds ? "Resolver" : "Challenger"}</KeyValue>
        </dl>
      </Dialog>
    </Step>
  );
}

// ───────────────────────── Finalize ─────────────────────────

export function FinalizeAction({
  marketId,
  avail,
  onDone,
}: {
  marketId: number;
  avail: Availability & { outcome?: number; why?: string };
  onDone: () => void;
}) {
  const [review, setReview] = useState(false);
  const a = useResolutionAction(marketId, onDone);
  async function send() {
    setReview(false);
    await a.tx.run({
      label: "Finalize",
      send: () =>
        a.writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: "finalize",
          args: [BigInt(marketId)],
          chainId: deployment.chainId,
        }),
      onConfirmed: a.refreshAll,
    });
  }
  return (
    <Step title={`Finalize as ${outcomeLabel(avail.outcome)}`}>
      <p className="text-sm text-ink-2">{avail.why} Anyone can send this transaction; it pays no reward.</p>
      <Button className="w-full" disabled={!avail.available || a.tx.busy} loading={a.tx.busy} onClick={() => setReview(true)}>
        Finalize outcome
      </Button>
      <TxStatus state={a.tx.state} onRetry={send} />
      <Dialog open={review} onClose={() => setReview(false)} title="Finalize this market?" footer={<><Button variant="secondary" onClick={() => setReview(false)}>Back</Button><Button onClick={send}>Sign</Button></>}>
        <dl className="divide-y divide-line">
          <KeyValue label="Outcome">{outcomeLabel(avail.outcome)}</KeyValue>
        </dl>
        <p className="mt-3 text-sm text-ink-2">{avail.why} After this, claims open and the outcome can never change.</p>
      </Dialog>
    </Step>
  );
}
