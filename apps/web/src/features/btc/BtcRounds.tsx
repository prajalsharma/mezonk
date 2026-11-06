"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Address, zeroAddress } from "viem";
import { useAccount, useBalance, useBlock, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { TxStatus } from "@/components/trading/TxStatus";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState, Hint, KeyValue, Notice, Skeleton, Status } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useTx } from "@/hooks/useTx";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { btcRoundsAbi } from "@/lib/contracts/abi";
import { formatBtc, formatDuration, formatUsd } from "@/lib/format";
import {
  RESULT,
  SIDE,
  WAD,
  type BetState,
  type Result,
  type RoundState,
  type Schedule,
  type Side,
  btcForUsd,
  chipsInRange,
  closeTime,
  estimatePayout,
  formatCountdown,
  lockTime,
  multipleX100,
  payoutOf,
  roundAt,
  secondsUntil,
  stakeFor,
  upShareBps,
} from "./math";

/** Quick stakes, in whole dollars. The contract's min/max decide which are enabled. */
const CHIPS = [10n, 25n, 50n, 100n].map((d) => d * WAD);
const HISTORY = 12;

type Phase = "pending" | "up" | "down" | "void";
const phaseOf = (r: number): Phase => (r === RESULT.Up ? "up" : r === RESULT.Down ? "down" : r === RESULT.Void ? "void" : "pending");

/**
 * Chain time that ticks. Anchored to the latest block's timestamp (re-anchored on every new block); between blocks
 * it advances with the local clock, so a countdown moves every second without ever being based on wall time.
 */
function useChainNow(): bigint | null {
  const block = useBlock({ chainId: deployment.chainId, watch: true });
  const ts = block.data?.timestamp;
  const [anchor, setAnchor] = useState<{ ts: bigint; at: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (ts !== undefined) setAnchor((a) => (a && a.ts >= ts ? a : { ts, at: Date.now() }));
  }, [ts]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;
  if (!anchor) return null;
  return anchor.ts + BigInt(Math.max(0, Math.floor((Date.now() - anchor.at) / 1000)));
}

export function BtcRounds() {
  const address = deployment.btcRoundsAddress;
  if (!address) {
    return (
      <Notice tone="warn" title="Not on this network">
        BTC up/down rounds aren&apos;t deployed on this network yet. Nothing here is live until the contract address is configured.
      </Notice>
    );
  }
  return <Rounds contract={address} />;
}

