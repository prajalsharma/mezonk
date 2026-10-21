"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { TxLink } from "@/components/ui/Address";
import { cx } from "@/components/ui/cx";
import { Notice, Segmented, inputClass } from "@/components/ui/primitives";
import { TxStatus } from "@/components/trading/TxStatus";
import { useMusd } from "@/hooks/useMusd";
import { useTx } from "@/hooks/useTx";
import type { MarketChain } from "@/hooks/useMarketChain";
import { apiAuth } from "@/lib/api/auth-client";
import { apiGet } from "@/lib/api/types";
import { explainError } from "@/lib/contracts/errors";
import { formatMusd, relativeTime } from "@/lib/format";
import { cost, formatShares, parseShares } from "@/lib/orderbook/math";
import { useSession } from "@/hooks/useSession";
import { approveMusd, cancelEscrowed, cancelSigned, mergeSets, splitSets } from "./actions";
import { useMyOrders, type SignedOrderRow } from "./api";

const label = (o: { outcome: number; side: number }) => `${o.side === 0 ? "Buy" : "Sell"} ${o.outcome === 0 ? "Yes" : "No"}`;

/** Open orders on this market: escrowed ones cancel on-chain; signed ones can be hidden (free) or cancelled on-chain. */
export function MyOrders({ marketId, chainNowMs, minRest, graduatedAtMs }: { marketId: number; chainNowMs: number; minRest: number; graduatedAtMs: number }) {
  const { address } = useAccount();
  const q = useMyOrders(marketId, address);
  const tx = useTx();
  const session = useSession();
  const qc = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [err, setErr] = useState<string | null>(null);
  const signed = (q.data?.signed ?? []).filter((o) => o.status === "open" || o.status === "stale");
  const resting = (q.data?.resting ?? []).filter((o) => o.status === "open");
  if (!address || (!signed.length && !resting.length)) return null;
  const refresh = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["market", marketId] });
  };
  async function hide(o: SignedOrderRow) {
    setErr(null);
    try {
      if (!(await session.ensure())) return;
      await apiAuth(`/api/orders/${o.hash}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setErr(explainError(e));
    }
  }
  return (
    <section aria-label="Your open orders" className="panel space-y-3 p-5">
      <h2 className="text-base font-semibold">Your open orders</h2>
      <ul className="divide-y divide-line text-sm">
        {resting.map((o) => {
          const lockedUntil = o.seed ? Math.max(new Date(o.placedAt).getTime(), graduatedAtMs) + minRest * 1000 : 0;
          const locked = lockedUntil > chainNowMs;
          return (
            <li key={`r${o.orderId}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                <span className="font-medium">{label(o)}</span> <span className="mono">{formatShares(BigInt(o.remaining))} @ {o.price}¢</span>
                <span className="block text-xs text-muted">Escrowed{o.side === 0 ? ` · ${formatMusd(cost(BigInt(o.remaining), o.price))} MUSD locked` : " · shares locked"}</span>
              </span>
              <Button size="sm" variant="secondary" disabled={locked} loading={tx.busy} onClick={() => tx.run({ label: "Cancel order", send: () => cancelEscrowed(writeContractAsync as never, o.orderId), onConfirmed: refresh })}>
                {locked ? `Locked ${relativeTime(lockedUntil, chainNowMs)}` : "Cancel"}
              </Button>
            </li>
          );
        })}
        {signed.map((o) => (
          <li key={o.hash} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span>
              <span className="font-medium">{label(o)}</span>{" "}
              <span className="mono">{formatShares(BigInt(o.quantity) - BigInt(o.filled))} @ {o.price}¢</span>
              <span className={cx("block text-xs", o.status === "stale" ? "text-warn" : "text-muted")}>
                {o.status === "stale" ? `Paused: ${o.statusReason ?? "not funded"}` : `Signed · expires ${relativeTime(new Date(o.expiry).getTime(), chainNowMs)}`}
              </span>
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => hide(o)}>Remove</Button>
              <Button size="sm" variant="secondary" loading={tx.busy} onClick={() => tx.run({ label: "Cancel on-chain", send: () => cancelSigned(writeContractAsync as never, [o]), onConfirmed: refresh })}>
                Cancel on-chain
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {signed.length > 0 && (
        <p className="text-xs text-muted">
          &quot;Remove&quot; takes a signed order off this book for free, but the signature stays valid until it expires. &quot;Cancel on-chain&quot; makes it
          permanently unusable.
        </p>
      )}
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <TxStatus state={tx.state} />
    </section>
  );
}

