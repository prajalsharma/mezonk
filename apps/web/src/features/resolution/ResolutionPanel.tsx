"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAccount, useBlock } from "wagmi";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { KeyValue, Notice, Skeleton, Status } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useMusd } from "@/hooks/useMusd";
import type { MarketChain } from "@/hooks/useMarketChain";
import { apiGet } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { formatDateTime, formatDuration, formatMusd } from "@/lib/format";
import { CHAIN_STAGE, permissions, type Permissions } from "@/lib/market/permissions";
import { FINALIZE_REASON, outcomeLabel } from "@/lib/market/stage";
import { ArbitrateAction, DisputeAction, FinalizeAction, ProposeAction } from "./Actions";
import { ArbitrationWorkspace } from "./ArbitrationWorkspace";
import { ClaimButton, RedeemDetails } from "./Claims";
import { Timeline } from "./Timeline";
import type { ResolutionDto } from "./types";

const d = (s: bigint) => new Date(Number(s) * 1000);

/** Logical lifecycle label from authoritative contract stage + chain time. */
function lifecycle(stage: number, p: Permissions, finalOutcome: number) {
  switch (stage) {
    case CHAIN_STAGE.Open:
      return { tone: "yes" as const, label: "Open", sub: "Trading is live." };
    case CHAIN_STAGE.Closed:
      return p.finalize.available || p.finalize.needsWallet
        ? { tone: "warn" as const, label: "Closed · no proposal in time", sub: "Can be finalized as Invalid." }
        : { tone: "muted" as const, label: "Closed · awaiting proposal", sub: "The resolver has not proposed an outcome yet." };
    case CHAIN_STAGE.Proposed:
      return p.finalize.available || p.finalize.needsWallet
        ? { tone: "info" as const, label: "Proposed · challenge window over", sub: "Ready to finalize." }
        : { tone: "info" as const, label: "Proposed · challenge window open", sub: "The outcome is not final yet." };
    case CHAIN_STAGE.Disputed:
      return p.finalize.available || p.finalize.needsWallet
        ? { tone: "warn" as const, label: "Challenged · arbitration lapsed", sub: "Can be finalized as Invalid." }
        : { tone: "warn" as const, label: "Challenged · in arbitration", sub: "Waiting for the arbitrator's ruling." };
    default:
      return finalOutcome === 3
        ? { tone: "muted" as const, label: "Invalid · refunds open", sub: "Every share redeems for 0.5 MUSD." }
        : { tone: "accent" as const, label: `Finalized ${outcomeLabel(finalOutcome)} · claims open`, sub: `Each ${outcomeLabel(finalOutcome)} share redeems for 1 MUSD.` };
  }
}

