"use client";

import { Address } from "@/components/ui/Address";
import { KeyValue, Skeleton } from "@/components/ui/primitives";
import { useLatestPolicy, useProtocolConfig } from "@/hooks/useProtocolConfig";
import { formatDuration, formatMusd } from "@/lib/format";
import { formatShares } from "@/lib/orderbook/math";

/** Current parameters for new markets, read from the contracts (existing markets keep the policy they were published under). */
export function LiveParams() {
  const { config: c, paused, isError } = useProtocolConfig();
  const lp = useLatestPolicy();
  if (isError) return <p className="text-sm text-warn">Couldn&apos;t read parameters from the chain right now.</p>;
  if (!c) return <Skeleton className="h-48 w-full" />;
  const p = lp.policy;
  return (
    <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
      {p ? (
        <>
          <KeyValue label={`Policy #${lp.id}`}>{lp.active ? "Accepting new markets" : "Retired for new markets"}</KeyValue>
          <KeyValue label="Taker fee">{p.takerFeeBps / 100}% of the taker&apos;s notional · makers pay nothing</KeyValue>
          <KeyValue label="Fee use">{p.rebateShareBps / 100}% to the market&apos;s seeders (for {formatDuration(p.rebatePeriod)}) · {p.referralShareBps / 100}% to referrers · rest protocol</KeyValue>
          <KeyValue label="Seeding">
            {formatDuration(p.seedingPeriod)} to reach {formatShares(p.minBidDepth)} bid / {formatShares(p.minAskDepth)} offered within {p.band}¢, spread ≤ {p.maxSpread}¢,
            {" "}{p.minSeeders}+ seeders ({formatMusd(p.minSeederNotional)}+ MUSD each)
          </KeyValue>
          <KeyValue label="Seed order lock">{formatDuration(p.minRest)} after placing, and again after launch</KeyValue>
          <KeyValue label="Rebate caps">{formatMusd(p.rebateCapPerWallet)} per wallet · {formatMusd(p.rebateCapPerMarket)} per market · {formatMusd(p.rebateBudget)} for the policy</KeyValue>
        </>
      ) : (
        <KeyValue label="Policy">{lp.isLoading ? "Reading…" : "None yet: no market can be published"}</KeyValue>
      )}
      <KeyValue label="Minimum live time">{formatDuration(c.minLiveDuration)} after seeding ends · up to {formatDuration(c.maxDuration)} in total</KeyValue>
      <KeyValue label="Proposal window">{formatDuration(c.proposalWindow)} after close</KeyValue>
      <KeyValue label="Challenge window">{formatDuration(c.challengeWindow)}</KeyValue>
      <KeyValue label="Arbitration window">{formatDuration(c.arbitrationWindow)}</KeyValue>
      <KeyValue label="Proposal bond · challenge bond">{formatMusd(c.proposerBond)} · {formatMusd(c.disputeBond)} MUSD</KeyValue>
      <KeyValue label="Arbitrator"><Address address={c.arbitrator} label="Arbitrator" /></KeyValue>
      <KeyValue label="New markets and trading">{paused ? "Paused" : "Active"}</KeyValue>
    </dl>
  );
}