/** Shares held now, read from the contract, plus split/merge of complete sets. */
export function PositionCard({ marketId, chain }: { marketId: number; chain: MarketChain }) {
  const { isConnected } = useAccount();
  const musd = useMusd();
  const tx = useTx();
  const { writeContractAsync } = useWriteContract();
  const [mode, setMode] = useState<"split" | "merge">("split");
  const [amt, setAmt] = useState("");
  const live = chain.exStage === 1;
  const canMerge = chain.exStage === 1 || chain.exStage === 3;
  if (!isConnected || !chain.raw || (chain.yes + chain.no === 0n && !live)) return null;
  const a = parseShares(amt);
  const pair = chain.yes < chain.no ? chain.yes : chain.no;
  const needApproval = mode === "split" && !!a && musd.allowance !== undefined && musd.allowance < a;
  return (
    <section aria-label="Your position" className="panel space-y-3 p-5">
      <h2 className="text-base font-semibold">Your position</h2>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md border border-line p-3">
          <dt className="font-semibold text-yes-text">Yes</dt>
          <dd className="mono text-lg">{formatShares(chain.yes)}</dd>
          <dd className="text-xs text-muted">pays {formatMusd(chain.yes)} if Yes</dd>
        </div>
        <div className="rounded-md border border-line p-3">
          <dt className="font-semibold text-no-text">No</dt>
          <dd className="mono text-lg">{formatShares(chain.no)}</dd>
          <dd className="text-xs text-muted">pays {formatMusd(chain.no)} if No</dd>
        </div>
      </dl>
      {(live || (canMerge && pair > 0n)) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2">Split or merge complete sets</summary>
          <div className="mt-3 space-y-2">
            <Segmented label="Set action" value={mode} onChange={setMode} options={[{ value: "split", label: "Split" }, { value: "merge", label: "Merge" }]} />
            <p className="text-xs text-ink-2">
              {mode === "split"
                ? "1 MUSD becomes 1 Yes + 1 No. Useful to sell one side (market making). Your risk is the side you keep."
                : `1 Yes + 1 No become 1 MUSD again. You can merge up to ${formatShares(pair)}.`}
            </p>
            <input value={amt} onChange={(e) => /^\d{0,12}(\.\d{0,2})?$/.test(e.target.value) && setAmt(e.target.value)} inputMode="decimal" placeholder="Amount" aria-label="Amount of sets" className={cx(inputClass, "mono")} />
            {mode === "split" && !live ? (
              <Notice tone="info">Splitting is only possible while the market is live.</Notice>
            ) : needApproval ? (
              <Button className="w-full" size="sm" loading={tx.busy} onClick={() => tx.run({ label: "Approve MUSD", send: () => approveMusd(writeContractAsync as never, a!), onConfirmed: () => void musd.refetch() })}>
                Approve {formatMusd(a!)} MUSD
              </Button>
            ) : (
              <Button
                className="w-full"
                size="sm"
                disabled={!a || (mode === "merge" && a > pair)}
                loading={tx.busy}
                onClick={() =>
                  tx.run({
                    label: mode === "split" ? "Split" : "Merge",
                    send: () => (mode === "split" ? splitSets(writeContractAsync as never, marketId, a!) : mergeSets(writeContractAsync as never, marketId, a!)),
                    onConfirmed: () => {
                      setAmt("");
                      void chain.refetch();
                      void musd.refetch();
                    },
                  })
                }
              >
                {mode === "split" ? "Split" : "Merge"}
              </Button>
            )}
            <TxStatus state={tx.state} />
          </div>
        </details>
      )}
      <p className="text-xs text-muted">Read live from the contract. Shares in escrowed sell orders are not included until cancelled.</p>
    </section>
  );
}

interface FillRow {
  eventId: number;
  makerOutcome: number;
  makerSide: number;
  makerPrice: number;
  quantity: string;
  yesPrice: number;
  blockTime: string;
  txHash: string;
  complement: boolean;
}

/** Confirmed fills only (from on-chain Fill events). */
export function RecentFills({ marketId }: { marketId: number }) {
  const q = useQuery({ queryKey: ["market", marketId, "fills"], queryFn: () => apiGet<{ fills: FillRow[] }>(`/api/markets/${marketId}/fills`), refetchInterval: 10_000 });
  const rows = q.data?.fills ?? [];
  return (
    <section aria-labelledby="fills-h" className="space-y-2">
      <h3 id="fills-h" className="font-medium">Recent trades</h3>
      {!rows.length ? (
        <p className="text-sm text-muted">No trades yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.slice(0, 12).map((f) => (
            <li key={f.eventId} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-2">
              <span className="mono font-semibold text-ink">Yes {f.yesPrice}¢</span>
              <span className="mono text-ink-2">{formatShares(BigInt(f.quantity))}</span>
              <span className="whitespace-nowrap text-xs text-muted">
                <TxLink hash={f.txHash} label={relativeTime(new Date(f.blockTime).getTime())} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
