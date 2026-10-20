"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi, parseEventLogs, parseUnits } from "viem";
import { useAccount, useBlock, usePublicClient, useWriteContract } from "wagmi";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field, Hint, KeyValue, Notice, inputClass } from "@/components/ui/primitives";
import { TxStatus } from "@/components/trading/TxStatus";
import { useMusd } from "@/hooks/useMusd";
import { useProtocolConfig } from "@/hooks/useProtocolConfig";
import { useTx } from "@/hooks/useTx";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { toContractApproval } from "@/lib/governance/approval";
import type { ProposalDto } from "@/lib/governance/dto";
import { formatDateTime, formatMusd, formatProb, formatShares } from "@/lib/format";
import { initialPool } from "@/lib/market/math";
import { metadataHash, serializeMetadata } from "@/lib/market/metadata";

/**
 * The only path from "approved" to "live": the designated publisher calls createMarket with the curator's
 * signed approval. The contract re-checks everything (creator role, curator role, hash, expiry, single use).
 */
export function PublishPanel({ proposal: p, onPublished }: { proposal: ProposalDto; onPublished: () => void }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const musd = useMusd();
  const proto = useProtocolConfig();
  const tx = useTx();
  const qc = useQueryClient();
  const block = useBlock({ chainId: deployment.chainId, watch: true, query: { enabled: deployment.ready } });
  const [liquidityText, setLiquidityText] = useState("100");
  const [probBps, setProbBps] = useState(5000);
  const [created, setCreated] = useState<bigint | null>(null);

  const approval = p.approval!;
  const cfg = proto.config;
  const nowSec = block.data ? Number(block.data.timestamp) : Math.floor(Date.now() / 1000);
  const expired = Number(approval.deadline) <= nowSec;
  const liquidity = (() => {
    try {
      return parseUnits(liquidityText || "0", 18);
    } catch {
      return 0n;
    }
  })();
  const raw = serializeMetadata(p.metadata);
  const hashOk = metadataHash(raw) === approval.metadataHash.toLowerCase() || metadataHash(raw) === approval.metadataHash;
  const pool = initialPool(liquidity > 0n ? liquidity : 1n, probBps);

  const problems: string[] = [];
  if (!deployment.ready) problems.push("No market contract is deployed on this network.");
  if (expired) problems.push("The curator's approval has expired. Ask for a fresh review.");
  if (!hashOk) problems.push("The stored rules no longer match the signed hash. Do not publish; ask a curator.");
  if (cfg && liquidity < cfg.minLiquidity) problems.push(`Seed at least ${formatMusd(cfg.minLiquidity)} MUSD.`);
  if (musd.balance !== undefined && liquidity > musd.balance) problems.push("Your MUSD balance is lower than the seed amount.");
  if (cfg && Number(approval.closeTime) - nowSec < cfg.minDuration + 60) problems.push("The approved close time is now too soon to publish. Ask for a new review with a later close.");

  async function publish() {
    if (!client || !cfg || !deployment.marketsAddress || !address || problems.length) return;
    const params = {
      metadata: raw,
      closeTime: BigInt(approval.closeTime),
      resolver: approval.resolver,
      initialLiquidity: liquidity,
      initialYesProbBps: probBps,
    };
    const allowance = await client.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "allowance", args: [address, deployment.marketsAddress] }).catch(() => 0n);
    if (allowance < liquidity) {
      const ok = await tx.run({
        label: "Approve MUSD",
        send: () => writeContractAsync({ address: deployment.musd, abi: erc20Abi, functionName: "approve", args: [deployment.marketsAddress!, liquidity], chainId: deployment.chainId }),
      });
      if (!ok) return;
    }
    await tx.run({
      label: "Publish market",
      validate: async () => {
        const [isCreator, isCurator, used, paused] = await Promise.all([
          client.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "isCreator", args: [address] }),
          client.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "isCurator", args: [approval.curator] }),
          client.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "approvalUsed", args: [approval.nonce] }),
          client.readContract({ address: deployment.marketsAddress!, abi: mezonkMarketsAbi, functionName: "paused" }),
        ]);
        if (paused) throw new Error("Market creation is paused right now.");
        if (!isCreator) throw new Error("This wallet is not an approved creator on-chain.");
        if (!isCurator) throw new Error("The approving curator is no longer approved. The market needs a new review.");
        if (used) throw new Error("This approval was already used to publish a market.");
      },
      send: () =>
        writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: "createMarket",
          // Tuple-of-struct args defeat wagmi's overload inference; the ABI still checks the encoding.
          args: [params, toContractApproval(approval), approval.curator, approval.signature] as never,
          chainId: deployment.chainId,
        }),
      onConfirmed: async (hash) => {
        const receipt = await client.getTransactionReceipt({ hash });
        const ev = parseEventLogs({ abi: mezonkMarketsAbi, logs: receipt.logs, eventName: "MarketCreated" })[0];
        if (ev) {
          setCreated(ev.args.marketId);
          void fetch(`/api/markets/${ev.args.marketId}/refresh`, { method: "POST" });
        }
        void qc.invalidateQueries({ queryKey: ["markets"] });
        void musd.refetch();
        onPublished();
      },
    });
  }

  if (created !== null) {
    return (
      <div className="space-y-3 rounded-lg border border-success/40 bg-success-soft p-4">
        <p className="font-semibold">Market #{created.toString()} is live</p>
        <p className="text-sm text-ink-2">Trading is open until {formatDateTime(Number(approval.closeTime) * 1000)}. The indexer links this suggestion to the market within a few seconds.</p>
        <ButtonLink href={`/markets/${created}`} size="sm">Open the market</ButtonLink>
        <TxStatus state={tx.state} />
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4" aria-labelledby="publish">
      <div>
        <h2 id="publish" className="font-semibold">Publish this market</h2>
        <p className="text-sm text-ink-2">You&apos;re the approved publisher. Seed the pool and the contract verifies the curator&apos;s signature.</p>
      </div>
      {!cfg ? (
        <Notice tone={proto.isError ? "error" : "info"}>{proto.isError ? "Couldn't read protocol settings from the chain." : "Reading protocol settings…"}</Notice>
      ) : (
        <>
          <Field label="Seed liquidity (MUSD)" htmlFor="liq" hint={`Minimum ${formatMusd(cfg.minLiquidity)}. Balance: ${musd.balance === undefined ? "—" : formatMusd(musd.balance)}.`}>
            <input id="liq" inputMode="decimal" value={liquidityText} onChange={(e) => /^\d*\.?\d{0,18}$/.test(e.target.value) && setLiquidityText(e.target.value)} className={cx(inputClass, "tnum")} />
          </Field>
          <div className="space-y-2">
            <label htmlFor="prob" className="flex items-center gap-1.5 text-sm font-semibold">
              Starting chance of Yes: <span className="tnum">{formatProb(probBps / 10_000)}</span>
              <Hint label="starting chance">Where trading starts. Any side you lean toward is given to you as shares, so you start with a position.</Hint>
            </label>
            <input id="prob" type="range" min={500} max={9500} step={100} value={probBps} onChange={(e) => setProbBps(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </div>
          <dl className="divide-y divide-line text-sm">
            <KeyValue label="Pool starts with">{formatShares(pool.poolYes)} Yes · {formatShares(pool.poolNo)} No</KeyValue>
            <KeyValue label="Your fee share">{(10_000 - cfg.protocolFeeShareBps) / 100}% of {cfg.feeBps / 100}%</KeyValue>
            <KeyValue label="Approval expires">{formatDateTime(Number(approval.deadline) * 1000)}</KeyValue>
            <KeyValue label="Cost now">{formatMusd(liquidity)} MUSD + gas</KeyValue>
          </dl>
          {problems.length > 0 && (
            <Notice tone="warn" title="Not ready to publish">
              <ul className="list-disc pl-4">{problems.map((e) => <li key={e}>{e}</li>)}</ul>
            </Notice>
          )}
          <Button size="lg" className="w-full" loading={tx.busy} disabled={problems.length > 0 || proto.paused} onClick={publish}>
            Publish · {formatMusd(liquidity)} MUSD
          </Button>
          <TxStatus state={tx.state} onRetry={publish} />
          {deployment.chain.testnet && musd.balance !== undefined && musd.balance < liquidity && (
            <p className="text-sm text-ink-2">Not enough MUSD. <a className="underline" href={TESTNET_FUNDING.borrowMusd} target="_blank" rel="noreferrer">Borrow testnet MUSD</a>.</p>
          )}
        </>
      )}
    </section>
  );
}