export function ResolutionPanel({
  marketId,
  chain,
  question,
  structured,
  rules,
}: {
  marketId: number;
  chain: MarketChain;
  question: string;
  structured: boolean;
  rules: ReactNode;
}) {
  const { address, chainId } = useAccount();
  const musd = useMusd();
  const qc = useQueryClient();
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });
  const [refreshing, setRefreshing] = useState(false);
  const res = useQuery({
    queryKey: ["resolution", marketId],
    queryFn: () => apiGet<ResolutionDto>(`/api/resolution/${marketId}`),
    refetchInterval: 15_000,
  });

  const m = chain.market;
  const refreshAll = () => {
    void chain.refetch();
    void musd.refetch();
    void qc.invalidateQueries({ queryKey: ["resolution", marketId] });
  };

  async function reconcile() {
    setRefreshing(true);
    try {
      await fetch(`/api/markets/${marketId}/refresh`, { method: "POST" });
    } finally {
      refreshAll();
      setRefreshing(false);
    }
  }

  if (!m || chain.stage === undefined) {
    return (
      <section aria-labelledby="resolution" className="space-y-3">
        <h2 id="resolution" className="text-xl font-semibold">Resolution</h2>
        {chain.isError ? (
          <Notice tone="error" title="Couldn't read the market from the chain">The RPC didn't respond. Retry shortly.</Notice>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </section>
    );
  }

  const chainNow = block.data?.timestamp ?? BigInt(Math.floor(Date.now() / 1000));
  const p = permissions({
    account: address,
    onRightChain: chainId === deployment.chainId,
    chainNow,
    stage: chain.stage,
    market: m,
    yes: chain.yes,
    no: chain.no,
    claimable: chain.claimable,
    bondCredits: chain.bondCredits,
    musdBalance: musd.balance,
  });
  const life = lifecycle(chain.stage, p, m.finalOutcome);
  const proposalDeadline = d(m.closeTime + BigInt(m.proposalWindow));
  const challengeDeadline = m.proposedAt ? d(m.proposedAt + BigInt(m.challengeWindow)) : null;
  const arbitrationDeadline = m.disputedAt ? d(m.disputedAt + BigInt(m.arbitrationWindow)) : null;
  const finalizedEntry = res.data?.timeline.find((e) => e.kind === "finalized");
  const needsWallet = [p.propose, p.dispute, p.finalize, p.redeem].some((a) => a.needsWallet);

  // Actions this wallet can take now, in priority order.
  const actions: ReactNode[] = [];
  if (p.propose.available) actions.push(<ProposeAction key="p" marketId={marketId} avail={p.propose} bond={m.proposerBond} challengeWindow={m.challengeWindow} rules={rules} onDone={refreshAll} />);
  if (p.arbitrate.available && arbitrationDeadline) actions.push(<ArbitrateAction key="a" marketId={marketId} avail={p.arbitrate} proposedOutcome={m.proposedOutcome} arbitrationDeadline={arbitrationDeadline} onDone={refreshAll} />);
  if (p.dispute.available && challengeDeadline) actions.push(<DisputeAction key="d" marketId={marketId} avail={p.dispute} bond={m.disputeBond} proposedOutcome={m.proposedOutcome} challengeDeadline={challengeDeadline} onDone={refreshAll} />);
  if (p.finalize.available) actions.push(<FinalizeAction key="f" marketId={marketId} avail={p.finalize} onDone={refreshAll} />);

  const claims: ReactNode[] = [];
  if (p.redeem.payout > 0n)
    claims.push(
      <ClaimButton key="r" fn="redeem" marketId={marketId} account={address} avail={p.redeem} amount={p.redeem.payout} title={p.redeem.kind === "refund" ? "Claim refund" : "Claim payout"} details={<RedeemDetails outcome={m.finalOutcome} yes={chain.yes} no={chain.no} />} onDone={refreshAll} />,
    );
  if (p.claimLiquidity.available || (p.roles.includes("creator") && m.finalized && !m.liquidityClaimed))
    claims.push(<ClaimButton key="l" fn="claimLiquidity" variant="secondary" marketId={marketId} account={address} avail={p.claimLiquidity} amount={p.claimLiquidity.payout} title="Withdraw pool liquidity" details={<KeyValue label="Pool shares redeemed">At the final outcome rate</KeyValue>} onDone={refreshAll} />);
  if (p.claimFees.available)
    claims.push(<ClaimButton key="f" fn="claimCreatorFees" variant="secondary" marketId={marketId} account={address} avail={p.claimFees} amount={p.claimFees.amount} title="Claim creator fees" details={<KeyValue label="Source">Creator share of trading fees</KeyValue>} onDone={refreshAll} />);
  if (p.withdrawBond.available)
    claims.push(<ClaimButton key="b" fn="withdrawBond" variant="secondary" marketId={marketId} account={address} avail={p.withdrawBond} amount={p.withdrawBond.amount} title="Withdraw bonds" details={<KeyValue label="Covers">All bonds returned or won, across markets</KeyValue>} onDone={refreshAll} />);

  return (
    <section aria-labelledby="resolution" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="resolution" className="text-xl font-semibold">Resolution</h2>
        <Button variant="ghost" size="sm" loading={refreshing} icon={<RefreshCw className="size-3.5" />} onClick={reconcile}>
          Refresh from chain
        </Button>
      </div>

      {!structured && (
        <Notice tone="warn" title="Deficient resolution rules">
          This market was created without MEZONK&apos;s structured rules. Policy: the resolver should propose Invalid unless the raw text
          unambiguously decides it, and anyone may challenge any other proposal. Rules are never added after creation.
        </Notice>
      )}

      {/* Status summary: authoritative stage read from the contract. */}
      <div className="rounded-lg border border-line bg-surface p-4" aria-live="polite">
        <p className="text-sm text-ink-2">{question}</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-semibold"><Status tone={life.tone}><span className="text-lg font-semibold text-ink">{life.label}</span></Status></span>
          <span className="text-sm text-ink-2">{life.sub}</span>
        </div>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <KeyValue label="Outcomes">Yes · No · Invalid</KeyValue>
          <KeyValue label="Trading cutoff">{formatDateTime(d(m.closeTime))}</KeyValue>
          <KeyValue label="Proposal deadline">{formatDateTime(proposalDeadline)}</KeyValue>
          <KeyValue label="Proposed outcome">{m.proposedAt ? outcomeLabel(m.proposedOutcome) : "None yet"}</KeyValue>
          {m.proposedAt > 0n && <KeyValue label="Proposed at">{formatDateTime(d(m.proposedAt))}</KeyValue>}
          {m.proposedAt > 0n && <KeyValue label="Proposer"><Address address={m.resolver} you={address} label="Proposer" /></KeyValue>}
          {challengeDeadline && <KeyValue label="Challenge deadline">{formatDateTime(challengeDeadline)}</KeyValue>}
          <KeyValue label="Challenge filed">{m.disputedAt ? "Yes" : m.proposedAt ? "No" : "—"}</KeyValue>
          {m.disputedAt > 0n && <KeyValue label="Challenger"><Address address={m.disputer} you={address} label="Challenger" /></KeyValue>}
          {arbitrationDeadline && (
            <KeyValue label="Arbitration">
              {m.finalized ? (res.data?.finalizeReason === 1 ? `Ruled ${outcomeLabel(m.finalOutcome)}` : "No ruling (lapsed)") : `Due by ${formatDateTime(arbitrationDeadline)}`}
            </KeyValue>
          )}
          <KeyValue label="Final outcome">{m.finalized ? outcomeLabel(m.finalOutcome) : "Not final"}</KeyValue>
          {finalizedEntry && <KeyValue label="Finalized at">{formatDateTime(new Date(finalizedEntry.at))}</KeyValue>}
          {m.finalized && res.data?.finalizeReason != null && <KeyValue label="How">{FINALIZE_REASON[res.data.finalizeReason]}</KeyValue>}
          <KeyValue label="Claims">{m.finalized ? "Open · no deadline" : "Not open"}</KeyValue>
        </dl>
      </div>

      {/* Role-aware action area */}
      <div className="space-y-4" aria-label="Your actions">
        {claims.length > 0 && <div className="space-y-3 rounded-lg border border-line bg-surface p-4"><h3 className="text-base font-semibold">Your claims</h3>{claims}</div>}
        {p.roles.includes("arbitrator") && chain.stage === CHAIN_STAGE.Disputed && res.data && (
          <ArbitrationWorkspace timeline={res.data.timeline} documents={res.data.documents} />
        )}
        {actions}
        {!actions.length && !claims.length && (
          <div className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-2">
            {needsWallet && !address ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Connect a wallet to participate in resolution or claim.</span>
                <WalletButton />
              </div>
            ) : (
              <NoActionReason p={p} stage={chain.stage} />
            )}
          </div>
        )}
      </div>

      {/* Who can do what */}
      <details className="group rounded-lg border border-line bg-surface p-4" open={!address}>
        <summary className="cursor-pointer text-base font-semibold">Roles, windows and bonds</summary>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <KeyValue label="Proposes the outcome"><Address address={m.resolver} you={address} label="Resolver" /></KeyValue>
          <KeyValue label="Rules on challenges"><Address address={m.arbitrator} you={address} label="Arbitrator" /></KeyValue>
          <KeyValue label="Can challenge">Anyone except the resolver</KeyValue>
          <KeyValue label="Can finalize">Anyone, once a deadline passes</KeyValue>
          <KeyValue label="Proposal window">{formatDuration(m.proposalWindow)} after close</KeyValue>
          <KeyValue label="Challenge window">{formatDuration(m.challengeWindow)}</KeyValue>
          <KeyValue label="Arbitration window">{formatDuration(m.arbitrationWindow)}</KeyValue>
          <KeyValue label="Proposal bond">{formatMusd(m.proposerBond)} MUSD</KeyValue>
          <KeyValue label="Challenge bond">{formatMusd(m.disputeBond)} MUSD</KeyValue>
          <KeyValue label="Trading fee">{m.feeBps / 100}% · claims are free</KeyValue>
        </dl>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>No proposal in time, or no ruling in time: the market settles as Invalid and every share redeems for 0.5 MUSD.</li>
          <li>The losing side of a challenge forfeits its bond to the winning side. A lapsed arbitration refunds both.</li>
          <li>All roles and windows were fixed when the market was created. The protocol owner cannot propose, rule or change a final outcome.</li>
        </ul>
      </details>

      {/* Public evidence trail */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">Evidence trail</h3>
          {res.data?.indexer && (res.data.indexer.stale || (res.data.indexer.lagBlocks ?? 0) > 20) && (
            <span className="text-sm text-warn">Indexer is behind the chain. Recent actions may be missing; the status above is live.</span>
          )}
        </div>
        {res.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : res.error || !res.data ? (
          <Notice tone="warn" title="Evidence trail unavailable" action={<Button size="sm" variant="secondary" onClick={() => res.refetch()}>Retry</Button>}>
            The indexer couldn&apos;t be reached. Everything in the status summary above is read live from the contract.
          </Notice>
        ) : (
          <Timeline entries={res.data.timeline} documents={res.data.documents} you={address} />
        )}
      </div>
    </section>
  );
}

function NoActionReason({ p, stage }: { p: Permissions; stage: number }) {
  const lines: string[] = [];
  if (stage === CHAIN_STAGE.Closed) lines.push(p.propose.reason);
  if (stage === CHAIN_STAGE.Proposed) lines.push(p.dispute.reason, p.finalize.reason);
  if (stage === CHAIN_STAGE.Disputed) lines.push(p.arbitrate.reason, p.finalize.reason);
  if (stage === CHAIN_STAGE.Finalized) lines.push(p.redeem.reason);
  if (stage === CHAIN_STAGE.Open) lines.push("Resolution starts after trading closes.");
  return (
    <ul className="space-y-1">
      {[...new Set(lines)].map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
