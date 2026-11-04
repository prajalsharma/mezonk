"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { TxStatus } from "@/components/trading/TxStatus";
import { Button } from "@/components/ui/Button";
import { mezoBorrow, useMezoLoan } from "@/hooks/useMezoLoan";
import { useMusd } from "@/hooks/useMusd";
import { useTx } from "@/hooks/useTx";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { formatMusd } from "@/lib/format";
import {
  SUGGESTED_RATIO,
  WAD,
  borrowerOperationsAbi,
  checkDraw,
  collForDebt,
  minReceivable,
  prepareDraw,
  ratioOf,
  type PreparedCall,
} from "@/lib/mezo/borrow";

const pct = (ratio: bigint) => `${(Number(ratio / 10n ** 14n) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
/** Loan-to-value: the share of the BTC's value that is borrowed (1 / ratio). */
const ltv = (ratio: bigint) => (ratio === 0n ? "—" : `${Math.round(Number((WAD * 10_000n) / ratio) / 100)}%`);
const roundUpCent = (wei: bigint) => ((wei + 10n ** 16n - 1n) / 10n ** 16n) * 10n ** 16n;
const btc = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * Shown under a buy that the wallet can't pay for. With an open Mezo loan, it borrows exactly the shortfall from it
 * in place (one signature), showing the loan's ratio and loan-to-value before and after. Without one, it links to
 * /borrow prefilled with the shortfall, which sends the user back to this market when the loan is open.
 */
export function BorrowForTrade({ shortfall, returnTo }: { shortfall: bigint; returnTo: string }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const qc = useQueryClient();
  const loan = useMezoLoan();
  const musd = useMusd();
  const tx = useTx();
  const prepared = useRef<PreparedCall | null>(null);
  const amount = roundUpCent(shortfall);
  const p = loan.params.data;
  const trove = loan.trove.data;
  const borrowHref = `/borrow?need=${Number(amount / 10n ** 16n) / 100}&return=${encodeURIComponent(returnTo)}`;

  const faucet = deployment.chain.testnet ? (
    <> Testnet BTC is free from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a>.</>
  ) : null;

  if (!mezoBorrow || !p) {
    return (
      <p className="text-sm text-ink-2">
        Not enough MUSD for this. Hold BTC? <Link className="font-medium text-yes-text underline-offset-4 hover:underline" href={borrowHref}>Borrow MUSD against it</Link>.{faucet}
      </p>
    );
  }

  if (!trove?.active) {
    const out = amount > minReceivable(p) ? amount : minReceivable(p);
    return (
      <div className="space-y-2 rounded-md border border-line bg-sunk p-4 text-sm">
        <p className="font-medium">You&apos;re {formatMusd(amount)} MUSD short. Borrow it against your BTC.</p>
        <p className="text-ink-2">
          A Mezo loan of {formatMusd(out)} MUSD at a safe 200% ratio (50% loan-to-value) locks about{" "}
          <span className="mono text-ink">{btc(collForDebt(out, SUGGESTED_RATIO, p))}</span> BTC. Your BTC isn&apos;t sold.{faucet}
        </p>
        <Link className="inline-flex font-medium text-yes-text underline-offset-4 hover:underline" href={borrowHref}>
          Open a loan for this trade →
        </Link>
      </div>
    );
  }

  const chk = checkDraw(trove, amount, p);
  const now = ratioOf(trove.coll, trove.debt, p.price);
  async function draw() {
    prepared.current = null;
    await tx.run({
      label: "Borrow for this trade",
      validate: async () => {
        prepared.current = await prepareDraw(client!, mezoBorrow!, address!, amount, chk.ok ? chk.ratio - chk.ratio / 50n : 0n);
      },
      send: () =>
        writeContractAsync({
          address: mezoBorrow!.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: "withdrawMUSD",
          args: prepared.current!.args,
          gas: prepared.current!.gas,
          chainId: deployment.chainId,
        } as never),
      onConfirmed: () => {
        void musd.refetch();
        void qc.invalidateQueries({ queryKey: ["mezo-trove"] });
      },
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-line bg-sunk p-4 text-sm">
      <p className="font-medium">You&apos;re {formatMusd(amount)} MUSD short. Borrow it from your Mezo loan?</p>
      {chk.ok ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-ink-2">Ratio</dt>
            <dd className="mono text-right">{pct(now)} → <span className={chk.ratio < (WAD * 150n) / 100n ? "text-warn" : ""}>{pct(chk.ratio)}</span></dd>
            <dt className="text-ink-2">Loan-to-value</dt>
            <dd className="mono text-right">{ltv(now)} → {ltv(chk.ratio)}</dd>
            <dt className="text-ink-2">One-time fee</dt>
            <dd className="mono text-right">{formatMusd(chk.fee)} MUSD</dd>
          </dl>
          {chk.ratio < (WAD * 150n) / 100n && <p className="text-warn">That leaves little room before liquidation. Consider adding BTC first.</p>}
          {tx.state.phase === "confirmed" ? (
            <p className="text-success">Borrowed. Your MUSD balance is updated; place the trade above.</p>
          ) : (
            <Button className="w-full" variant="secondary" loading={tx.busy} onClick={draw}>Borrow {formatMusd(amount)} MUSD</Button>
          )}
        </>
      ) : (
        <p className="text-ink-2">
          {chk.reason} <Link className="font-medium text-yes-text underline-offset-4 hover:underline" href="/borrow">Manage your loan</Link>
        </p>
      )}
      <TxStatus state={tx.state} onRetry={draw} />
    </div>
  );
}
