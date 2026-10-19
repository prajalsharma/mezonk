"use client";

import { Address } from "@/components/ui/Address";
import { KeyValue, Skeleton } from "@/components/ui/primitives";
import { useProtocolConfig } from "@/hooks/useProtocolConfig";
import { formatDuration, formatMusd } from "@/lib/format";

/** Current parameters for new markets, read from the contract (existing markets keep their own snapshot). */
export function LiveParams() {
  const { config: c, paused, isError } = useProtocolConfig();
  if (isError) return <p className="text-sm text-warn">Couldn&apos;t read parameters from the chain right now.</p>;
  if (!c) return <Skeleton className="h-48 w-full" />;
  return (
    <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
      <KeyValue label="Trading fee">{c.feeBps / 100}% on each buy (of MUSD in) and sell (of MUSD out)</KeyValue>
      <KeyValue label="Fee split">{(10_000 - c.protocolFeeShareBps) / 100}% market creator · {c.protocolFeeShareBps / 100}% protocol</KeyValue>
      <KeyValue label="Minimum seed liquidity">{formatMusd(c.minLiquidity)} MUSD</KeyValue>
      <KeyValue label="Market duration">{formatDuration(c.minDuration)} to {formatDuration(c.maxDuration)}</KeyValue>
      <KeyValue label="Proposal window">{formatDuration(c.proposalWindow)} after close</KeyValue>
      <KeyValue label="Challenge window">{formatDuration(c.challengeWindow)}</KeyValue>
      <KeyValue label="Arbitration window">{formatDuration(c.arbitrationWindow)}</KeyValue>
      <KeyValue label="Proposal bond · challenge bond">{formatMusd(c.proposerBond)} · {formatMusd(c.disputeBond)} MUSD</KeyValue>
      <KeyValue label="Arbitrator"><Address address={c.arbitrator} label="Arbitrator" /></KeyValue>
      <KeyValue label="New markets and trading">{paused ? "Paused" : "Active"}</KeyValue>
    </dl>
  );
}
