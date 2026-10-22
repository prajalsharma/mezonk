"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Lock } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { MusdIdeas } from "@/components/markets/MusdIdeas";
import { TxStatus } from "@/components/trading/TxStatus";
import { Button, ButtonLink, Spinner } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { KeyValue, Notice, Segmented, inputClass } from "@/components/ui/primitives";
import { WalletButton } from "@/components/wallet/WalletButton";
import { mezoBorrow, useMezoLoan } from "@/hooks/useMezoLoan";
import { useMusd } from "@/hooks/useMusd";
import { useTx } from "@/hooks/useTx";
import { deployment, mezoBorrowUrl, TESTNET_FUNDING } from "@/lib/chain/config";
import { formatMusd } from "@/lib/format";
import {
  DANGER_RATIO,
  GAS_RESERVE,
  SUGGESTED_RATIO,
  WAD,
  WARN_RATIO,
  borrowerOperationsAbi,
  checkDraw,
  checkOpen,
  maxDebtAtRatio,
  minReceivable,
  prepareDraw,
  prepareOpen,
  type BorrowParams,
  type PreparedCall,
  type Trove,
} from "@/lib/mezo/borrow";

type Safety = "careful" | "balanced" | "bold";
const SAFETY: Record<Safety, { ratio: bigint; label: string }> = {
  careful: { ratio: (WAD * 250n) / 100n, label: "Careful" },
  balanced: { ratio: SUGGESTED_RATIO, label: "Balanced" },
  bold: { ratio: (WAD * 160n) / 100n, label: "Bold" },
};

const parse = (s: string): bigint | null => {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  try {
    return parseUnits(t, 18);
  } catch {
    return null;
  }
};
const btc = (wei: bigint, max = 6) =>
  Number(formatUnits(wei, 18)).toLocaleString("en-US", { maximumFractionDigits: max, minimumFractionDigits: 0 });
const usd = (wei: bigint) => `$${Math.round(Number(formatUnits(wei, 18))).toLocaleString("en-US")}`;
const pct = (ratio: bigint) => `${(Number(ratio / 10n ** 14n) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
/** Trim to whole MUSD cents so the input never shows 18 decimals. */
const toInput = (wei: bigint) => (Number(wei / 10n ** 16n) / 100).toFixed(2).replace(/\.00$/, "");

function tone(ratio: bigint) {
  if (ratio >= WARN_RATIO) return { label: "Comfortable", cls: "text-success", bar: "bg-success" };
  if (ratio >= DANGER_RATIO) return { label: "Tight", cls: "text-warn", bar: "bg-warn" };
  return { label: "Risky", cls: "text-danger", bar: "bg-danger" };
}

/** Collateral ratio on a 100%–300% track, with Mezo's 110% floor and the 150% comfort line marked. */
function RatioMeter({ ratio }: { ratio: bigint | null }) {
  const pos = (r: number) => Math.min(100, Math.max(0, ((r - 100) / 200) * 100));
  const r = ratio == null ? null : Number(ratio / 10n ** 14n) / 100;
  const t = ratio == null ? null : tone(ratio);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-2">Collateral ratio</span>
        <span className={cx("mono text-2xl font-medium", t?.cls)}>{ratio == null ? "—" : pct(ratio)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-surface-2">
        <div
          className={cx("absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-out-expo)]", t?.bar ?? "bg-line-strong")}
          style={{ width: `${r == null ? 0 : pos(r)}%` }}
        />
        <span aria-hidden className="absolute -top-1 h-4 w-px bg-danger" style={{ left: `${pos(110)}%` }} />
        <span aria-hidden className="absolute -top-1 h-4 w-px bg-ink-2/50" style={{ left: `${pos(150)}%` }} />
      </div>
      <div className="relative h-4 text-xs text-muted" aria-hidden>
        <span className="absolute -translate-x-1/2" style={{ left: `${pos(110)}%` }}>110% min</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${pos(150)}%` }}>150%</span>
        <span className="absolute right-0">300%+</span>
      </div>
      {t && <p className={cx("text-sm font-medium", t.cls)}>{t.label}</p>}
    </div>
  );
}

