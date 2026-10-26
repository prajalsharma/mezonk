"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type Address, parseUnits } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Hint, KeyValue, Notice, Segmented, inputClass } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { WalletButton } from "@/components/wallet/WalletButton";
import { TxStatus } from "@/components/trading/TxStatus";
import { useMusd } from "@/hooks/useMusd";
import { useTx } from "@/hooks/useTx";
import type { MarketChain } from "@/hooks/useMarketChain";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { exchangeAbi } from "@/lib/contracts/abi";
import { explainError } from "@/lib/contracts/errors";
import { formatMusd } from "@/lib/format";
import { cost, formatShares, parseShares, sharesForBudget } from "@/lib/orderbook/math";
import { approveMusd, placeEscrowed, signAndPost, take, takeArgs } from "./actions";
import { useBook, useQuote } from "./api";

type Action = "buy" | "sell";
type Side = "yes" | "no";
type Kind = "market" | "limit";
type Rest = "signed" | "escrow";
type Mode = "simple" | "advanced";

const EXPIRY: Record<string, number> = { "1d": 86400, "7d": 7 * 86400, "30d": 30 * 86400 };

/** Average price in cents with two decimals, exact from bigint. */
const avgCents = (notional: bigint, filled: bigint) => (filled === 0n ? null : Number((notional * 10_000n) / filled) / 100);

