"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress, type Address as Addr } from "viem";
import { useReadContracts, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Address } from "@/components/ui/Address";
import { KeyValue, Notice } from "@/components/ui/primitives";
import { TxStatus } from "@/components/trading/TxStatus";
import { useTx } from "@/hooks/useTx";
import { apiGet } from "@/lib/api/types";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, incentivesAbi } from "@/lib/contracts/abi";
import { formatMusd } from "@/lib/format";
import { cost, formatShares } from "@/lib/orderbook/math";
import { cancelEscrowed } from "@/features/trading/actions";
import type { RestingRow, SignedOrderRow } from "@/features/trading/api";

export const REF_KEY = "mezonk:ref";

/** Remembers a `?ref=0x…` link so the visitor can choose to set it as their referrer later (never automatic). */
export function RefCapture() {
  useEffect(() => {
    try {
      const r = new URLSearchParams(window.location.search).get("ref");
      if (r && isAddress(r)) localStorage.setItem(REF_KEY, r.toLowerCase());
    } catch {
      /* storage unavailable */
    }
  }, []);
  return null;
}

/** Escrowed orders, refunds, seeder rebates and referral credit for one wallet. All amounts are contract reads. */
export function LiquidityAndIncentives({ address }: { address: string }) {
  const orders = useQuery({
    queryKey: ["orders", address.toLowerCase(), "all"],
    queryFn: () => apiGet<{ signed: SignedOrderRow[]; resting: RestingRow[] }>(`/api/orders?maker=${address}`),
    refetchInterval: 15_000,
  });
  const open = (orders.data?.resting ?? []).filter((r) => r.status === "open");
  const seedMarkets = [...new Set((orders.data?.resting ?? []).filter((r) => r.seed).map((r) => r.marketId))];
  const openMarkets = [...new Set(open.map((r) => r.marketId))];
  const signedOpen = (orders.data?.signed ?? []).filter((o) => o.status === "open" || o.status === "stale");

  const e = { address: deployment.marketsAddress!, abi: exchangeAbi, chainId: deployment.chainId } as const;
  const inc = { address: deployment.incentivesAddress!, abi: incentivesAbi, chainId: deployment.chainId } as const;
  const me = address as Addr;
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      ...openMarkets.map((id) => ({ ...e, functionName: "stageOf" as const, args: [BigInt(id)] as const })),
      ...seedMarkets.flatMap((id) => [
        { ...inc, functionName: "rebateClaimable" as const, args: [BigInt(id), me] as const },
        { ...inc, functionName: "rebateClaimed" as const, args: [BigInt(id), me] as const },
      ]),
      { ...inc, functionName: "referrerOf" as const, args: [me] as const },
      { ...inc, functionName: "referralCredits" as const, args: [me] as const },
      { ...e, functionName: "hasTraded" as const, args: [me] as const },
    ],
    query: { enabled: deployment.ready, refetchInterval: 15_000 },
  });
  const r = reads.data ?? [];
  const val = <T,>(i: number) => (r[i]?.status === "success" ? (r[i]!.result as T) : undefined);
  const stageOf = new Map(openMarkets.map((id, i) => [id, val<number>(i)]));
  const off = openMarkets.length;
  const rebates = seedMarkets.map((id, i) => ({ id, claimable: val<bigint>(off + i * 2) ?? 0n, claimed: val<bigint>(off + i * 2 + 1) ?? 0n }));
  const tail = off + seedMarkets.length * 2;
  const referrer = val<string>(tail);
  const credits = val<bigint>(tail + 1) ?? 0n;
  const traded = val<boolean>(tail + 2) ?? false;

  const tx = useTx();
  const { writeContractAsync } = useWriteContract();
  const refresh = () => {
    void orders.refetch();
    void reads.refetch();
  };
  const locked = open.reduce((a, o) => a + (o.side === 0 ? cost(BigInt(o.remaining), o.price) : 0n), 0n);

  const [pendingRef, setPendingRef] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPendingRef(localStorage.getItem(REF_KEY));
    } catch {
      setPendingRef(null);
    }
  }, []);
  const hasRef = !!referrer && referrer !== "0x0000000000000000000000000000000000000000";
  const canSetRef = !hasRef && !traded && !!pendingRef && pendingRef !== address.toLowerCase();
  const [copied, setCopied] = useState(false);

  return (
    <section aria-labelledby="liq" className="space-y-6">
      <h2 id="liq" className="text-xl font-semibold">Orders, refunds and rewards</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3 p-5">
          <h3 className="font-medium">Escrowed orders</h3>
          <p className="text-sm text-ink-2">{formatMusd(locked)} MUSD locked in open buy orders. {signedOpen.length} signed order{signedOpen.length === 1 ? "" : "s"} on books (funds stay in your wallet).</p>
          {open.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {open.map((o) => {
                const st = stageOf.get(o.marketId);
                const refundable = st === 2 || st === 3 || st === 4;
                return (
                  <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <Link href={`/markets/${o.marketId}`} className="underline decoration-line underline-offset-2">#{o.marketId}</Link>{" "}
                      {o.side === 0 ? "Buy" : "Sell"} {o.outcome === 0 ? "Yes" : "No"} <span className="mono">{formatShares(BigInt(o.remaining))} @ {o.price}¢</span>
                      {o.seed && <span className="text-muted"> · seed</span>}
                    </span>
                    {refundable ? (
                      <Button size="sm" loading={tx.busy} onClick={() => tx.run({ label: st === 2 ? "Refund" : "Cancel order", send: () => cancelEscrowed(writeContractAsync as never, o.orderId), onConfirmed: refresh })}>
                        {st === 2 ? `Refund ${formatMusd(cost(BigInt(o.remaining), o.price))}` : "Cancel"}
                      </Button>
                    ) : (
                      <Link href={`/markets/${o.marketId}`} className="text-xs text-ink-2 underline">Manage on market</Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel space-y-3 p-5">
          <h3 className="font-medium">Seeder rebates</h3>
          <p className="text-sm text-ink-2">A share of taker fees on markets you helped launch. Paid only from fees actually collected; not interest.</p>
          {rebates.length === 0 ? (
            <p className="text-sm text-muted">You haven&apos;t seeded a market.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {rebates.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/markets/${b.id}`} className="underline decoration-line underline-offset-2">#{b.id}</Link> · claimed {formatMusd(b.claimed)}
                  </span>
                  <Button
                    size="sm"
                    variant={b.claimable > 0n ? "primary" : "secondary"}
                    disabled={b.claimable === 0n}
                    loading={tx.busy}
                    onClick={() =>
                      tx.run({
                        label: "Claim rebate",
                        send: () => writeContractAsync({ ...inc, functionName: "claimRebate", args: [BigInt(b.id)] }),
                        onConfirmed: refresh,
                      })
                    }
                  >
                    {b.claimable > 0n ? `Claim ${formatMusd(b.claimable)}` : "Nothing yet"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel space-y-3 p-5">
        <h3 className="font-medium">Referrals</h3>
        <dl className="divide-y divide-line text-sm">
          <KeyValue label="Your link">
            <button
              type="button"
              className="mono text-xs underline decoration-line underline-offset-2"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/?ref=${address}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked */
                }
              }}
            >
              {copied ? "Copied" : "Copy referral link"}
            </button>
          </KeyValue>
          <KeyValue label="Your referrer">{hasRef ? <Address address={referrer!} label="Referrer" /> : "None"}</KeyValue>
          <KeyValue label="Referral credit">{formatMusd(credits)} MUSD</KeyValue>
        </dl>
        <p className="text-xs text-muted">
          You earn a share of the taker fees paid by people you refer, from their real trades only (never your own orders), capped per market.
          A referrer is set once, before your first trade, and can&apos;t be yourself or someone you referred.
        </p>
        {canSetRef && (
          <Notice
            tone="info"
            title="You arrived through a referral link"
            action={
              <Button
                size="sm"
                loading={tx.busy}
                onClick={() => tx.run({ label: "Set referrer", send: () => writeContractAsync({ ...inc, functionName: "setReferrer", args: [pendingRef as Addr] }), onConfirmed: refresh })}
              >
                Set as referrer
              </Button>
            }
          >
            <Address address={pendingRef!} label="Referrer" /> would get part of the fees you pay. It costs you nothing extra and can&apos;t be changed later.
          </Notice>
        )}
        {credits > 0n && (
          <Button loading={tx.busy} onClick={() => tx.run({ label: "Claim referral credit", send: () => writeContractAsync({ ...inc, functionName: "claimReferral", args: [] }), onConfirmed: refresh })}>
            Claim {formatMusd(credits)} MUSD
          </Button>
        )}
      </div>
      <TxStatus state={tx.state} />
    </section>
  );
}
