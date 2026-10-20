"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Hint, KeyValue, Notice, Segmented, inputClass } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { WalletButton } from "@/components/wallet/WalletButton";
import { TxStatus } from "./TxStatus";
import { useMusd } from "@/hooks/useMusd";
import { useTx } from "@/hooks/useTx";
import type { MarketChain } from "@/hooks/useMarketChain";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { formatMusd, formatPct, formatPrice, formatProb, formatShares } from "@/lib/format";
import { quoteBuy, quoteSell, withSlippage, type BuyQuote, type SellQuote } from "@/lib/market/math";

type Mode = "buy" | "sell";
type Side = "yes" | "no";

const QUOTE_TTL_MS = 30_000;
const DEADLINE_SECS = 300n;
const HIGH_IMPACT = 0.05;

function parseAmount(s: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  try {
    const v = parseUnits(s, 18);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function TradePanel({ marketId, chain }: { marketId: number; chain: MarketChain }) {
  const { isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const musd = useMusd();
  const tx = useTx();
  const toast = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>("buy");
  const [side, setSide] = useState<Side>("yes");
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [quotedAt, setQuotedAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  const m = chain.market;
  const amount = parseAmount(input);
  const pool = m ? { yes: m.poolYes, no: m.poolNo } : null;
  const priceYes = pool ? Number((pool.no * 1_000_000n) / (pool.yes + pool.no)) / 1e6 : null;
  const held = side === "yes" ? chain.yes : chain.no;

  // Instant local quote from live pool state. Re-checked against the contract right before sending.
  const quote = useMemo<{ q: BuyQuote | SellQuote | null; err: string | null }>(() => {
    if (!pool || !m || !amount) return { q: null, err: null };
    try {
      return mode === "buy"
        ? { q: quoteBuy(pool, side, amount, m.feeBps), err: null }
        : { q: quoteSell(pool, side, amount, m.feeBps), err: null };
    } catch {
      return { q: null, err: "This amount is larger than the pool can fill. Try a smaller amount." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.yes, pool?.no, m?.feeBps, amount, mode, side]);

  useEffect(() => setQuotedAt(Date.now()), [quote.q]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const quoteAge = Math.floor((now - quotedAt) / 1000);

  const isOpen = chain.stage === 0;
  const wrongChain = isConnected && chainId !== deployment.chainId;
  const needApproval = mode === "buy" && !!amount && musd.allowance !== undefined && musd.allowance < amount;
  const insufficient =
    mode === "buy" ? !!amount && musd.balance !== undefined && musd.balance < amount : !!amount && amount > held;

  const afterTrade = () => {
    setInput("");
    void chain.refetch();
    void musd.refetch();
    void qc.invalidateQueries({ queryKey: ["markets"] });
    void qc.invalidateQueries({ queryKey: ["market", marketId] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
  };

  async function approve() {
    if (!amount || !deployment.marketsAddress) return;
    await tx.run({
      label: "Approve MUSD",
      send: () =>
        writeContractAsync({
          address: deployment.musd,
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.marketsAddress!, amount],
          chainId: deployment.chainId,
        }),
      onConfirmed: () => void musd.refetch(),
    });
  }

  async function submit() {
    if (!amount || !deployment.marketsAddress || !client) return;
    const isYes = side === "yes";
    let minOut = 0n;
    const label = `${mode === "buy" ? "Buy" : "Sell"} ${isYes ? "Yes" : "No"}`;
    await tx.run({
      label,
      // Fresh contract quote immediately before signing; never sign against a stale local number.
      validate: async () => {
        const block = await client.getBlock();
        if (block.timestamp >= m!.closeTime) throw new Error("Trading has closed for this market.");
        if (mode === "buy") {
          const [shares] = await client.readContract({
            address: deployment.marketsAddress!,
            abi: mezonkMarketsAbi,
            functionName: "quoteBuy",
            args: [BigInt(marketId), isYes, amount],
          });
          minOut = withSlippage(shares, slippageBps);
          const bal = await client.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "balanceOf", args: [chain.account!] });
          if (bal < amount) throw new Error("Your MUSD balance is too low for this trade.");
        } else {
          const [out] = await client.readContract({
            address: deployment.marketsAddress!,
            abi: mezonkMarketsAbi,
            functionName: "quoteSell",
            args: [BigInt(marketId), isYes, amount],
          });
          minOut = withSlippage(out, slippageBps);
        }
        if (minOut === 0n) throw new Error("This amount is too small to trade.");
      },
      send: async () => {
        const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SECS;
        return writeContractAsync({
          address: deployment.marketsAddress!,
          abi: mezonkMarketsAbi,
          functionName: mode,
          args: [BigInt(marketId), isYes, amount, minOut, deadline],
          chainId: deployment.chainId,
        });
      },
      onConfirmed: () => {
        toast({ tone: "success", title: `${label} confirmed`, body: "Your position is updated." });
        afterTrade();
      },
    });
  }

  if (!deployment.ready) {
    return <Notice tone="warn" title="Trading is off">The market contract isn&apos;t deployed on this network.</Notice>;
  }
  if (chain.isLoading && !m) {
    return <div className="h-80 rounded-lg border border-line bg-surface" aria-busy="true" />;
  }
  if (!m) {
    return (
      <Notice tone="error" title="Couldn't read this market from the chain">
        The RPC may be unreachable. Retry shortly.
      </Notice>
    );
  }
  if (!isOpen) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
        Trading has closed. Positions settle according to the resolution process below.
      </div>
    );
  }

  const bq = mode === "buy" ? (quote.q as BuyQuote | null) : null;
  const sq = mode === "sell" ? (quote.q as SellQuote | null) : null;
  const stale = quote.q && quoteAge * 1000 > QUOTE_TTL_MS;

  let cta: React.ReactNode;
  if (!isConnected) cta = <WalletButton block />;
  else if (wrongChain) cta = <WalletButton block />;
  else if (chain.paused) cta = <Button disabled className="w-full" size="lg">Trading paused</Button>;
  else if (!amount) cta = <Button disabled className="w-full" size="lg">Enter an amount</Button>;
  else if (quote.err) cta = <Button disabled className="w-full" size="lg">Amount too large</Button>;
  else if (insufficient)
    cta = (
      <Button disabled className="w-full" size="lg">
        {mode === "buy" ? "Not enough MUSD" : `You hold ${formatShares(held)} ${side === "yes" ? "Yes" : "No"} shares`}
      </Button>
    );
  else if (needApproval)
    cta = (
      <Button className="w-full" size="lg" loading={tx.busy} onClick={approve}>
        Approve {formatMusd(amount)} MUSD
      </Button>
    );
  else
    cta = (
      <Button variant={side === "yes" ? "yes" : "no"} className="w-full" size="lg" loading={tx.busy} onClick={submit}>
        {mode === "buy" ? "Buy" : "Sell"} {side === "yes" ? "Yes" : "No"}
      </Button>
    );

  return (
    <section aria-label="Trade" className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <Segmented
        label="Trade direction"
        value={mode}
        onChange={(v) => {
          setMode(v);
          setInput("");
          tx.reset();
        }}
        options={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ]}
      />

      <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-2">
        {(["yes", "no"] as const).map((s) => {
          const p = priceYes == null ? null : s === "yes" ? priceYes : 1 - priceYes;
          const active = side === s;
          return (
            <button
              key={s}
              role="radio"
              aria-checked={active}
              onClick={() => setSide(s)}
              className={cx(
                "flex items-baseline justify-between rounded-md border px-3 py-2.5 text-left transition-colors",
                active
                  ? s === "yes"
                    ? "border-yes bg-yes-soft"
                    : "border-no bg-no-soft"
                  : "border-line hover:border-ink-2",
              )}
            >
              <span className={cx("font-semibold", s === "yes" ? "text-yes-text" : "text-no-text")}>{s === "yes" ? "Yes" : "No"}</span>
              <span className="tnum text-sm text-ink-2">{p == null ? "—" : `${formatPrice(p)} MUSD`}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <label htmlFor="trade-amount" className="font-semibold">
            {mode === "buy" ? "Amount (MUSD)" : `Shares to sell`}
          </label>
          {isConnected && (
            <button
              type="button"
              className="tnum text-ink-2 hover:text-ink"
              onClick={() => {
                const max = mode === "buy" ? musd.balance : held;
                if (max) setInput(formatUnits(max, 18));
              }}
            >
              {mode === "buy"
                ? `Balance ${musd.balance === undefined ? "…" : formatMusd(musd.balance)}`
                : `Held ${formatShares(held)}`}
            </button>
          )}
        </div>
        <input
          id="trade-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={input}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (/^\d*\.?\d{0,18}$/.test(v)) setInput(v);
            if (tx.state.phase === "confirmed" || tx.state.phase === "failed") tx.reset();
          }}
          aria-invalid={!!quote.err || insufficient}
          className={cx(inputClass, "tnum text-lg")}
        />
        {quote.err && <p className="text-sm text-danger">{quote.err}</p>}
      </div>

      {quote.q && (
        <dl className="divide-y divide-line border-y border-line" aria-live="polite">
          {bq && (
            <>
              <KeyValue label="Shares you receive">{formatShares(bq.shares)}</KeyValue>
              <KeyValue label="Average price" hint={<Hint label="average price">MUSD paid per share, including the fee. The price rises as you buy, so this is above the current price.</Hint>}>
                {formatPrice(bq.avgPrice)} MUSD
              </KeyValue>
              <KeyValue label="Price impact">
                <span className={bq.priceImpact > HIGH_IMPACT ? "text-warn" : ""}>{formatPct(bq.priceImpact)}</span>
              </KeyValue>
              <KeyValue label={`Fee (${m.feeBps / 100}%)`}>{formatMusd(bq.fee)} MUSD</KeyValue>
              <KeyValue label={`Paid out if ${side === "yes" ? "Yes" : "No"} wins`} hint={<Hint label="payout">Each winning share redeems for exactly 1 MUSD after the outcome is final. If the market is ruled invalid, every share redeems for 0.5 MUSD.</Hint>}>
                {formatMusd(bq.payoutIfWin)} MUSD
              </KeyValue>
              <KeyValue label="Profit if it wins">
                <span className={bq.profitIfWin >= 0n ? "text-gain" : "text-loss"}>
                  {bq.profitIfWin >= 0n ? "+" : "−"}
                  {formatMusd(bq.profitIfWin >= 0n ? bq.profitIfWin : -bq.profitIfWin)} MUSD
                </span>
              </KeyValue>
              <KeyValue label="Minimum shares (after slippage)">{formatShares(withSlippage(bq.shares, slippageBps))}</KeyValue>
              <KeyValue label="New chance of Yes">{formatProb(bq.priceAfterYes, true)}</KeyValue>
            </>
          )}
          {sq && (
            <>
              <KeyValue label="You receive">{formatMusd(sq.out)} MUSD</KeyValue>
              <KeyValue label="Average price">{formatPrice(sq.avgPrice)} MUSD</KeyValue>
              <KeyValue label={`Fee (${m.feeBps / 100}%)`}>{formatMusd(sq.fee)} MUSD</KeyValue>
              <KeyValue label="Minimum received (after slippage)">{formatMusd(withSlippage(sq.out, slippageBps))} MUSD</KeyValue>
              <KeyValue label="New chance of Yes">{formatProb(sq.priceAfterYes, true)}</KeyValue>
            </>
          )}
          <KeyValue label="Quote">
            <span className={cx("text-xs", stale ? "text-warn" : "text-muted")}>
              {stale ? "Refreshing on submit" : `Live · ${quoteAge}s old`}
            </span>
          </KeyValue>
        </dl>
      )}

      {bq && bq.priceImpact > HIGH_IMPACT && (
        <Notice tone="warn" title="High price impact">
          This trade moves the price by more than {formatPct(HIGH_IMPACT, 0)}. The pool is small relative to your amount.
        </Notice>
      )}

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-ink-2">
          Slippage
          <Hint label="slippage">The trade reverts if the price moves against you by more than this before it is mined. You keep your MUSD.</Hint>
        </span>
        <Segmented
          label="Slippage tolerance"
          value={String(slippageBps)}
          onChange={(v) => setSlippageBps(Number(v))}
          className="w-48"
          options={[
            { value: "50", label: "0.5%" },
            { value: "100", label: "1%" },
            { value: "200", label: "2%" },
          ]}
        />
      </div>

      {cta}
      <TxStatus state={tx.state} onRetry={needApproval ? approve : submit} />

      {isConnected && mode === "buy" && musd.balance === 0n && deployment.chain.testnet && (
        <p className="text-sm text-ink-2">
          No MUSD in this wallet. Get testnet BTC from the{" "}
          <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a>, then{" "}
          <a className="underline" href={TESTNET_FUNDING.borrowMusd} target="_blank" rel="noreferrer">borrow MUSD on Mezo</a>.{" "}
          {TESTNET_FUNDING.minBorrowNote}
        </p>
      )}
      <p className="text-xs text-muted">
        Prices are the market&apos;s current estimate, not a guarantee. You can lose the full amount you put in.
      </p>
    </section>
  );
}
