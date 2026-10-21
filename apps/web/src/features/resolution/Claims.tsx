"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { KeyValue } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { TxStatus } from "@/components/trading/TxStatus";
import { useTx } from "@/hooks/useTx";
import { usePendingTxs } from "@/hooks/usePendingTxs";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, resolutionAbi } from "@/lib/contracts/abi";
import { formatMusd, formatShares, shortAddress } from "@/lib/format";
import { outcomeLabel } from "@/lib/market/stage";
import type { Availability } from "@/lib/market/permissions";

type Fn = "redeem" | "withdrawBond";

/** Redemption pays from the exchange's collateral; bonds are held by the resolution contract. */
const target = (fn: Fn) =>
  fn === "withdrawBond"
    ? ({ address: deployment.resolutionAddress!, abi: resolutionAbi } as const)
    : ({ address: deployment.marketsAddress!, abi: exchangeAbi } as const);

/** Estimated network fee in BTC for a call; undefined while loading or if estimation fails. */
function useGasEstimate(fn: Fn, marketId: number, account?: `0x${string}`, enabled = true) {
  const client = usePublicClient({ chainId: deployment.chainId });
  const [fee, setFee] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !client || !account || !deployment.marketsAddress) return;
    let alive = true;
    (async () => {
      try {
        const gas = await client.estimateContractGas({
          ...target(fn),
          functionName: fn,
          args: fn === "withdrawBond" ? [] : [BigInt(marketId)],
          account,
        } as never);
        const price = await client.getGasPrice();
        if (alive) setFee(Number(formatUnits(gas * price, 18)).toPrecision(2));
      } catch {
        if (alive) setFee(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, account, fn, marketId, enabled]);
  return fee;
}

export function ClaimButton({
  fn,
  marketId,
  account,
  avail,
  amount,
  title,
  details,
  onDone,
  variant = "primary",
}: {
  fn: Fn;
  marketId: number;
  account?: `0x${string}`;
  avail: Availability;
  amount: bigint;
  title: string;
  details: React.ReactNode;
  onDone: (c?: { label: string; hash: string }) => void;
  variant?: "primary" | "secondary";
}) {
  const [review, setReview] = useState(false);
  const tx = useTx();
  const toast = useToast();
  const { writeContractAsync } = useWriteContract();
  const fee = useGasEstimate(fn, marketId, account, review);
  const pending = usePendingTxs();
  async function send() {
    setReview(false);
    await tx.run({
      label: title,
      send: () =>
        writeContractAsync({
          ...target(fn),
          functionName: fn,
          args: (fn === "withdrawBond" ? [] : [BigInt(marketId)]) as never,
          chainId: deployment.chainId,
        } as never),
      onSubmitted: (hash) => pending.add({ hash, marketId, kind: fn }),
      onConfirmed: (hash) => {
        toast({ tone: "success", title: `${title}: confirmed`, body: `${formatMusd(amount)} MUSD sent to your wallet.` });
        onDone({ label: `${title}: ${formatMusd(amount)} MUSD sent`, hash });
      },
    });
  }
  return (
    <div className="space-y-2">
      <Button variant={variant} className="w-full" disabled={!avail.available || tx.busy || tx.state.phase === "confirmed"} loading={tx.busy} onClick={() => setReview(true)}>
        {tx.state.phase === "confirmed" ? "Claimed" : `${title} · ${formatMusd(amount)} MUSD`}
      </Button>
      {!avail.available && tx.state.phase === "idle" && <p className="text-sm text-ink-2">{avail.reason}</p>}
      <TxStatus state={tx.state} onRetry={send} />
      <Dialog
        open={review}
        onClose={() => setReview(false)}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(false)}>Back</Button>
            <Button onClick={send}>Sign</Button>
          </>
        }
      >
        <dl className="divide-y divide-line">
          {details}
          <KeyValue label="Protocol fee">None. Claims are fee-free.</KeyValue>
          <KeyValue label="You receive">{formatMusd(amount)} MUSD</KeyValue>
          <KeyValue label="Amount source">Contract read, live</KeyValue>
          <KeyValue label="Sent to">{account ? shortAddress(account) : "—"}</KeyValue>
          <KeyValue label="Network fee (estimate)">{fee === undefined ? "Estimating…" : fee === null ? "Unavailable" : `~${fee} BTC`}</KeyValue>
          <KeyValue label="Claim deadline">None</KeyValue>
        </dl>
      </Dialog>
    </div>
  );
}

export function RedeemDetails({ outcome, yes, no }: { outcome: number; yes: bigint; no: bigint }) {
  return (
    <>
      <KeyValue label="Final outcome">{outcomeLabel(outcome)}</KeyValue>
      <KeyValue label="Yes shares burned">{formatShares(yes)}</KeyValue>
      <KeyValue label="No shares burned">{formatShares(no)}</KeyValue>
      <KeyValue label="Rate">{outcome === 3 ? "0.5 MUSD per share, either side" : `1 MUSD per ${outcomeLabel(outcome)} share`}</KeyValue>
    </>
  );
}
