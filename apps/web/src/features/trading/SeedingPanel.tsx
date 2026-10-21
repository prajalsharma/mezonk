"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Lock, X } from "lucide-react";
import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { KeyValue, Notice, Segmented, Skeleton, inputClass } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { TxStatus } from "@/components/trading/TxStatus";
import { useMusd } from "@/hooks/useMusd";
import { useTx } from "@/hooks/useTx";
import type { MarketChain } from "@/hooks/useMarketChain";
import { formatDuration, formatMusd, relativeTime } from "@/lib/format";
import { cost, formatShares, parseShares } from "@/lib/orderbook/math";
import { approveMusd, cancelEscrowed, graduate, placeEscrowed } from "./actions";
import { useMyOrders, useSeeding, type RestingRow } from "./api";

function Check2({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className={cx("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-success-soft text-success" : "bg-surface-2 text-muted ring-1 ring-line")}>
        {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        <span className="sr-only">{ok ? "met" : "not met"}</span>
      </span>
      <span className={ok ? "text-ink" : "text-ink-2"}>{children}</span>
    </li>
  );
}

/**
 * Prelaunch. A market goes live only when the contract sees enough funded, escrowed orders on both sides, a
 * narrow enough spread and enough distinct seeders. Anyone can then press "Launch"; the contract re-checks.
 */
export function SeedingPanel({ marketId, chain, chainNowMs }: { marketId: number; chain: MarketChain; chainNowMs: number }) {
  const s = useSeeding(marketId);
  const { address, isConnected } = useAccount();
  const failed = chain.exStage === 2;
  const qc = useQueryClient();
  const tx = useTx();
  const { writeContractAsync } = useWriteContract();

  if (s.isLoading) return <Skeleton className="h-96" />;
  if (!s.data) return <Notice tone="error" title="Couldn't read the launch status">The RPC may be unreachable. Retry shortly.</Notice>;
  const { check: g, policy: p, seedingDeadline } = s.data;
  const deadlineMs = seedingDeadline * 1000;
  const refresh = () => {
    void s.refetch();
    void chain.refetch();
    for (const k of [["market", marketId], ["markets"], ["orders"]]) void qc.invalidateQueries({ queryKey: k });
  };

  return (
    <div className="space-y-3">
      <section aria-label="Launch status" className="panel space-y-4 p-5 shadow-2">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{failed ? "This market didn't launch" : "Seeding: not trading yet"}</h2>
          <p className="text-sm text-ink-2">
            {failed
              ? "The seeding deadline passed before enough funded orders arrived. Nothing traded and nobody won or lost. Every seeder can take their full deposit back."
              : "It goes live once enough people commit funded orders on both sides. Until then nothing trades and no one can win or lose."}
          </p>
        </div>
        {!failed && (
          <>
            <ul className="space-y-2.5">
              <Check2 ok={g.bestBid > 0 && g.bestAsk > 0}>
                Bids and offers on both sides {g.bestBid > 0 && g.bestAsk > 0 ? `(Yes ${g.bestBid}¢ bid, ${g.bestAsk}¢ ask)` : ""}
              </Check2>
              <Check2 ok={g.spreadOk}>Spread of {p.maxSpread}¢ or less {g.bestBid > 0 && g.bestAsk > 0 ? `· now ${g.bestAsk - g.bestBid}¢` : ""}</Check2>
              <Check2 ok={BigInt(g.bidDepth) >= BigInt(p.minBidDepth)}>
                {formatShares(BigInt(p.minBidDepth))} Yes shares bid within {p.band}¢ of the best bid · now {formatShares(BigInt(g.bidDepth))}
              </Check2>
              <Check2 ok={BigInt(g.askDepth) >= BigInt(p.minAskDepth)}>
                {formatShares(BigInt(p.minAskDepth))} Yes shares offered within {p.band}¢ of the best offer · now {formatShares(BigInt(g.askDepth))}
              </Check2>
              <Check2 ok={g.seedersOk}>
                {p.minSeeders} seeders with at least {formatMusd(p.minSeederNotional)} MUSD committed · now {g.seeders}
              </Check2>
            </ul>
            <p className="mono text-xs text-muted">
              Seeding ends {relativeTime(deadlineMs, chainNowMs)} · counted from escrowed orders only, checked by the contract
            </p>
            {g.ready && (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  size="lg"
                  loading={tx.busy}
                  onClick={() => tx.run({ label: "Launch market", send: () => graduate(writeContractAsync as never, marketId), onConfirmed: refresh })}
                >
                  Launch market
                </Button>
                <p className="text-xs text-muted">Anyone can launch once the checks pass. The contract verifies them again in the same transaction.</p>
              </div>
            )}
            <TxStatus state={tx.state} />
          </>
        )}
      </section>

      {!failed && <SeedForm marketId={marketId} p={p} onPlaced={refresh} />}
      {isConnected ? <MySeedOrders marketId={marketId} maker={address!} chain={chain} minRest={p.minRest} chainNowMs={chainNowMs} onChange={refresh} /> : failed ? <WalletButton block /> : null}

      {!failed && (
        <section aria-label="Early supporter terms" className="panel space-y-2 p-5 text-sm">
          <h3 className="font-medium">What seeders get, and risk</h3>
          <dl className="divide-y divide-line">
            <KeyValue label="Fee rebate">
              {p.rebateShareBps / 100}% of the {p.takerFeeBps / 100}% taker fee for {formatDuration(p.rebatePeriod)} after launch
            </KeyValue>
            <KeyValue label="Split">By MUSD you had committed when it launched</KeyValue>
            <KeyValue label="Caps">{formatMusd(p.rebateCapPerWallet)} per wallet · {formatMusd(p.rebateCapPerMarket)} per market</KeyValue>
            <KeyValue label="Claim by">{formatDuration(p.claimWindow)} after the rebate period</KeyValue>
          </dl>
          <p className="text-ink-2">
            Rebates come only from fees traders actually pay. No trading, no rebate: it&apos;s not interest and not guaranteed.
            Your seed order is a real trade offer: once live, it can fill, and you then hold that side and can lose it.
          </p>
        </section>
      )}
    </div>
  );
}

function SeedForm({ marketId, p, onPlaced }: { marketId: number; p: { minRest: number; minSeederNotional: string }; onPlaced: () => void }) {
  const { isConnected } = useAccount();
  const musd = useMusd();
  const tx = useTx();
  const { writeContractAsync } = useWriteContract();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [price, setPrice] = useState("");
  const [qtyIn, setQtyIn] = useState("");
  const qty = parseShares(qtyIn);
  const px = /^\d{1,2}$/.test(price) && Number(price) >= 1 && Number(price) <= 99 ? Number(price) : null;
  const lock = qty && px ? cost(qty, px) : 0n;
  const needApproval = lock > 0n && musd.allowance !== undefined && musd.allowance < lock;
  const short = lock > 0n && musd.balance !== undefined && musd.balance < lock;

  return (
    <section aria-label="Commit a seed order" className="panel space-y-3 p-5">
      <h3 className="font-medium">Commit a seed order</h3>
      <p className="text-sm text-ink-2">
        Offer to buy Yes or No at your price. The MUSD is locked in the contract now. It becomes a live order at launch, or comes back in full if the
        market doesn&apos;t launch.
      </p>
      <Segmented label="Outcome" value={side} onChange={setSide} options={[{ value: "yes", label: "Buy Yes" }, { value: "no", label: "Buy No" }]} />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Price (¢)</span>
          <input inputMode="numeric" value={price} onChange={(e) => /^\d{0,2}$/.test(e.target.value) && setPrice(e.target.value)} className={cx(inputClass, "mono")} placeholder="45" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Shares</span>
          <input inputMode="decimal" value={qtyIn} onChange={(e) => /^\d{0,12}(\.\d{0,2})?$/.test(e.target.value) && setQtyIn(e.target.value)} className={cx(inputClass, "mono")} placeholder="100" />
        </label>
      </div>
      {lock > 0n && (
        <dl className="divide-y divide-line rounded-md border border-line bg-sunk/60 px-3.5 text-sm">
          <KeyValue label="Locked now">{formatMusd(lock)} MUSD</KeyValue>
          <KeyValue label={`If it fills, you hold`}>{formatShares(qty!)} {side === "yes" ? "Yes" : "No"} (pays {formatMusd(qty!)} MUSD if right)</KeyValue>
          <KeyValue label="Counts as a seeder">{lock >= BigInt(p.minSeederNotional) ? "Yes" : `Needs ${formatMusd(p.minSeederNotional)} MUSD total`}</KeyValue>
          <KeyValue label="Can cancel">After {formatDuration(p.minRest)}, and again {formatDuration(p.minRest)} after launch</KeyValue>
        </dl>
      )}
      {!isConnected ? (
        <WalletButton block />
      ) : short ? (
        <Button disabled className="w-full">Not enough MUSD</Button>
      ) : needApproval ? (
        <Button className="w-full" loading={tx.busy} onClick={() => tx.run({ label: "Approve MUSD", send: () => approveMusd(writeContractAsync as never, lock), onConfirmed: () => void musd.refetch() })}>
          Approve {formatMusd(lock)} MUSD
        </Button>
      ) : (
        <Button
          className="w-full"
          disabled={!qty || !px}
          loading={tx.busy}
          onClick={() =>
            tx.run({
              label: "Commit seed order",
              send: () => placeEscrowed(writeContractAsync as never, marketId, side === "yes" ? 0 : 1, 0, px!, qty!),
              onConfirmed: () => {
                setQtyIn("");
                void musd.refetch();
                onPlaced();
              },
            })
          }
        >
          <Lock className="size-4" /> Lock {lock > 0n ? `${formatMusd(lock)} MUSD` : "MUSD"}
        </Button>
      )}
      <TxStatus state={tx.state} />
    </section>
  );
}

export function MySeedOrders({
  marketId,
  maker,
  chain,
  minRest,
  chainNowMs,
  onChange,
}: {
  marketId: number;
  maker: string;
  chain: MarketChain;
  minRest: number;
  chainNowMs: number;
  onChange: () => void;
}) {
  const q = useMyOrders(marketId, maker);
  const tx = useTx();
  const { writeContractAsync } = useWriteContract();
  const rows = (q.data?.resting ?? []).filter((r) => r.status === "open");
  const failed = chain.exStage === 2;
  if (!rows.length) return null;
  const graduatedAt = Number(chain.raw?.graduatedAt ?? 0n) * 1000;
  const unlockAt = (r: RestingRow) => {
    if (failed || chain.exStage === 3 || chain.exStage === 4) return 0;
    const from = Math.max(new Date(r.placedAt).getTime(), r.seed && graduatedAt ? graduatedAt : 0);
    return r.seed ? from + minRest * 1000 : 0;
  };
  return (
    <section aria-label="Your escrowed orders" className="panel space-y-3 p-5">
      <h3 className="font-medium">{failed ? "Get your deposit back" : "Your escrowed orders"}</h3>
      <ul className="divide-y divide-line text-sm">
        {rows.map((r) => {
          const until = unlockAt(r);
          const locked = until > chainNowMs;
          const refund = r.side === 0 ? cost(BigInt(r.remaining), r.price) : 0n;
          return (
            <li key={r.orderId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                <span className={r.outcome === 0 ? "font-semibold text-yes-text" : "font-semibold text-no-text"}>{r.side === 0 ? "Buy" : "Sell"} {r.outcome === 0 ? "Yes" : "No"}</span>{" "}
                <span className="mono">{formatShares(BigInt(r.remaining))} @ {r.price}¢</span>
                {r.side === 0 && <span className="text-ink-2"> · {formatMusd(refund)} MUSD locked</span>}
              </span>
              <Button
                size="sm"
                variant={failed ? "primary" : "secondary"}
                disabled={locked}
                loading={tx.busy}
                onClick={() => tx.run({ label: failed ? "Refund" : "Cancel order", send: () => cancelEscrowed(writeContractAsync as never, r.orderId), onConfirmed: onChange })}
              >
                {locked ? `Locked ${relativeTime(until, chainNowMs)}` : failed ? `Refund ${formatMusd(refund)}` : "Cancel"}
              </Button>
            </li>
          );
        })}
      </ul>
      <TxStatus state={tx.state} />
      <p className="text-xs text-muted">Refunds go straight from the contract to you. They work even if this website is down.</p>
    </section>
  );
}