export function TradeTicket({
  marketId,
  chain,
  side,
  onSideChange,
  preset,
  initialAmount,
}: {
  marketId: number;
  chain: MarketChain;
  side: Side;
  onSideChange: (s: Side) => void;
  /** A price picked in the order book. */
  preset?: { action: Action; price: number; nonce: number } | null;
  /** MUSD amount prefilled from a link (?amount=), e.g. a "bet 10" button on the landing page. */
  initialAmount?: string;
}) {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const musd = useMusd();
  const tx = useTx();
  const toast = useToast();
  const qc = useQueryClient();
  const book = useBook(marketId);

  const [action, setAction] = useState<Action>("buy");
  const [kind, setKind] = useState<Kind>("market");
  const [qtyIn, setQtyIn] = useState("");
  const [priceIn, setPriceIn] = useState("");
  const [rest, setRest] = useState<Rest>("signed");
  const [expiry, setExpiry] = useState("7d");
  const [allOrNothing, setAllOrNothing] = useState(false);
  const [restResult, setRestResult] = useState<string | null>(null);
  const [restError, setRestError] = useState<string | null>(null);
  // Simple: spend an amount of MUSD on one outcome at the best offers. Advanced: shares, limits, selling.
  const [mode, setModeState] = useState<Mode>("simple");
  const [amountIn, setAmountIn] = useState(initialAmount ?? "");
  const [feeBpsSeen, setFeeBpsSeen] = useState(100);
  const simple = mode === "simple";
  const setMode = (m: Mode) => {
    setModeState(m);
    tx.reset();
    setRestResult(null);
    if (m === "simple") {
      setAction("buy");
      setKind("market");
      setAllOrNothing(false);
    }
  };

  useEffect(() => {
    if (!preset) return;
    setModeState("advanced");
    setAction(preset.action);
    setKind("limit");
    setPriceIn(String(preset.price));
  }, [preset]);

  const outcome = side === "yes" ? 0 : 1;
  const sideIdx = action === "buy" ? 0 : 1;
  // Best executable price for this outcome and direction, from the live book (YES terms → outcome terms).
  const b = book.data;
  const budget = simple && /^\d{1,9}(\.\d{0,2})?$/.test(amountIn) && Number(amountIn) > 0 ? parseUnits(amountIn, 18) : null;
  const est = useMemo(() => {
    if (budget == null || !b) return null;
    const levels =
      outcome === 0
        ? b.asks.map((l) => ({ price: l.yes, shares: BigInt(l.shares) }))
        : b.bids.map((l) => ({ price: 100 - l.yes, shares: BigInt(l.shares) }));
    return sharesForBudget(levels, budget, feeBpsSeen);
  }, [budget, b, outcome, feeBpsSeen]);
  const qty = simple ? (est && est.qty > 0n ? est.qty : null) : parseShares(qtyIn);
  const bestForTaker =
    !b ? null : action === "buy"
      ? outcome === 0 ? b.bestAsk : b.bestBid == null ? null : 100 - b.bestBid
      : outcome === 0 ? b.bestBid : b.bestAsk == null ? null : 100 - b.bestAsk;
  const defaultLimit = bestForTaker == null ? null : action === "buy" ? Math.min(99, bestForTaker + 3) : Math.max(1, bestForTaker - 3);
  const priceNum = /^\d{1,2}$/.test(priceIn) ? Number(priceIn) : null;
  const limit = simple
    ? (est?.worst ?? null)
    : priceNum != null && priceNum >= 1 && priceNum <= 99 ? priceNum : kind === "market" ? defaultLimit : null;

  const live = chain.exStage === 1;
  const quote = useQuote(marketId, { outcome, side: sideIdx, quantity: qty, limit, taker: address }, live && !!qty && !!limit);
  const qd = quote.data && quote.data.quote.requested === String(qty) ? quote.data : null;
  useEffect(() => {
    if (quote.data && quote.data.feeBps !== feeBpsSeen) setFeeBpsSeen(quote.data.feeBps);
  }, [quote.data, feeBpsSeen]);
  const filled = qd ? BigInt(qd.quote.filled) : 0n;
  const notional = qd ? BigInt(qd.quote.notional) : 0n;
  const fee = qd ? BigInt(qd.quote.fee) : 0n;
  const unfilled = qty != null ? qty - filled : 0n;
  const restQty = kind === "limit" ? unfilled : 0n;
  const restCost = restQty > 0n && limit ? cost(restQty, limit) : 0n;
  const held = side === "yes" ? chain.yes : chain.no;

  // What this submission needs from the wallet.
  const needMusd = action === "buy" ? notional + fee + restCost : 0n;
  const needShares = action === "sell" ? filled + restQty : 0n;
  const needApproval = action === "buy" && needMusd > 0n && musd.allowance !== undefined && musd.allowance < needMusd;
  const shortMusd = action === "buy" && musd.balance !== undefined && musd.balance < needMusd;
  const shortShares = action === "sell" && needShares > held;
  const wrongChain = isConnected && chainId !== deployment.chainId;

  const afterTrade = () => {
    void chain.refetch();
    void musd.refetch();
    for (const k of [["market", marketId], ["markets"], ["portfolio"], ["orders"]]) void qc.invalidateQueries({ queryKey: k });
  };

  async function approve() {
    await tx.run({ label: "Approve MUSD", send: () => approveMusd(writeContractAsync as never, needMusd), onConfirmed: () => void musd.refetch() });
  }

  async function restRemainder(q: bigint) {
    if (!limit || !address || q === 0n) return;
    setRestError(null);
    if (rest === "escrow") {
      await tx.run({
        label: "Place escrowed order",
        send: () => placeEscrowed(writeContractAsync as never, marketId, outcome, sideIdx, limit, q),
        onConfirmed: () => {
          setRestResult(`${formatShares(q)} ${side === "yes" ? "Yes" : "No"} @ ${limit}¢ is escrowed on the book. It has not traded yet.`);
          afterTrade();
        },
      });
      return;
    }
    try {
      const nonce = await client!.readContract({ address: deployment.marketsAddress!, abi: exchangeAbi, functionName: "minNonce", args: [address] });
      const nowS = (await client!.getBlock()).timestamp;
      await signAndPost(signTypedDataAsync as never, {
        maker: address as Address,
        marketId,
        outcome,
        side: sideIdx,
        price: limit,
        quantity: q,
        expirySeconds: EXPIRY[expiry]!,
        nonce,
        nowS,
      });
      setRestResult(`${formatShares(q)} ${side === "yes" ? "Yes" : "No"} @ ${limit}¢ is on the book (signed, funds stay in your wallet). It has not traded yet.`);
      afterTrade();
    } catch (e) {
      setRestError(explainError(e));
    }
  }

  async function submit() {
    if (!qty || !limit || !qd) return;
    setRestResult(null);
    if (filled > 0n) {
      const label = `${action === "buy" ? "Buy" : "Sell"} ${side === "yes" ? "Yes" : "No"}`;
      const ok = await tx.run({
        label,
        validate: async () => {
          if (action === "buy") {
            const bal = musd.balance ?? 0n;
            if (bal < notional + fee) throw new Error("Your MUSD balance is too low for this trade.");
          } else if (held < filled) throw new Error("You don't hold enough shares for this sale.");
        },
        send: async () => {
          const nowS = (await client!.getBlock()).timestamp;
          return take(
            writeContractAsync as never,
            takeArgs(qd, { marketId, outcome, side: sideIdx, limit, quantity: filled, minFill: allOrNothing && kind === "market" ? filled : 0n, nowS }),
          );
        },
        onConfirmed: () => {
          toast({ tone: "success", title: `${label} confirmed`, body: "Settled on-chain. Your position is updated." });
          afterTrade();
        },
      });
      if (!ok) return;
    }
    if (kind === "limit" && restQty > 0n) await restRemainder(restQty);
    setQtyIn("");
    setAmountIn("");
  }

  if (!deployment.ready) return <Notice tone="warn" title="Trading is off">The exchange isn&apos;t deployed on this network.</Notice>;
  if (chain.isLoading && !chain.raw) return <div className="panel h-96" aria-busy="true" />;
  if (!live) return null;

  let cta: React.ReactNode;
  const what = kind === "limit" && filled === 0n ? "Place order" : `${action === "buy" ? "Buy" : "Sell"} ${side === "yes" ? "Yes" : "No"}`;
  if (!isConnected || wrongChain) cta = <WalletButton block />;
  else if (chain.paused) cta = <Button disabled className="w-full" size="lg">Trading paused</Button>;
  else if (simple && budget == null) cta = <Button disabled className="w-full" size="lg">Enter an amount</Button>;
  else if (simple && est && est.qty === 0n) cta = <Button disabled className="w-full" size="lg">{est.worst == null && est.exhausted ? "No one is selling" : "Amount too small"}</Button>;
  else if (!qty) cta = <Button disabled className="w-full" size="lg">Enter shares</Button>;
  else if (!limit) cta = <Button disabled className="w-full" size="lg">{kind === "market" ? "No liquidity to trade against" : "Enter a limit price"}</Button>;
  else if (!qd) cta = <Button disabled loading className="w-full" size="lg">Getting a quote</Button>;
  else if (kind === "market" && filled === 0n) cta = <Button disabled className="w-full" size="lg">Not enough liquidity at this price</Button>;
  else if (kind === "market" && allOrNothing && unfilled > 0n) cta = <Button disabled className="w-full" size="lg">Can&apos;t fill all of it</Button>;
  else if (shortMusd) cta = <Button disabled className="w-full" size="lg">Not enough MUSD</Button>;
  else if (shortShares) cta = <Button disabled className="w-full" size="lg">You hold {formatShares(held)} {side === "yes" ? "Yes" : "No"}</Button>;
  else if (needApproval) cta = <Button className="w-full" size="lg" loading={tx.busy} onClick={approve}>Approve {formatMusd(needMusd)} MUSD</Button>;
  else cta = <Button variant={side === "yes" ? "yes" : "no"} className="w-full" size="lg" loading={tx.busy} onClick={submit}>{what}</Button>;

  const avg = avgCents(notional, filled);

  return (
    <section aria-label="Trade" className="panel space-y-4 p-5 shadow-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{simple ? "Buy" : "Trade"}</h2>
        <button
          type="button"
          onClick={() => setMode(simple ? "advanced" : "simple")}
          aria-pressed={!simple}
          className="press rounded-sm px-2 py-1 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          {simple ? "Advanced: sell, limit orders" : "Back to simple"}
        </button>
      </div>
      {!simple && <div className="grid grid-cols-2 gap-2">
        <Segmented label="Direction" value={action} onChange={(v) => { setAction(v); tx.reset(); setRestResult(null); }} options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
        <Segmented label="Order type" value={kind} onChange={(v) => { setKind(v); tx.reset(); }} options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]} />
      </div>}

      <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-2">
        {(["yes", "no"] as const).map((s) => {
          const o = s === "yes" ? 0 : 1;
          const px = !b ? null : action === "buy" ? (o === 0 ? b.bestAsk : b.bestBid == null ? null : 100 - b.bestBid) : o === 0 ? b.bestBid : b.bestAsk == null ? null : 100 - b.bestAsk;
          const active = side === s;
          return (
            <button
              key={s}
              role="radio"
              aria-checked={active}
              onClick={() => onSideChange(s)}
              className={cx(
                "press flex h-14 flex-col justify-center rounded-md border px-3.5 text-left transition-[border-color,background-color] duration-150",
                active ? (s === "yes" ? "border-yes bg-yes text-on-yes" : "border-no bg-no text-on-no") : "border-line bg-surface-2 hover:border-ink-2/40",
              )}
            >
              <span className={cx("text-sm font-semibold", !active && (s === "yes" ? "text-yes-text" : "text-no-text"))}>{s === "yes" ? "Yes" : "No"}</span>
              <span className={cx("mono text-xs", active ? "opacity-85" : "text-muted")}>
                {px == null ? (action === "buy" ? "no sellers" : "no buyers") : `${action === "buy" ? "from" : "to"} ${px}¢`}
              </span>
            </button>
          );
        })}
      </div>

      {simple ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <label htmlFor="tt-amount" className="font-medium">Amount</label>
            {isConnected && musd.balance !== undefined && musd.balance > 0n && (
              <button
                type="button"
                className="mono text-xs text-ink-2 hover:text-ink"
                onClick={() => setAmountIn(formatMusd(musd.balance!).replace(/,/g, ""))}
              >
                Balance {formatMusd(musd.balance)}
              </button>
            )}
          </div>
          <div className="relative">
            <input
              id="tt-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amountIn}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                if (/^\d{0,9}(\.\d{0,2})?$/.test(v)) setAmountIn(v);
                if (tx.state.phase === "confirmed" || tx.state.phase === "failed") tx.reset();
              }}
              className={cx(inputClass, "mono h-12 pr-16 text-xl font-semibold")}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">MUSD</span>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <label htmlFor="tt-qty" className="font-medium">Shares</label>
            {isConnected && action === "sell" && (
              <button type="button" className="mono text-xs text-ink-2 hover:text-ink" onClick={() => held > 0n && setQtyIn(formatShares(held).replace(/,/g, ""))}>
                Held {formatShares(held)}
              </button>
            )}
          </div>
          <input
            id="tt-qty"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={qtyIn}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d{0,12}(\.\d{0,2})?$/.test(v)) setQtyIn(v);
              if (tx.state.phase === "confirmed" || tx.state.phase === "failed") tx.reset();
            }}
            className={cx(inputClass, "mono h-12 text-xl font-semibold")}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tt-price" className="flex items-center gap-1 text-sm font-medium">
            {kind === "market" ? "Worst" : "Limit"}
            <Hint label="price limit" align="end">
              {kind === "market"
                ? "The most you'll pay (buy) or least you'll accept (sell) per share, in cents. Nothing fills beyond it."
                : "Your price in cents. Anything on the book at this price or better fills now; the rest waits on the book."}
            </Hint>
          </label>
          <div className="relative">
            <input
              id="tt-price"
              inputMode="numeric"
              autoComplete="off"
              placeholder={defaultLimit != null && kind === "market" ? String(defaultLimit) : "¢"}
              value={priceIn}
              onChange={(e) => /^\d{0,2}$/.test(e.target.value) && setPriceIn(e.target.value)}
              className={cx(inputClass, "mono h-12 pr-7 text-xl font-semibold")}
            />
            <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">¢</span>
          </div>
        </div>
      </div>
      )}

      {kind === "limit" && (
        <fieldset className="space-y-2 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">If it doesn&apos;t all fill now</legend>
          <Segmented
            label="Remainder"
            value={rest}
            onChange={setRest}
            options={[
              { value: "signed", label: "Sign (no lock)" },
              { value: "escrow", label: "Escrow on-chain" },
            ]}
          />
          <p className="text-xs text-ink-2">
            {rest === "signed"
              ? "Free, no transaction. Your MUSD or shares stay in your wallet; if you move them, the order is skipped."
              : "One transaction. The MUSD or shares are locked in the contract until filled or you cancel, so the order is always executable."}
          </p>
          {rest === "signed" && (
            <Segmented label="Expires" value={expiry} onChange={setExpiry} options={[{ value: "1d", label: "1 day" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }]} />
          )}
        </fieldset>
      )}
      {kind === "market" && !simple && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={allOrNothing} onChange={(e) => setAllOrNothing(e.target.checked)} />
          All or nothing (otherwise fill what&apos;s available and cancel the rest)
        </label>
      )}

      {qty && limit && qd && (
        <dl className="divide-y divide-line rounded-md border border-line bg-sunk/60 px-3.5" aria-live="polite">
          {simple ? (
            <KeyValue label="Shares you get">{formatShares(filled)} {side === "yes" ? "Yes" : "No"}</KeyValue>
          ) : (
            <KeyValue label="Fills now">{formatShares(filled)} of {formatShares(qty)} shares</KeyValue>
          )}
          {filled > 0n && (
            <>
              <KeyValue label="Average price">{avg != null ? `${avg.toFixed(2)}¢` : "—"}{qd.quote.worstPrice != null && qd.quote.worstPrice !== qd.quote.bestPrice ? ` (up to ${qd.quote.worstPrice}¢)` : ""}</KeyValue>
              <KeyValue label={action === "buy" ? "You pay" : "You receive"}>{formatMusd(action === "buy" ? notional + fee : notional - fee)} MUSD</KeyValue>
              <KeyValue label={`Fee (${qd.feeBps / 100}%, taker)`}>{formatMusd(fee)} MUSD</KeyValue>
              {action === "buy" && <KeyValue label={`Pays if ${side === "yes" ? "Yes" : "No"} wins`}>{formatMusd(filled)} MUSD</KeyValue>}
            </>
          )}
          {unfilled > 0n && (
            <KeyValue label="Remainder">
              {kind === "limit"
                ? `${formatShares(unfilled)} rests at ${limit}¢ (${rest === "signed" ? "signed" : "escrowed"})`
                : `${formatShares(unfilled)} not filled, cancelled`}
            </KeyValue>
          )}
          {action === "buy" && needMusd > 0n && <KeyValue label="Needs MUSD approval">{formatMusd(needMusd)} MUSD{needApproval ? "" : " ✓"}</KeyValue>}
        </dl>
      )}

      {simple && est?.exhausted && est.qty > 0n && (
        <Notice tone="warn" title="That's more than is on offer">
          Only {formatShares(est.qty)} {side === "yes" ? "Yes" : "No"} shares are offered right now. The rest of your amount stays in your wallet.
        </Notice>
      )}
      {qty && limit && qd && kind === "market" && unfilled > 0n && (
        <Notice tone="warn" title="Not enough liquidity at this price">
          {filled > 0n
            ? `Only ${formatShares(filled)} shares are offered at ${limit}¢ or better. Adjust your limit price, or leave the remaining ${formatShares(unfilled)} unfilled.`
            : "Nobody is offering at this price. Adjust your limit price or quantity, or place a limit order and wait for a counterparty."}
        </Notice>
      )}

      {cta}
      <TxStatus state={tx.state} onRetry={needApproval ? approve : submit} />
      {restResult && <Notice tone="info" title="Order on the book">{restResult}</Notice>}
      {restError && <Notice tone="error" title="The rest wasn't placed">{restError}</Notice>}

      {isConnected && action === "buy" && (shortMusd || musd.balance === 0n) && (
        <p className="text-sm text-ink-2">
          {musd.balance === 0n ? "No MUSD in this wallet." : "Not enough MUSD for this."} Hold BTC?{" "}
          <Link className="font-medium text-yes-text underline-offset-4 hover:underline" href="/borrow">Borrow MUSD against it</Link>
          {deployment.chain.testnet && (
            <> (testnet BTC from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a>)</>
          )}
          .
        </p>
      )}
      <p className="text-xs text-muted">
        You trade with other people&apos;s orders, never with MEZONK. A trade happens only when the transaction confirms. You can lose what you put in.
      </p>
    </section>
  );
}