function Amount({ id, label, unit, value, onChange, aside }: { id: string; label: string; unit: string; value: string; onChange: (v: string) => void; aside?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(",", "."))}
          className={cx(inputClass, "mono h-14 pr-20 text-2xl")}
        />
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-ink-2">{unit}</span>
      </div>
    </div>
  );
}

export function BorrowPanel() {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const qc = useQueryClient();
  const loan = useMezoLoan();
  const musd = useMusd();
  const tx = useTx();
  const prepared = useRef<PreparedCall | null>(null);
  const [done, setDone] = useState<{ amount: bigint } | null>(null);

  const p = loan.params.data;
  const trove = loan.trove.data;
  const wrongChain = isConnected && chainId !== deployment.chainId;

  if (!mezoBorrow) {
    return <Notice tone="warn" title="Borrowing isn't available on this network">Borrow MUSD directly on <a className="underline" href={mezoBorrowUrl()} target="_blank" rel="noreferrer">Mezo</a>.</Notice>;
  }

  const after = () => {
    void qc.invalidateQueries({ queryKey: ["mezo-trove"] });
    void qc.invalidateQueries({ queryKey: ["mezo-borrow-params"] });
    void musd.refetch();
    void loan.refetchBtc();
  };

  async function send(prepare: () => Promise<PreparedCall>, label: string) {
    prepared.current = null;
    await tx.run({
      label,
      validate: async () => {
        prepared.current = await prepare();
      },
      send: () => {
        const c = prepared.current!;
        return c.functionName === "openTrove"
          ? writeContractAsync({ address: mezoBorrow!.borrowerOperations, abi: borrowerOperationsAbi, functionName: "openTrove", args: c.args, value: c.value, gas: c.gas, chainId: deployment.chainId })
          : writeContractAsync({ address: mezoBorrow!.borrowerOperations, abi: borrowerOperationsAbi, functionName: "withdrawMUSD", args: c.args, gas: c.gas, chainId: deployment.chainId });
      },
      onConfirmed: () => {
        setDone({ amount: prepared.current!.args[0] });
        after();
      },
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
      <div className="space-y-6">
        {done && (
          <Notice
            tone="success"
            title={`${formatMusd(done.amount)} MUSD is in your wallet`}
            action={<ButtonLink href="/markets">Find a market <ArrowRight className="size-4" /></ButtonLink>}
          >
            Your BTC is locked on Mezo, not sold. Repay any time to unlock it.
          </Notice>
        )}
        {!done && isConnected && !trove?.active && musd.balance !== undefined && musd.balance >= WAD && (
          <Notice tone="info" title={`You already have ${formatMusd(musd.balance)} MUSD`} action={<ButtonLink href="/markets" variant="secondary">Go to markets <ArrowRight className="size-4" /></ButtonLink>}>
            That&apos;s enough to trade. You only need a loan if you want more.
          </Notice>
        )}

        {loan.params.isError ? (
          <Notice tone="warn" title="Couldn't reach Mezo's price feed" action={<Button variant="secondary" onClick={() => loan.params.refetch()}>Try again</Button>}>
            {deployment.isLocalFork
              ? "Local forks can't run Mezo's live BTC price, so borrowing only works on the real network."
              : <>Mezo&apos;s network didn&apos;t answer. Try again, or borrow on <a className="underline" href={mezoBorrowUrl()} target="_blank" rel="noreferrer">mezo.org</a>.</>}
          </Notice>
        ) : !p ? (
          <p className="panel flex items-center gap-3 p-6 text-ink-2" aria-busy="true">
            <Spinner className="size-4" /> Getting Mezo&apos;s loan terms…
          </p>
        ) : trove?.active ? (
          <DrawForm p={p} trove={trove} busy={tx.busy} connected={isConnected && !wrongChain} onSubmit={(amt, floor) => send(() => prepareDraw(client!, mezoBorrow!, address!, amt, floor), "Borrow more")} />
        ) : (
          <OpenForm
            p={p}
            btcBalance={loan.btc}
            busy={tx.busy}
            connected={isConnected && !wrongChain}
            onSubmit={(coll, debt, floor) => send(() => prepareOpen(client!, mezoBorrow!, address!, coll, debt, floor), "Borrow MUSD")}
          />
        )}
        <TxStatus state={tx.state} />
        {/* Only here, where someone is about to borrow: other uses for MUSD that keep it on Mezo. */}
        {p && <MusdIdeas title={done ? "While you're here" : "Borrowing more than you'll trade?"} />}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
        <div className="panel space-y-4 p-6">
          <h2 className="font-semibold">How a Mezo loan works</h2>
          <ul className="space-y-3 text-[0.9375rem] text-ink-2">
            <li className="flex gap-3"><Lock className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />Your BTC is locked in Mezo&apos;s contract, not sold. MEZONK never touches it.</li>
            <li>You pay {p ? `${(Number(p.borrowingRate) / 1e16).toLocaleString("en-US", { maximumFractionDigits: 2 })}%` : "a small fee"} once, plus {p ? `${p.interestBps / 100}%` : "a low"} interest a year. Repay whenever you like; there&apos;s no due date.</li>
            <li>If BTC falls so your ratio drops under 110%, Mezo can liquidate the loan and you lose the locked BTC. Keep a buffer.</li>
            <li>Anyone can swap MUSD for BTC from the riskiest loans first (a &ldquo;redemption&rdquo;). Your debt drops by the same value, but you&apos;d hold less BTC. A higher ratio makes it less likely.</li>
          </ul>
          <a href={mezoBorrowUrl()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.9375rem] font-medium text-yes-text underline-offset-4 hover:underline">
            Repay, add BTC or close on Mezo <ArrowUpRight className="size-4" aria-hidden />
          </a>
        </div>
        {p && (
          <p className="text-sm text-muted">
            BTC price from Mezo&apos;s feed: <span className="mono text-ink-2">{usd(p.price)}</span>
            {p.recoveryMode && " · Mezo is in recovery mode: new loans need 150% or more."}
          </p>
        )}
        {deployment.chain.testnet && (
          <p className="text-sm text-muted">
            Testnet: get free BTC from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">Mezo faucet</a>.
          </p>
        )}
      </aside>
    </div>
  );
}

function Summary({ rows, ratio, liquidation }: { rows: Array<[string, React.ReactNode]>; ratio: bigint | null; liquidation: bigint | null }) {
  return (
    <div className="space-y-5 rounded-md border border-line bg-sunk p-5">
      <RatioMeter ratio={ratio} />
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm text-ink-2">Liquidated if BTC falls to</span>
        <span className="mono text-lg font-medium">{liquidation ? usd(liquidation) : "—"}</span>
      </div>
      <dl className="border-t border-line pt-2">
        {rows.map(([k, v]) => (
          <KeyValue key={k} label={k}>{v}</KeyValue>
        ))}
      </dl>
    </div>
  );
}

function OpenForm({
  p,
  btcBalance,
  busy,
  connected,
  onSubmit,
}: {
  p: BorrowParams;
  btcBalance: bigint | undefined;
  busy: boolean;
  connected: boolean;
  onSubmit: (coll: bigint, debt: bigint, floor: bigint) => void;
}) {
  const [collIn, setCollIn] = useState("");
  const [debtIn, setDebtIn] = useState("");
  const [safety, setSafety] = useState<Safety | null>("balanced");
  const [ack, setAck] = useState(false);
  const coll = parse(collIn);
  const debt = parse(debtIn);
  const minOut = minReceivable(p);

  const setFromSafety = (c: bigint | null, s: Safety | null) => {
    if (!c || !s) return;
    const d = maxDebtAtRatio(c, SAFETY[s].ratio, p);
    setDebtIn(d > 0n ? toInput(d) : "");
  };

  const chk = useMemo(() => (coll && debt ? checkOpen(coll, debt, p) : null), [coll, debt, p]);
  const ratio = chk?.ok ? chk.ratio : coll && debt ? (coll * p.price) / (debt + (debt * p.borrowingRate) / WAD + p.gasCompensation) : null;
  const needBtc = (coll ?? 0n) + GAS_RESERVE;
  const shortBtc = connected && btcBalance !== undefined && coll != null && needBtc > btcBalance;
  const minColl = ((minOut + (minOut * p.borrowingRate) / WAD + p.gasCompensation) * SUGGESTED_RATIO) / p.price;

  let cta: React.ReactNode;
  if (!connected) cta = <WalletButton block />;
  else if (!coll || !debt) cta = <Button disabled size="lg" className="w-full">Enter amounts</Button>;
  else if (shortBtc) cta = <Button disabled size="lg" className="w-full">Not enough BTC</Button>;
  else if (!chk?.ok) cta = <Button disabled size="lg" className="w-full">{debt + (debt * p.borrowingRate) / WAD < p.minNetDebt ? `Minimum is ${formatMusd(minOut)} MUSD` : "Lock more BTC or borrow less"}</Button>;
  else if (!ack) cta = <Button disabled size="lg" className="w-full">Tick the box to continue</Button>;
  else cta = <Button size="lg" className="w-full" loading={busy} onClick={() => onSubmit(coll, debt, chk.ratio - chk.ratio / 50n)}>Borrow {formatMusd(debt)} MUSD</Button>;

  return (
    <section aria-labelledby="open-h" className="panel space-y-6 p-6 md:p-8">
      <div className="space-y-1">
        <h2 id="open-h" className="text-2xl font-semibold tracking-tight">Borrow MUSD against your BTC</h2>
        <p className="text-ink-2">Minimum loan {formatMusd(minOut)} MUSD, so you&apos;ll need roughly {btc(minColl, 3)} BTC or more.</p>
      </div>

      <Amount
        id="borrow-btc"
        label="BTC to lock"
        unit="BTC"
        value={collIn}
        onChange={(v) => {
          setCollIn(v);
          setFromSafety(parse(v), safety);
        }}
        aside={
          btcBalance !== undefined && (
            <button
              type="button"
              className="text-sm text-ink-2 hover:text-ink"
              onClick={() => {
                const max = btcBalance > GAS_RESERVE ? btcBalance - GAS_RESERVE : 0n;
                const v = formatUnits(max - (max % 10n ** 12n), 18);
                setCollIn(v);
                setFromSafety(max, safety);
              }}
            >
              Balance <span className="mono">{btc(btcBalance)}</span> · <span className="font-medium text-yes-text">Max</span>
            </button>
          )
        }
      />

      <div className="space-y-2">
        <p className="text-sm font-medium">How much buffer?</p>
        <Segmented
          label="How much buffer"
          value={safety ?? ("" as Safety)}
          onChange={(s) => {
            setSafety(s);
            setFromSafety(coll, s);
          }}
          options={(Object.keys(SAFETY) as Safety[]).map((k) => ({ value: k, label: <span>{SAFETY[k].label} <span className="mono text-muted">{pct(SAFETY[k].ratio)}</span></span> }))}
        />
      </div>

      <Amount
        id="borrow-musd"
        label="MUSD you receive"
        unit="MUSD"
        value={debtIn}
        onChange={(v) => {
          setDebtIn(v);
          setSafety(null);
        }}
      />

      <Summary
        ratio={ratio}
        liquidation={chk?.ok ? chk.liquidation : null}
        rows={[
          ["You lock", coll ? `${btc(coll)} BTC (${usd((coll * p.price) / WAD)})` : "—"],
          ["You receive", debt ? `${formatMusd(debt)} MUSD` : "—"],
          [`One-time fee`, chk?.ok ? `${formatMusd(chk.fee)} MUSD` : "—"],
          ["Refundable deposit", `${formatMusd(p.gasCompensation)} MUSD`],
          ["Total you owe", chk?.ok ? `${formatMusd(chk.total)} MUSD` : "—"],
          ["Interest", `${p.interestBps / 100}% a year`],
        ]}
      />
      <p className="-mt-3 text-sm text-muted">
        The fee and the {formatMusd(p.gasCompensation)} MUSD deposit are added to what you owe. You get the deposit back when you close the loan.
      </p>

      {chk && !chk.ok && <Notice tone="warn">{chk.reason}</Notice>}
      {chk?.ok && chk.ratio < DANGER_RATIO && (
        <Notice tone="warn" title="Very little room">A small drop in BTC could get this loan liquidated. Lock more BTC or borrow less.</Notice>
      )}

      <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem] text-ink-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
        <span>
          I understand this is a loan from Mezo, not MEZONK, and that my BTC can be liquidated
          {chk?.ok ? <> if BTC falls to about <span className="mono text-ink">{usd(chk.liquidation)}</span></> : " if BTC falls too far"}.
        </span>
      </label>
      {cta}
    </section>
  );
}

function DrawForm({ p, trove, busy, connected, onSubmit }: { p: BorrowParams; trove: Trove; busy: boolean; connected: boolean; onSubmit: (amt: bigint, floor: bigint) => void }) {
  const [amtIn, setAmtIn] = useState("");
  const amt = parse(amtIn);
  const now = trove.debt === 0n ? 0n : (trove.coll * p.price) / trove.debt;
  const chk = amt ? checkDraw(trove, amt, p) : null;
  const room = trove.maxBorrowingCapacity > trove.debt ? trove.maxBorrowingCapacity - trove.debt : 0n;
  const atBalanced = maxDebtAtRatio(trove.coll, SUGGESTED_RATIO, p);
  const suggested = atBalanced > trove.debt ? (atBalanced - trove.debt) * WAD / (WAD + p.borrowingRate) : 0n;

  let cta: React.ReactNode;
  if (!connected) cta = <WalletButton block />;
  else if (!amt) cta = <Button disabled size="lg" className="w-full">Enter an amount</Button>;
  else if (!chk?.ok) cta = <Button disabled size="lg" className="w-full">Borrow less</Button>;
  else cta = <Button size="lg" className="w-full" loading={busy} onClick={() => onSubmit(amt, chk.ratio - chk.ratio / 50n)}>Borrow {formatMusd(amt)} more</Button>;

  return (
    <section aria-labelledby="draw-h" className="panel space-y-6 p-6 md:p-8">
      <div className="space-y-1">
        <h2 id="draw-h" className="text-2xl font-semibold tracking-tight">Your Mezo loan</h2>
        <p className="text-ink-2">You already have a loan on Mezo. You can borrow more on it without locking more BTC.</p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["BTC locked", `${btc(trove.coll)}`],
          ["You owe", `${formatMusd(trove.debt)}`],
          ["Ratio", pct(now)],
          ["Liquidation", usd((trove.debt * p.mcr) / (trove.coll || 1n))],
        ].map(([k, v]) => (
          <div key={k} className="space-y-1">
            <dt className="text-sm text-ink-2">{k}</dt>
            <dd className="mono text-lg font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <Amount
        id="draw-musd"
        label="Borrow more"
        unit="MUSD"
        value={amtIn}
        onChange={setAmtIn}
        aside={
          suggested > 0n && (
            <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => setAmtIn(toInput(suggested < room ? suggested : room))}>
              Up to 200%: <span className="mono font-medium text-yes-text">{formatMusd(suggested < room ? suggested : room)}</span>
            </button>
          )
        }
      />
      <Summary
        ratio={chk?.ok ? chk.ratio : now}
        liquidation={chk?.ok ? chk.liquidation : (trove.debt * p.mcr) / (trove.coll || 1n)}
        rows={[
          ["One-time fee", chk?.ok ? `${formatMusd(chk.fee)} MUSD` : "—"],
          ["Total you'd owe", chk?.ok ? `${formatMusd(chk.total)} MUSD` : `${formatMusd(trove.debt)} MUSD`],
          ["Borrowing limit", `${formatMusd(trove.maxBorrowingCapacity)} MUSD`],
        ]}
      />
      {chk && !chk.ok && <Notice tone="warn">{chk.reason}</Notice>}
      {chk?.ok && chk.ratio < DANGER_RATIO && <Notice tone="warn" title="Very little room">A small drop in BTC could get this loan liquidated.</Notice>}
      {cta}
    </section>
  );
}