function Rounds({ contract }: { contract: Address }) {
  const { address: me, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const claimTx = useTx();
  const toast = useToast();
  const now = useChainNow();
  const base = { address: contract, abi: btcRoundsAbi, chainId: deployment.chainId } as const;
  const account = (me ?? zeroAddress) as Address;

  // Immutable schedule: read once.
  const fixed = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...base, functionName: "genesis" },
      { ...base, functionName: "interval" },
      { ...base, functionName: "captureWindow" },
    ],
    query: { staleTime: Infinity },
  });
  const schedule: Schedule | null = fixed.data
    ? { genesis: BigInt(fixed.data[0]), interval: BigInt(fixed.data[1]), captureWindow: BigInt(fixed.data[2]) }
    : null;

  // Live price and limits. btcForUsd reverts while Mezo's oracle is stale, so failures are allowed and shown.
  const live = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...base, functionName: "btcForUsd", args: [WAD] },
      { ...base, functionName: "minStakeUsd" },
      { ...base, functionName: "maxStakeUsd" },
      { ...base, functionName: "feeBps" },
      { ...base, functionName: "paused" },
    ],
    query: { refetchInterval: 10_000 },
  });
  const lv = live.data;
  const price = lv?.[0]?.status === "success" ? (lv[0].result as readonly [bigint, bigint])[1] : null;
  const priceStale = lv?.[0]?.status === "failure";
  const minUsd = lv?.[1]?.status === "success" ? (lv[1].result as bigint) : null;
  const maxUsd = lv?.[2]?.status === "success" ? (lv[2].result as bigint) : null;
  const feeBps = lv?.[3]?.status === "success" ? BigInt(lv[3].result as number) : null;
  const paused = lv?.[4]?.status === "success" ? (lv[4].result as boolean) : false;

  // The round open for bets, from chain time; the same formula as the contract's currentRound().
  const cur = schedule && now != null ? roundAt(now, schedule) : null;
  const prev = cur != null && cur > 0n ? cur - 1n : null;

  const rounds = useReadContracts({
    allowFailure: true,
    contracts:
      cur == null
        ? []
        : [
            { ...base, functionName: "getRound", args: [cur] },
            { ...base, functionName: "getBet", args: [cur, account] },
            { ...base, functionName: "getRound", args: [prev ?? 0n] },
            { ...base, functionName: "getBet", args: [prev ?? 0n, account] },
            { ...base, functionName: "claimable", args: [prev ?? 0n, account] },
            { ...base, functionName: "result", args: [prev ?? 0n] },
          ],
    query: { enabled: cur != null, refetchInterval: 10_000 },
  });
  const rv = rounds.data;
  const pick = <T,>(i: number): T | undefined => (rv?.[i]?.status === "success" ? (rv[i]!.result as T) : undefined);
  const curRound = pick<RoundState>(0);
  const curBet = pick<BetState>(1);
  const prevRound = prev == null ? undefined : pick<RoundState>(2);
  const prevBet = prev == null ? undefined : pick<BetState>(3);
  const prevClaimable = prev == null ? 0n : (pick<bigint>(4) ?? 0n);
  const prevResult = prev == null ? undefined : pick<number>(5);

  // Settled history: the rounds before the price window.
  const historyIds = useMemo(() => {
    if (cur == null || cur < 2n) return [] as bigint[];
    const out: bigint[] = [];
    for (let r = cur - 2n; r >= 0n && out.length < HISTORY; r--) out.push(r);
    return out;
  }, [cur]);
  const history = useReadContracts({
    allowFailure: true,
    contracts: historyIds.flatMap((r) => [
      { ...base, functionName: "getRound" as const, args: [r] as const },
      { ...base, functionName: "result" as const, args: [r] as const },
      { ...base, functionName: "getBet" as const, args: [r, account] as const },
      { ...base, functionName: "claimable" as const, args: [r, account] as const },
    ]),
    query: { enabled: historyIds.length > 0, refetchInterval: 30_000 },
  });
  const hv = history.data;
  const hpick = <T,>(i: number): T | undefined => (hv?.[i]?.status === "success" ? (hv[i]!.result as T) : undefined);
  const rows = historyIds.map((id, i) => ({
    id,
    round: hpick<RoundState>(i * 4),
    result: hpick<number>(i * 4 + 1),
    bet: hpick<BetState>(i * 4 + 2),
    claimable: hpick<bigint>(i * 4 + 3) ?? 0n,
  }));

  const balance = useBalance({ address: me, chainId: deployment.chainId, query: { enabled: !!me, refetchInterval: 15_000 } });

  const [side, setSide] = useState<Side>(SIDE.Up);
  const [chip, setChip] = useState<bigint>(CHIPS[0]!);
  const chips = minUsd != null && maxUsd != null ? chipsInRange(CHIPS, minUsd, maxUsd) : CHIPS.map((usd) => ({ usd, ok: true }));
  const chipOk = chips.find((c) => c.usd === chip)?.ok ?? false;
  const stakeBtc = price ? btcForUsd(chip, price) : null;
  const est =
    stakeBtc != null && curRound && feeBps != null ? estimatePayout(stakeBtc, side, curRound.upPool, curRound.downPool, feeBps) : null;

  const haveBet = !!curBet && curBet.amount > 0n;
  const lockedToSide = haveBet ? (curBet!.side as Side) : null;
  useEffect(() => {
    if (lockedToSide != null) setSide(lockedToSide);
  }, [lockedToSide]);

  const wrongChain = isConnected && chainId !== deployment.chainId;
  const lockAt = cur != null && schedule ? lockTime(cur, schedule) : null;
  const toLock = lockAt != null && now != null ? secondsUntil(lockAt, now) : null;
  const prevCloseAt = prev != null && schedule ? closeTime(prev, schedule) : null;
  const toClose = prevCloseAt != null && now != null ? secondsUntil(prevCloseAt, now) : null;

  const refresh = () => {
    void rounds.refetch();
    void history.refetch();
    void balance.refetch();
  };

  async function placeBet() {
    if (cur == null || minUsd == null || maxUsd == null) return;
    const round = cur;
    const label = `Bet $${(chip / WAD).toString()} on ${side === SIDE.Up ? "Up" : "Down"}`;
    let value = 0n;
    await tx.run({
      label,
      validate: async () => {
        // The contract decides which round is open. If it moved on since the page rendered, the pools and the
        // estimate the user saw no longer apply: stop, and let the page catch up rather than bet blind.
        const open = await client!.readContract({ ...base, functionName: "currentRound" });
        if (open !== round) {
          refresh();
          throw new Error(`Round ${round.toString()} just closed for bets. Round ${open.toString()} is open now; check the pools and bet again.`);
        }
        // Size the stake at the price right now, not the one the page last showed.
        const [, p] = await client!.readContract({ ...base, functionName: "btcForUsd", args: [chip] });
        value = stakeFor(chip, p, minUsd, maxUsd);
        const bal = balance.data?.value ?? 0n;
        if (bal < value) throw new Error(`This wallet holds ${formatBtc(bal)} BTC; the stake alone needs ${formatBtc(value)} BTC, plus gas.`);
        await client!.simulateContract({ ...base, functionName: "bet", args: [round, side], value, account: me! });
      },
      send: () => writeContractAsync({ ...base, functionName: "bet", args: [round, side], value }),
      onConfirmed: () => {
        toast({ tone: "success", title: "Bet placed", body: `${formatBtc(value)} BTC on ${side === SIDE.Up ? "Up" : "Down"} in round ${round.toString()}.` });
        refresh();
      },
    });
  }

  const claimIds = [
    ...(prev != null && prevClaimable > 0n ? [prev] : []),
    ...rows.filter((r) => r.claimable > 0n).map((r) => r.id),
  ];
  const claimTotal = (prev != null ? prevClaimable : 0n) + rows.reduce((a, r) => a + r.claimable, 0n);

  async function claimAll() {
    if (claimIds.length === 0) return;
    await claimTx.run({
      label: `Claim ${formatBtc(claimTotal)} BTC`,
      send: () => writeContractAsync({ ...base, functionName: "claim", args: [claimIds] }),
      onConfirmed: () => {
        toast({ tone: "success", title: "Claimed", body: `${formatBtc(claimTotal)} BTC is in your wallet.` });
        refresh();
      },
    });
  }

  if (fixed.isError) {
    return (
      <Notice tone="error" title="Couldn't reach the rounds contract">
        The network didn&apos;t answer. Check your connection and reload.
      </Notice>
    );
  }
  if (!schedule || now == null || cur == null) return <LoadingLayout />;

  const sideWord = side === SIDE.Up ? "Up" : "Down";
  const feePct = feeBps == null ? null : `${(Number(feeBps) / 100).toString()}%`;

  let cta: React.ReactNode;
  if (!isConnected || wrongChain) cta = <WalletButton block />;
  else if (paused) cta = <Button disabled className="w-full" size="lg">Betting paused</Button>;
  else if (priceStale) cta = <Button disabled className="w-full" size="lg">Price feed is stale</Button>;
  else if (!price || minUsd == null) cta = <Button disabled loading className="w-full" size="lg">Reading the price</Button>;
  else if (!chipOk) cta = <Button disabled className="w-full" size="lg">Pick an amount in range</Button>;
  else if (toLock === 0n) cta = <Button disabled className="w-full" size="lg">Round rolling over</Button>;
  else if (lockedToSide != null && lockedToSide !== side) cta = <Button disabled className="w-full" size="lg">You&apos;re on {lockedToSide === SIDE.Up ? "Up" : "Down"} this round</Button>;
  else
    cta = (
      <Button variant={side === SIDE.Up ? "yes" : "no"} className="w-full" size="lg" loading={tx.busy} onClick={placeBet}>
        Bet ${(chip / WAD).toString()} on {sideWord}
      </Button>
    );

  const upBps = curRound ? Number(upShareBps(curRound.upPool, curRound.downPool)) : 0;

  return (
    <div className="space-y-6">
      {/* The question, the live price and the round clock. */}
      <section aria-label="Now" className="panel grid gap-5 p-5 md:grid-cols-[1fr_auto_auto] md:items-end md:gap-10 md:p-6">
        <div className="space-y-1">
          <h2 className="display text-2xl md:text-3xl">Will BTC be higher in {formatDuration(Number(schedule.interval))}?</h2>
          <p className="text-sm text-ink-2">
            Rounds lock every {formatDuration(Number(schedule.interval))}. Stake BTC on Up or Down; winners split the pool.
          </p>
        </div>
        <Stat label="BTC now" hint="The BTC/USD price Mezo's PriceFeed reports, the same one it uses for loans. Read every 10 seconds.">
          {price ? formatUsd(price) : priceStale ? <span className="text-base font-medium text-warn">Feed stale</span> : <Skeleton className="h-7 w-28" />}
        </Stat>
        <Stat label={`Round ${cur.toString()} locks in`}>
          <span aria-live="off">{toLock == null ? "—" : formatCountdown(toLock)}</span>
        </Stat>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Current round: place a bet. */}
        <section aria-labelledby="bet-h" className="panel space-y-4 p-5 shadow-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="bet-h" className="font-semibold">Round {cur.toString()}</h2>
            <span className="text-sm text-ink-2">
              Bets close in <span className="mono text-ink">{toLock == null ? "—" : formatCountdown(toLock)}</span>
            </span>
          </div>

          <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-2">
            {([SIDE.Up, SIDE.Down] as const).map((s) => {
              const active = side === s;
              const up = s === SIDE.Up;
              const pool = curRound ? (up ? curRound.upPool : curRound.downPool) : null;
              const blocked = lockedToSide != null && lockedToSide !== s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-disabled={blocked || undefined}
                  onClick={() => !blocked && (setSide(s), tx.reset())}
                  className={cx(
                    "press flex min-h-16 items-center gap-3 rounded-md border px-3.5 py-2 text-left transition-[border-color,background-color] duration-150",
                    active ? (up ? "border-yes bg-yes text-on-yes" : "border-no bg-no text-on-no") : "border-line bg-surface-2 hover:border-ink-2/40",
                    blocked && "opacity-45",
                  )}
                >
                  {up ? <ArrowUp className="size-5 shrink-0" aria-hidden /> : <ArrowDown className="size-5 shrink-0" aria-hidden />}
                  <span className="flex min-w-0 flex-col">
                    <span className={cx("text-sm font-semibold", !active && (up ? "text-yes-text" : "text-no-text"))}>{up ? "Up" : "Down"}</span>
                    <span className={cx("mono truncate text-xs", active ? "opacity-85" : "text-muted")}>
                      {pool == null ? "—" : `${formatBtc(pool)} BTC`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Stake</span>
              {minUsd != null && maxUsd != null && (
                <span className="text-xs text-muted">
                  {formatUsd(minUsd)} to {formatUsd(maxUsd)} at today&apos;s price
                </span>
              )}
            </div>
            <div role="radiogroup" aria-label="Stake" className="grid grid-cols-4 gap-2">
              {chips.map((c) => {
                const active = chip === c.usd;
                const title = !c.ok ? (minUsd != null && c.usd < minUsd ? `Below the ${formatUsd(minUsd)} minimum` : `Above the ${formatUsd(maxUsd)} maximum`) : undefined;
                return (
                  <button
                    key={c.usd.toString()}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!c.ok}
                    title={title}
                    onClick={() => (setChip(c.usd), tx.reset())}
                    className={cx(
                      "press flex flex-col items-center gap-0.5 rounded-md border py-2.5 transition-[border-color,background-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45",
                      active ? "border-ink bg-surface-2 ring-1 ring-ink" : "border-line bg-sunk hover:border-ink-2/40",
                    )}
                  >
                    <span className="text-sm font-semibold">${(c.usd / WAD).toString()}</span>
                    <span className="mono text-[11px] text-muted">{price ? formatBtc(btcForUsd(c.usd, price)) : "—"}</span>
                  </button>
                );
              })}
            </div>
            {chips.every((c) => !c.ok) && minUsd != null && maxUsd != null && (
              <p className="text-sm text-warn">
                Stakes must be worth {formatUsd(minUsd)} to {formatUsd(maxUsd)}; none of the quick amounts fit right now.
              </p>
            )}
          </div>

          <PoolBar upBps={upBps} up={curRound?.upPool} down={curRound?.downPool} />

          <dl className="divide-y divide-line rounded-md border border-line bg-sunk/60 px-3.5" aria-live="polite">
            <KeyValue label="You stake">{stakeBtc != null ? <><span className="mono">{formatBtc(stakeBtc)}</span> BTC</> : "—"}</KeyValue>
            <KeyValue
              label={`If ${sideWord} wins, you get`}
              hint={
                <Hint label="the estimate" align="end">
                  An estimate from the pools as they stand now. Pools change until the round locks, so the final payout will differ.
                  Winners split the whole pool, less the {feePct ?? "—"} fee, in proportion to their stakes.
                </Hint>
              }
            >
              {est == null ? (
                "—"
              ) : est.oneSided ? (
                <span className="text-ink-2">Refund (nobody on {side === SIDE.Up ? "Down" : "Up"} yet)</span>
              ) : (
                <>
                  ≈ <span className="mono">{formatBtc(est.payout)}</span> BTC
                  <span className="ml-1.5 text-xs text-muted">{(Number(multipleX100(est.payout, stakeBtc!)) / 100).toFixed(2)}×</span>
                </>
              )}
            </KeyValue>
            <KeyValue label="Fee" hint={<Hint label="the fee" align="end">Taken from the pool only when one side wins. Refunded rounds pay no fee.</Hint>}>{feePct ? `${feePct} of the pool` : "—"}</KeyValue>
          </dl>

          {haveBet && curBet && (
            <Notice tone="info" title={`You're on ${curBet.side === SIDE.Up ? "Up" : "Down"} this round`}>
              <span className="mono">{formatBtc(curBet.amount)}</span> BTC, worth {formatUsd(curBet.usd)} when you staked it. You can add to it; you can&apos;t switch sides.
            </Notice>
          )}
          {paused && <Notice tone="warn" title="Betting is paused">Rolling and claiming still work, so nothing is stuck.</Notice>}
          {priceStale && !paused && (
            <Notice tone="warn" title="Mezo's price feed is stale right now">The oracle hasn&apos;t updated in over a minute. Bets need a fresh price; try again in a moment.</Notice>
          )}

          {cta}
          <TxStatus state={tx.state} onRetry={placeBet} />

          {isConnected && balance.data && balance.data.value === 0n && (
            <p className="text-sm text-ink-2">
              No BTC in this wallet.
              {deployment.chain.testnet && (
                <> Get testnet BTC from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a>.</>
              )}
            </p>
          )}
          <p className="text-xs text-muted">
            You bet against other players, never against MEZONK. Up wins if the close price is above the lock price, Down if below.
            A tie, a one-sided round or a missed price capture refunds every stake in full. You can lose what you put in.
          </p>
        </section>

        {/* Previous round: locked, waiting for its close price. */}
        <section aria-labelledby="prev-h" className="panel space-y-4 p-5">
          {prev == null || prevRound === undefined ? (
            <>
              <h2 id="prev-h" className="font-semibold">Last round</h2>
              {prev == null ? (
                <p className="text-sm text-ink-2">Round 0 is the first. There is no earlier round in its price window yet.</p>
              ) : (
                <Skeleton className="h-40 w-full" />
              )}
            </>
          ) : (
            <PriceWindow
              id={prev}
              round={prevRound}
              bet={prevBet}
              result={prevResult}
              price={price}
              toClose={toClose}
              now={now}
              schedule={schedule}
            />
          )}
        </section>
      </div>

      {/* History and claims. */}
      <section aria-labelledby="hist-h" className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="hist-h" className="font-semibold">Past rounds</h2>
            <p className="text-sm text-ink-2">Winnings and refunds are claimed, not sent automatically. Claims never expire.</p>
          </div>
          {isConnected && !wrongChain ? (
            <Button variant={claimTotal > 0n ? "primary" : "secondary"} disabled={claimTotal === 0n} loading={claimTx.busy} onClick={claimAll}>
              {claimTotal > 0n ? <>Claim <span className="mono">{formatBtc(claimTotal)}</span> BTC</> : "Nothing to claim"}
            </Button>
          ) : null}
        </div>
        <TxStatus state={claimTx.state} onRetry={claimAll} />
        {historyIds.length === 0 ? (
          <EmptyState title="No rounds have settled yet">The first settled round shows up here once its close price is captured.</EmptyState>
        ) : history.isLoading && !hv ? (
          <ul className="space-y-2" aria-busy="true">
            {historyIds.slice(0, 4).map((id) => (
              <li key={id.toString()}><Skeleton className="h-12 w-full" /></li>
            ))}
          </ul>
        ) : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {rows.map((r) => (
              <HistoryCard key={r.id.toString()} {...r} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Round</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Lock → close</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Result</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Pool</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Your stake</th>
                  <th scope="col" className="py-2 font-medium text-right">Your payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <HistoryRow key={r.id.toString()} {...r} />
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm text-ink-2">
        {label}
        {hint && <Hint label={label}>{hint}</Hint>}
      </p>
      <p className="mono mt-0.5 text-2xl font-medium text-ink">{children}</p>
    </div>
  );
}

/** Up (brand blue) against Down (ink) by BTC staked. */
function PoolBar({ upBps, up, down }: { upBps: number; up?: bigint; down?: bigint }) {
  const total = (up ?? 0n) + (down ?? 0n);
  const pct = upBps / 100;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-yes-text">Up <span className="mono text-ink">{up == null ? "—" : formatBtc(up)}</span></span>
        <span className="text-muted">{total === 0n ? "No stakes yet" : `${pct.toFixed(0)}% / ${(100 - pct).toFixed(0)}%`}</span>
        <span className="text-no-text"><span className="mono text-ink">{down == null ? "—" : formatBtc(down)}</span> Down</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-no/20" role="img" aria-label={total === 0n ? "No stakes yet" : `${pct.toFixed(0)} percent of the pool on Up`}>
        <div className="absolute inset-y-0 left-0 bg-yes transition-[width] duration-500 ease-[var(--ease-out-expo)]" style={{ width: `${total === 0n ? 0 : pct}%` }} />
      </div>
    </div>
  );
}

function PriceWindow({
  id,
  round,
  bet,
  result,
  price,
  toClose,
  now,
  schedule,
}: {
  id: bigint;
  round: RoundState;
  bet?: BetState;
  result?: number;
  price: bigint | null;
  toClose: bigint | null;
  now: bigint;
  schedule: Schedule;
}) {
  const captureEnds = lockTime(id, schedule) + schedule.captureWindow;
  const missed = !round.locked && now > captureEnds;
  const minutes = Math.max(1, Math.round(Number(schedule.captureWindow) / 60));
  const phase = result == null ? "pending" : phaseOf(result);
  const upBps = Number(upShareBps(round.upPool, round.downPool));
  const diff = round.locked && price ? price - round.lockPrice : null;
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="prev-h" className="font-semibold">Round {id.toString()}</h2>
        <span className="text-sm text-ink-2">
          {phase === "pending" && !missed ? (
            <>Closes in <span className="mono text-ink">{toClose == null ? "—" : formatCountdown(toClose)}</span></>
          ) : phase === "void" || missed ? (
            "Void"
          ) : (
            "Settled"
          )}
        </span>
      </div>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <KeyValue label="Lock price">
          {round.locked ? (
            <span className="mono">{formatUsd(round.lockPrice)}</span>
          ) : missed ? (
            <span className="text-ink-2">Not captured</span>
          ) : (
            <span className="text-ink-2">Waiting for the keeper</span>
          )}
        </KeyValue>
        <KeyValue label={round.settled ? "Close price" : "BTC now vs lock"}>
          {round.settled ? (
            <span className="mono">{formatUsd(round.closePrice)}</span>
          ) : diff == null ? (
            "—"
          ) : (
            <>
              {diff === 0n ? (
                <span className="text-ink-2">Same as lock</span>
              ) : (
                <>
                  <span className="mono">{formatUsd(diff < 0n ? -diff : diff)}</span>{" "}
                  <span className="text-ink-2">{diff > 0n ? "above lock" : "below lock"}</span>
                </>
              )}
            </>
          )}
        </KeyValue>
        <KeyValue label="Result">
          {phase === "up" ? <Status tone="yes">Up</Status> : phase === "down" ? <Status tone="no">Down</Status> : phase === "void" || missed ? <Status tone="muted">Void, stakes refund</Status> : <Status tone="muted">Pending</Status>}
        </KeyValue>
        <KeyValue label="Your bet">
          {bet && bet.amount > 0n ? (
            <>
              <span className="mono">{formatBtc(bet.amount)}</span> BTC on {bet.side === SIDE.Up ? "Up" : "Down"}
            </>
          ) : (
            <span className="text-ink-2">None</span>
          )}
        </KeyValue>
      </dl>
      <PoolBar upBps={upBps} up={round.upPool} down={round.downPool} />
      <p className="text-xs text-muted">
        {missed
          ? `Nobody captured the lock price within ${minutes} minute${minutes === 1 ? "" : "s"} of the boundary, so this round is void and every stake can be claimed back.`
          : `Prices come from Mezo's PriceFeed. A keeper (anyone) captures one within ${minutes} minute${minutes === 1 ? "" : "s"} of each boundary; that same capture closes this round and locks the next. Miss the window and the round refunds.`}
      </p>
    </>
  );
}

interface HistoryProps { id: bigint; round?: RoundState; result?: number; bet?: BetState; claimable: bigint }

/** The pieces of one settled round, shared by the table row and the small-screen card. */
function historyCells({ round, result, bet, claimable }: HistoryProps) {
  if (!round || result == null) return null;
  const phase = phaseOf(result);
  const mine = bet && bet.amount > 0n ? bet : null;
  const paid = mine ? payoutOf(round, mine, result as Result) : 0n;
  let payout: React.ReactNode = <span className="text-muted">—</span>;
  if (mine) {
    if (phase === "pending") payout = <span className="text-ink-2">Pending</span>;
    else if (mine.claimed) payout = <><span className="mono">{formatBtc(paid)}</span> paid</>;
    else if (claimable > 0n) payout = <><span className="mono">{formatBtc(claimable)}</span> to claim</>;
    else payout = <span className="mono">0</span>;
  }
  const prices = `${round.locked ? formatUsd(round.lockPrice) : "—"} → ${round.settled ? formatUsd(round.closePrice) : "—"}`;
  const status =
    phase === "up" ? <Status tone="yes">Up</Status> : phase === "down" ? <Status tone="no">Down</Status> : phase === "void" ? <Status tone="muted">Void</Status> : <Status tone="muted">Pending</Status>;
  const stake = mine ? (
    <><span className="mono">{formatBtc(mine.amount)}</span> on {mine.side === SIDE.Up ? "Up" : "Down"} <span className="text-muted">({formatUsd(mine.usd)})</span></>
  ) : (
    <span className="text-muted">—</span>
  );
  return { prices, status, stake, payout, pool: formatBtc(round.upPool + round.downPool) };
}

function HistoryRow(p: HistoryProps) {
  const c = historyCells(p);
  if (!c) {
    return (
      <tr>
        <td className="py-2.5 pr-3 mono">{p.id.toString()}</td>
        <td colSpan={5} className="py-2.5 text-muted">Couldn&apos;t read this round.</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="py-2.5 pr-3 mono">{p.id.toString()}</td>
      <td className="py-2.5 pr-3 mono whitespace-nowrap">{c.prices}</td>
      <td className="py-2.5 pr-3">{c.status}</td>
      <td className="py-2.5 pr-3 mono whitespace-nowrap">{c.pool}</td>
      <td className="py-2.5 pr-3 whitespace-nowrap">{c.stake}</td>
      <td className="py-2.5 text-right whitespace-nowrap">{c.payout}</td>
    </tr>
  );
}

function HistoryCard(p: HistoryProps) {
  const c = historyCells(p);
  return (
    <li className="space-y-1.5 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Round <span className="mono">{p.id.toString()}</span></span>
        {c ? c.status : <span className="text-muted">Couldn&apos;t read this round.</span>}
      </div>
      {c && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink-2">
          <dt>Lock → close</dt><dd className="mono text-right text-ink">{c.prices}</dd>
          <dt>Pool</dt><dd className="mono text-right text-ink">{c.pool} BTC</dd>
          <dt>Your stake</dt><dd className="text-right text-ink">{c.stake}</dd>
          <dt>Your payout</dt><dd className="text-right text-ink">{c.payout}</dd>
        </dl>
      )}
    </li>
  );
}

function LoadingLayout() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="panel p-5 md:p-6"><Skeleton className="h-16 w-full" /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel h-[28rem]" />
        <div className="panel h-[28rem]" />
      </div>
      <div className="panel h-48" />
    </div>
  );
}
