"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
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
  checkAddColl,
  checkClose,
  checkDraw,
  checkOpen,
  checkRepay,
  checkWithdrawColl,
  collForDebt,
  maxDebtAtRatio,
  maxRepay,
  maxWithdrawAtRatio,
  minReceivable,
  prepareAddColl,
  prepareClose,
  prepareDraw,
  prepareOpen,
  prepareRepay,
  prepareWithdrawColl,
  liquidationPrice,
  ratioOf,
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
/** Same, rounded up to the next cent, for amounts that must cover a shortfall. */
const toInputUp = (wei: bigint) => toInput(((wei + 10n ** 16n - 1n) / 10n ** 16n) * 10n ** 16n);
/** BTC for an input box: at most 6 decimals, rounded down so it never exceeds the real amount. */
const btcInput = (wei: bigint) => formatUnits(wei - (wei % 10n ** 12n), 18);

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
  const [done, setDone] = useState<{ fn: PreparedCall["functionName"]; amount: bigint } | null>(null);
  // "Bet from your loan": a ticket that is short on MUSD links here with ?need=<MUSD>&return=<market URL>.
  const search = useSearchParams();
  const need = parse(search.get("need") ?? "");
  const ret = search.get("return") ?? "";
  const returnTo = /^\/markets\/\d+/.test(ret) ? ret : null;

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
        return writeContractAsync({
          address: mezoBorrow!.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: c.functionName,
          args: c.args,
          ...(c.value > 0n ? { value: c.value } : {}),
          gas: c.gas,
          chainId: deployment.chainId,
        } as never);
      },
      onConfirmed: () => {
        setDone({ fn: prepared.current!.functionName, amount: prepared.current!.amount });
        after();
      },
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
      <div className="space-y-6">
        {done && <DoneNotice done={done} returnTo={returnTo} />}
        {p?.recoveryMode && (
          <Notice tone="warn" title="Mezo is in recovery mode">
            Mezo&apos;s whole system is under 150%, so it only allows changes that make loans safer: repaying and adding BTC.
            Borrowing more, taking BTC out and closing are paused until it recovers.
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
          <ManageLoan
            p={p}
            trove={trove}
            musdBalance={musd.balance}
            btcBalance={loan.btc}
            need={need}
            busy={tx.busy}
            connected={isConnected && !wrongChain}
            onDraw={(amt, floor) => send(() => prepareDraw(client!, mezoBorrow!, address!, amt, floor), "Borrow more")}
            onRepay={(amt) => send(() => prepareRepay(client!, mezoBorrow!, address!, amt, musd.balance ?? 0n), "Repay MUSD")}
            onAdd={(amt) => send(() => prepareAddColl(client!, mezoBorrow!, address!, amt, loan.btc ?? 0n), "Add BTC")}
            onWithdraw={(amt, floor) => send(() => prepareWithdrawColl(client!, mezoBorrow!, address!, amt, floor), "Withdraw BTC")}
            onClose={() => send(() => prepareClose(client!, mezoBorrow!, address!, musd.balance ?? 0n), "Close loan")}
          />
        ) : (
          <OpenForm
            p={p}
            need={need}
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
            See loans on mezo.org <ArrowUpRight className="size-4" aria-hidden />
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
  need,
  btcBalance,
  busy,
  connected,
  onSubmit,
}: {
  p: BorrowParams;
  /** MUSD a trade is short by (?need=). A new loan still has to meet Mezo's minimum. */
  need: bigint | null;
  btcBalance: bigint | undefined;
  busy: boolean;
  connected: boolean;
  onSubmit: (coll: bigint, debt: bigint, floor: bigint) => void;
}) {
  const startDebt = need ? (need > minReceivable(p) ? need : minReceivable(p)) : null;
  const [collIn, setCollIn] = useState(() => (startDebt ? btcInput(collForDebt(startDebt, SUGGESTED_RATIO, p) + 10n ** 12n) : ""));
  const [debtIn, setDebtIn] = useState(() => (startDebt ? toInputUp(startDebt) : ""));
  const [safety, setSafety] = useState<Safety | null>(startDebt ? null : "balanced");
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
        {need && (
          <p className="text-ink-2">
            Your trade needs <span className="mono text-ink">{formatMusd(need)}</span> more MUSD.{" "}
            {need < minOut ? `Mezo's smallest loan is ${formatMusd(minOut)} MUSD, so that's filled in; the rest stays in your wallet.` : "That's filled in below, at a 200% ratio."}
          </p>
        )}
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


/** What just happened, and where to go next. A trade that was short on MUSD gets sent back to its market. */
function DoneNotice({ done, returnTo }: { done: { fn: PreparedCall["functionName"]; amount: bigint }; returnTo: string | null }) {
  const back = returnTo ? <ButtonLink href={returnTo}>Back to your trade <ArrowRight className="size-4" /></ButtonLink> : null;
  switch (done.fn) {
    case "openTrove":
    case "withdrawMUSD":
      return (
        <Notice tone="success" title={`${formatMusd(done.amount)} MUSD is in your wallet`} action={back ?? <ButtonLink href="/markets">Find a market <ArrowRight className="size-4" /></ButtonLink>}>
          Your BTC is locked on Mezo, not sold. Repay any time to unlock it.
        </Notice>
      );
    case "repayMUSD":
      return <Notice tone="success" title={`Repaid ${formatMusd(done.amount)} MUSD`}>Your loan is smaller and its ratio is higher.</Notice>;
    case "addColl":
      return <Notice tone="success" title={`Added ${btc(done.amount)} BTC`}>Your loan is safer: it can take a bigger BTC drop before liquidation.</Notice>;
    case "withdrawColl":
      return <Notice tone="success" title={`${btc(done.amount)} BTC is back in your wallet`}>Your loan carries less BTC now, so watch its ratio.</Notice>;
    case "closeTrove":
      return <Notice tone="success" title="Loan closed">{btc(done.amount)} BTC is unlocked and back in your wallet, along with Mezo&apos;s refundable deposit.</Notice>;
  }
}

type Tab = "borrow" | "repay" | "add" | "withdraw" | "close";

/** An open loan: its health, and every change Mezo allows on it, each checked the way Mezo checks it. */
function ManageLoan({
  p,
  trove,
  musdBalance,
  btcBalance,
  need,
  busy,
  connected,
  onDraw,
  onRepay,
  onAdd,
  onWithdraw,
  onClose,
}: {
  p: BorrowParams;
  trove: Trove;
  musdBalance: bigint | undefined;
  btcBalance: bigint | undefined;
  need: bigint | null;
  busy: boolean;
  connected: boolean;
  onDraw: (amt: bigint, floor: bigint) => void;
  onRepay: (amt: bigint) => void;
  onAdd: (amt: bigint) => void;
  onWithdraw: (amt: bigint, floor: bigint) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(need ? "borrow" : "repay");
  const [amtIn, setAmtIn] = useState(() => (need ? toInputUp(need) : ""));
  const amt = parse(amtIn);
  const now = ratioOf(trove.coll, trove.debt, p.price);
  const liqNow = liquidationPrice(trove.coll, trove.debt, p.mcr);
  const pick = (t: Tab) => {
    setTab(t);
    setAmtIn("");
  };

  // Each tab computes the loan after the change, with Mezo's own rules (see lib/mezo/borrow).
  let chk: { ok: true; ratio: bigint; liquidation: bigint; rows: Array<[string, React.ReactNode]> } | { ok: false; reason: string } | null = null;
  let cta: React.ReactNode;
  let quick: React.ReactNode = null;
  const unit = tab === "add" || tab === "withdraw" ? "BTC" : "MUSD";
  const disabled = (label: string) => <Button disabled size="lg" className="w-full">{label}</Button>;

  if (tab === "borrow") {
    const c = amt ? checkDraw(trove, amt, p) : null;
    if (c) chk = c.ok ? { ok: true, ratio: c.ratio, liquidation: c.liquidation, rows: [["One-time fee", `${formatMusd(c.fee)} MUSD`], ["You'd owe", `${formatMusd(c.total)} MUSD`], ["Borrowing limit", `${formatMusd(trove.maxBorrowingCapacity)} MUSD`]] } : c;
    const atBalanced = maxDebtAtRatio(trove.coll, SUGGESTED_RATIO, p);
    const room = trove.maxBorrowingCapacity > trove.debt ? trove.maxBorrowingCapacity - trove.debt : 0n;
    const suggested = atBalanced > trove.debt ? ((atBalanced - trove.debt) * WAD) / (WAD + p.borrowingRate) : 0n;
    const cap = suggested < room ? suggested : room;
    if (cap > 0n) quick = <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => setAmtIn(toInput(cap))}>Up to 200%: <span className="mono font-medium text-yes-text">{formatMusd(cap)}</span></button>;
    cta = !amt ? disabled("Enter an amount") : !c?.ok ? disabled("Borrow less") : <Button size="lg" className="w-full" loading={busy} onClick={() => onDraw(amt, c.ratio - c.ratio / 50n)}>Borrow {formatMusd(amt)} more</Button>;
  } else if (tab === "repay") {
    const c = amt ? checkRepay(trove, amt, p, musdBalance) : null;
    if (c) chk = c.ok ? { ok: true, ratio: c.ratio, liquidation: c.liquidation, rows: [["You'd owe", `${formatMusd(c.debt)} MUSD`], ["Paid from", "This wallet's MUSD"]] } : c;
    const max = maxRepay(trove, p);
    const fill = musdBalance !== undefined && musdBalance < max ? musdBalance : max;
    if (fill > 0n) quick = <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => setAmtIn(toInput(fill))}>Max <span className="mono font-medium text-yes-text">{formatMusd(fill)}</span></button>;
    cta = !amt ? disabled("Enter an amount") : !c?.ok ? disabled(musdBalance !== undefined && amt > musdBalance ? "Not enough MUSD" : "Repay less") : <Button size="lg" className="w-full" loading={busy} onClick={() => onRepay(amt)}>Repay {formatMusd(amt)} MUSD</Button>;
  } else if (tab === "add") {
    const c = amt ? checkAddColl(trove, amt, p, btcBalance) : null;
    if (c) chk = c.ok ? { ok: true, ratio: c.ratio, liquidation: c.liquidation, rows: [["BTC locked", `${btc(c.coll)} BTC`]] } : c;
    if (btcBalance !== undefined && btcBalance > GAS_RESERVE) quick = <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => setAmtIn(btcInput(btcBalance - GAS_RESERVE))}>Balance <span className="mono">{btc(btcBalance)}</span> · <span className="font-medium text-yes-text">Max</span></button>;
    cta = !amt ? disabled("Enter an amount") : !c?.ok ? disabled("Not enough BTC") : <Button size="lg" className="w-full" loading={busy} onClick={() => onAdd(amt)}>Add {btc(amt)} BTC</Button>;
  } else if (tab === "withdraw") {
    const c = amt ? checkWithdrawColl(trove, amt, p) : null;
    if (c) chk = c.ok ? { ok: true, ratio: c.ratio, liquidation: c.liquidation, rows: [["BTC locked", `${btc(c.coll)} BTC`]] } : c;
    const safe = maxWithdrawAtRatio(trove, SUGGESTED_RATIO, p);
    if (safe > 0n && !p.recoveryMode) quick = <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => setAmtIn(btcInput(safe))}>Keep 200%: <span className="mono font-medium text-yes-text">{btc(safe)}</span></button>;
    cta = !amt ? disabled(p.recoveryMode ? "Paused in recovery mode" : "Enter an amount") : !c?.ok ? disabled("Take out less") : <Button size="lg" className="w-full" loading={busy} onClick={() => onWithdraw(amt, c.ratio - c.ratio / 50n)}>Take out {btc(amt)} BTC</Button>;
  } else {
    const c = checkClose(trove, p, musdBalance);
    chk = c.ok ? { ok: true, ratio: 0n, liquidation: 0n, rows: [] } : { ok: false, reason: c.reason };
    cta = c.ok ? <Button size="lg" className="w-full" loading={busy} onClick={onClose}>Repay {formatMusd(c.need)} MUSD and close</Button> : disabled(p.recoveryMode ? "Paused in recovery mode" : "Not enough MUSD");
  }
  if (!connected) cta = <WalletButton block />;

  return (
    <section aria-labelledby="loan-h" className="panel space-y-6 p-6 md:p-8">
      <div className="space-y-1">
        <h2 id="loan-h" className="text-2xl font-semibold tracking-tight">Your Mezo loan</h2>
        <p className="text-ink-2">Borrow more, repay, add or take out BTC, or close it. Every change is signed by your wallet on Mezo.</p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["BTC locked", btc(trove.coll)],
          ["You owe", `${formatMusd(trove.debt)}`],
          ["Ratio", pct(now)],
          ["Liquidation at", usd(liqNow)],
        ].map(([k, v]) => (
          <div key={k} className="space-y-1">
            <dt className="text-sm text-ink-2">{k}</dt>
            <dd className="mono text-lg font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <RatioMeter ratio={now} />

      <Segmented
        label="Change your loan"
        value={tab}
        onChange={pick}
        options={[
          { value: "repay", label: "Repay" },
          { value: "borrow", label: "Borrow" },
          { value: "add", label: "Add BTC" },
          { value: "withdraw", label: "Take out" },
          { value: "close", label: "Close" },
        ]}
      />

      {tab === "close" ? (
        <p className="text-ink-2">
          Closing repays everything you owe except Mezo&apos;s {formatMusd(p.gasCompensation)} MUSD deposit, which Mezo burns back, and returns all{" "}
          <span className="mono text-ink">{btc(trove.coll)}</span> BTC to your wallet.
        </p>
      ) : (
        <Amount id={`loan-${tab}`} label={{ borrow: "Borrow more", repay: "Repay", add: "Add BTC", withdraw: "Take out BTC" }[tab]} unit={unit} value={amtIn} onChange={setAmtIn} aside={quick} />
      )}

      {chk?.ok && tab !== "close" && (
        <Summary ratio={chk.ratio} liquidation={chk.liquidation} rows={[["Ratio now", pct(now)], ...chk.rows]} />
      )}
      {chk && !chk.ok && <Notice tone="warn">{chk.reason}</Notice>}
      {chk?.ok && tab !== "close" && chk.ratio < DANGER_RATIO && <Notice tone="warn" title="Very little room">A small drop in BTC could get this loan liquidated.</Notice>}
      {cta}
    </section>
  );
}
