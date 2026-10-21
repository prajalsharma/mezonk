"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount, useBlock, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { Button, ButtonLink } from "@/components/ui/Button";
import { KeyValue, Notice } from "@/components/ui/primitives";
import { TxStatus } from "@/components/trading/TxStatus";
import { useProtocolConfig } from "@/hooks/useProtocolConfig";
import { useTx } from "@/hooks/useTx";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, factoryAbi } from "@/lib/contracts/abi";
import { toContractApproval } from "@/lib/governance/approval";
import type { ProposalDto } from "@/lib/governance/dto";
import { formatDateTime, formatDuration, formatMusd } from "@/lib/format";
import { formatShares } from "@/lib/orderbook/math";
import { metadataHash, serializeMetadata } from "@/lib/market/metadata";

/**
 * The only path from "approved" to a market: the designated publisher calls the factory with the curator's
 * signed approval (which binds the rules, resolver, close time and graduation/fee policy). The market starts in
 * SEEDING. It trades only after funded seed orders meet that policy on-chain. Publishing costs gas only.
 */
export function PublishPanel({ proposal: p, onPublished }: { proposal: ProposalDto; onPublished: () => void }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const proto = useProtocolConfig();
  const tx = useTx();
  const qc = useQueryClient();
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });
  const [created, setCreated] = useState<bigint | null>(null);

  const approval = p.approval!;
  const policyId = Number(approval.policyId ?? 0);
  const policy = useReadContract({
    address: deployment.marketsAddress!,
    abi: exchangeAbi,
    functionName: "getPolicy",
    args: [policyId],
    chainId: deployment.chainId,
    query: { enabled: deployment.ready && policyId > 0 },
  });
  const active = useReadContract({
    address: deployment.marketsAddress!,
    abi: exchangeAbi,
    functionName: "policyActive",
    args: [policyId],
    chainId: deployment.chainId,
    query: { enabled: deployment.ready && policyId > 0 },
  });
  const cfg = proto.config;
  const pol = policy.data;
  const nowSec = block.data ? Number(block.data.timestamp) : Math.floor(Date.now() / 1000);
  const raw = serializeMetadata(p.metadata);
  const hashOk = metadataHash(raw).toLowerCase() === approval.metadataHash.toLowerCase();

  const problems: string[] = [];
  if (!deployment.ready) problems.push("No exchange is deployed on this network.");
  if (Number(approval.deadline) <= nowSec) problems.push("The curator's approval has expired. Ask for a fresh review.");
  if (!hashOk) problems.push("The stored rules no longer match the signed hash. Do not publish; ask a curator.");
  if (!policyId) problems.push("This approval predates graduation policies. Ask a curator to approve it again.");
  if (active.data === false) problems.push(`Policy #${policyId} no longer accepts new markets. Ask a curator to approve it again.`);
  if (cfg && pol && Number(approval.closeTime) < nowSec + pol.seedingPeriod + cfg.minLiveDuration + 60) {
    problems.push("The approved close time is now too soon: it must leave room to seed and then trade. Ask for a later close.");
  }

  async function publish() {
    if (!client || !deployment.factoryAddress || !address || problems.length) return;
    const params = { metadata: raw, closeTime: BigInt(approval.closeTime), resolver: approval.resolver, policyId };
    const f = { address: deployment.factoryAddress, abi: factoryAbi } as const;
    await tx.run({
      label: "Publish market",
      validate: async () => {
        const [isCreator, isCurator, used, paused] = await Promise.all([
          client.readContract({ ...f, functionName: "isCreator", args: [address] }),
          client.readContract({ ...f, functionName: "isCurator", args: [approval.curator] }),
          client.readContract({ ...f, functionName: "approvalUsed", args: [approval.nonce] }),
          client.readContract({ address: deployment.marketsAddress!, abi: exchangeAbi, functionName: "paused" }),
        ]);
        if (paused) throw new Error("Market creation is paused right now.");
        if (!isCreator) throw new Error("This wallet is not an approved creator on-chain.");
        if (!isCurator) throw new Error("The approving curator is no longer approved. The market needs a new review.");
        if (used) throw new Error("This approval was already used or withdrawn.");
      },
      send: () =>
        writeContractAsync({
          ...f,
          functionName: "createMarket",
          // Tuple-of-struct args defeat wagmi's inference; the ABI still checks the encoding.
          args: [params, toContractApproval(approval), approval.curator, approval.signature] as never,
          chainId: deployment.chainId,
        }),
      onConfirmed: async (hash) => {
        const receipt = await client.getTransactionReceipt({ hash });
        const ev = parseEventLogs({ abi: exchangeAbi, logs: receipt.logs, eventName: "MarketCreated" })[0];
        if (ev) {
          setCreated(ev.args.marketId);
          void fetch(`/api/markets/${ev.args.marketId}/refresh`, { method: "POST" });
        }
        void qc.invalidateQueries({ queryKey: ["markets"] });
        onPublished();
      },
    });
  }

  if (created !== null) {
    return (
      <div className="space-y-3 rounded-lg border border-success/40 bg-success-soft p-4">
        <p className="font-semibold">Market #{created.toString()} is published and seeding</p>
        <p className="text-sm text-ink-2">
          It is not trading yet. It goes live when funded seed orders meet policy #{policyId}
          {pol ? `, within ${formatDuration(pol.seedingPeriod)}` : ""}. If they don&apos;t, seeders get their deposits back.
        </p>
        <ButtonLink href={`/markets/${created}`} size="sm">Open the market</ButtonLink>
        <TxStatus state={tx.state} />
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4" aria-labelledby="publish">
      <div>
        <h2 id="publish" className="font-semibold">Publish this market</h2>
        <p className="text-sm text-ink-2">
          You&apos;re the approved publisher. Publishing opens seeding; it doesn&apos;t make the market tradable and doesn&apos;t need any MUSD from you.
        </p>
      </div>
      {!cfg || !pol ? (
        <Notice tone={proto.isError || policy.isError ? "error" : "info"}>
          {proto.isError || policy.isError ? "Couldn't read the policy from the chain." : "Reading the approved policy…"}
        </Notice>
      ) : (
        <>
          <dl className="divide-y divide-line text-sm">
            <KeyValue label="Policy (signed by the curator)">#{policyId}</KeyValue>
            <KeyValue label="Seeding period">{formatDuration(pol.seedingPeriod)}</KeyValue>
            <KeyValue label="Launches when">
              {formatShares(pol.minBidDepth)} bid and {formatShares(pol.minAskDepth)} offered within {pol.band}¢, spread ≤ {pol.maxSpread}¢, {pol.minSeeders}+ seeders
              ({formatMusd(pol.minSeederNotional)}+ MUSD each)
            </KeyValue>
            <KeyValue label="Taker fee">{pol.takerFeeBps / 100}% · {pol.rebateShareBps / 100}% of it to seeders, {pol.referralShareBps / 100}% to referrers</KeyValue>
            <KeyValue label="Approval expires">{formatDateTime(Number(approval.deadline) * 1000)}</KeyValue>
            <KeyValue label="Cost now">Gas only</KeyValue>
          </dl>
          {problems.length > 0 && (
            <Notice tone="warn" title="Not ready to publish">
              <ul className="list-disc pl-4">{problems.map((e) => <li key={e}>{e}</li>)}</ul>
            </Notice>
          )}
          <Button size="lg" className="w-full" loading={tx.busy} disabled={problems.length > 0 || proto.paused} onClick={publish}>
            Publish and start seeding
          </Button>
          <TxStatus state={tx.state} onRetry={publish} />
        </>
      )}
    </section>
  );
}
