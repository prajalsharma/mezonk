"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { ButtonLink } from "@/components/ui/Button";
import { TxLink } from "@/components/ui/Address";
import { cx } from "@/components/ui/cx";
import { EmptyState, Hint, Notice, Skeleton, Status, inputClass } from "@/components/ui/primitives";
import { ActivityList } from "@/components/markets/ActivityList";
import { WalletButton } from "@/components/wallet/WalletButton";
import { ClaimButton, RedeemDetails } from "@/features/resolution/Claims";
import { usePendingTxs } from "@/hooks/usePendingTxs";
import { apiGet, type EventDto } from "@/lib/api/types";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { formatMusd, formatShares, relativeTime } from "@/lib/format";
import { quoteSell } from "@/lib/market/math";
import { outcomeLabel, type StageInfo } from "@/lib/market/stage";
import type { Availability } from "@/lib/market/permissions";

interface PositionDto {
  marketId: number;
  question: string;
  poolYes: string;
  poolNo: string;
  feeBps: number;
  closeTime: string;
  stage: StageInfo;
  finalOutcome: number | null;
  yesShares: string;
  noShares: string;
  yesCost: string;
  noCost: string;
  realizedPnl: string;
  feesPaid: string;
  redeemed: boolean;
  redeemedPayout: string;
  isCreator: boolean;
}
interface PortfolioDto {
  positions: PositionDto[];
  created: Array<{ marketId: number; question: string; stage: StageInfo; initialLiquidity: string; volume: string; finalOutcome: number | null }>;
}

type ClaimStatus = "claimable" | "refund" | "pending" | "claimed" | "awaiting" | "lost" | "invalid-claimed" | "open";

const STATUS_LABEL: Record<ClaimStatus, string> = {
  claimable: "Payout claimable",
  refund: "Refund claimable",
  pending: "Claim submitted",
  claimed: "Claimed",
  "invalid-claimed": "Refund claimed",
  awaiting: "Awaiting resolution",
  lost: "Lost · nothing to claim",
  open: "Open position",
};
const STATUS_TONE: Record<ClaimStatus, "yes" | "no" | "warn" | "muted" | "accent" | "info" | "success" | "danger"> = {
  claimable: "success",
  refund: "success",
  pending: "info",
  claimed: "muted",
  "invalid-claimed": "muted",
  awaiting: "warn",
  lost: "muted",
  open: "info",
};
const FILTERS: Array<{ v: "all" | ClaimStatus | "invalid"; l: string }> = [
  { v: "all", l: "All" },
  { v: "claimable", l: "Claimable" },
  { v: "pending", l: "Submitted" },
  { v: "awaiting", l: "Awaiting resolution" },
  { v: "claimed", l: "Claimed" },
  { v: "lost", l: "Lost" },
  { v: "invalid", l: "Invalid / cancelled" },
  { v: "open", l: "Open" },
];

const big = (s: string) => BigInt(s);
const signed = (x: bigint) => `${x < 0n ? "−" : x > 0n ? "+" : ""}${formatMusd(x < 0n ? -x : x)}`;

export function Portfolio() {
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();
  const pending = usePendingTxs();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["v"]>("all");
  const [text, setText] = useState("");
  const [since, setSince] = useState<"all" | "7" | "30">("all");

  const pf = useQuery({
    queryKey: ["portfolio", address],
    enabled: !!address,
    queryFn: () => apiGet<PortfolioDto>(`/api/portfolio/${address}`),
    refetchInterval: 20_000,
  });
  const acts = useQuery({
    queryKey: ["portfolio", address, "activity"],
    enabled: !!address,
    queryFn: () => apiGet<{ events: EventDto[] }>(`/api/activity/${address}?limit=100`),
  });

  // Authoritative per-market reads: balances, claimable amount, finality.
  const ids = pf.data?.positions.map((p) => p.marketId) ?? [];
  const base = { address: deployment.marketsAddress!, abi: mezonkMarketsAbi, chainId: deployment.chainId } as const;
  const live = useReadContracts({
    allowFailure: true,
    contracts: [
      ...ids.flatMap((id) => [
        { ...base, functionName: "getMarket" as const, args: [BigInt(id)] as const },
        { ...base, functionName: "yesBalance" as const, args: [BigInt(id), address!] as const },
        { ...base, functionName: "noBalance" as const, args: [BigInt(id), address!] as const },
        { ...base, functionName: "claimable" as const, args: [BigInt(id), address!] as const },
      ]),
      { ...base, functionName: "bondCredits" as const, args: [address!] as const },
    ],
    query: { enabled: !!address && !!deployment.marketsAddress && ids.length >= 0, refetchInterval: 15_000 },
  });

  const claimTx = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of acts.data?.events ?? []) if (e.eventName === "Redeemed" && e.marketId != null) map.set(e.marketId, e.txHash);
    return map;
  }, [acts.data]);

  const rows = useMemo(() => {
    if (!pf.data) return [];
    return pf.data.positions.map((p, i) => {
      const r = live.data;
      const m = r?.[i * 4]?.status === "success" ? (r[i * 4]!.result as { finalized: boolean; finalOutcome: number; poolYes: bigint; poolNo: bigint; feeBps: number }) : undefined;
      const yes = r?.[i * 4 + 1]?.status === "success" ? (r[i * 4 + 1]!.result as bigint) : big(p.yesShares);
      const no = r?.[i * 4 + 2]?.status === "success" ? (r[i * 4 + 2]!.result as bigint) : big(p.noShares);
      const claimable = r?.[i * 4 + 3]?.status === "success" ? (r[i * 4 + 3]!.result as bigint) : 0n;
      const chainOk = !!m;
      const finalized = m?.finalized ?? p.finalOutcome != null;
      const outcome = m?.finalized ? m.finalOutcome : p.finalOutcome;
      const pend = pending.items.find((t) => t.marketId === p.marketId && t.kind === "redeem" && t.status === "pending");
      let status: ClaimStatus;
      if (pend) status = "pending";
      else if (finalized && claimable > 0n) status = outcome === 3 ? "refund" : "claimable";
      else if (finalized && (p.redeemed || yes + no === 0n)) status = outcome === 3 ? "invalid-claimed" : "claimed";
      else if (finalized) status = "lost";
      else if (p.stage.stage === "open") status = "open";
      else status = "awaiting";
      const cost = big(p.yesCost) + big(p.noCost);
      let exit: bigint | null = null;
      if (!finalized && m) {
        try {
          const pool = { yes: m.poolYes, no: m.poolNo };
          exit = (yes > 0n ? quoteSell(pool, "yes", yes, m.feeBps).out : 0n) + (no > 0n ? quoteSell(pool, "no", no, m.feeBps).out : 0n);
        } catch {
          exit = null;
        }
      }
      return { p, yes, no, claimable, finalized, outcome, status, cost, exit, chainOk, pend };
    });
  }, [pf.data, live.data, pending.items]);

  const bondCredits = live.data?.at(-1)?.status === "success" ? (live.data.at(-1)!.result as bigint) : 0n;

  const filtered = rows.filter((r) => {
    if (filter === "invalid" ? r.outcome !== 3 : filter === "claimable" ? r.status !== "claimable" && r.status !== "refund" : filter === "claimed" ? r.status !== "claimed" && r.status !== "invalid-claimed" : filter !== "all" && r.status !== filter) return false;
    if (text && !r.p.question.toLowerCase().includes(text.toLowerCase())) return false;
    if (since !== "all" && Date.now() - new Date(r.p.closeTime).getTime() > Number(since) * 86_400_000) return false;
    return true;
  });

  const totals = rows.reduce(
    (a, r) => ({
      realized: a.realized + big(r.p.realizedPnl),
      fees: a.fees + big(r.p.feesPaid),
      open: a.open + (r.finalized ? 0n : r.cost),
      exit: a.exit + (r.exit ?? 0n),
      claimable: a.claimable + r.claimable,
      won: a.won + (r.finalized && r.outcome !== 3 && (r.claimable > 0n || (r.status === "claimed" && big(r.p.redeemedPayout) > 0n)) ? 1 : 0),
      lost: a.lost + (r.status === "lost" || (r.status === "claimed" && big(r.p.redeemedPayout) === 0n) ? 1 : 0),
    }),
    { realized: 0n, fees: 0n, open: 0n, exit: 0n, claimable: 0n, won: 0, lost: 0 },
  );

  const refresh = () => {
    void live.refetch();
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
  };

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <h1 className="display text-5xl md:text-6xl">Portfolio</h1>
        <EmptyState title="Connect a wallet to see your positions" action={<WalletButton />}>
          Your positions, claims and history are read from the chain for the connected address. Nothing is stored about you.
        </EmptyState>
      </div>
    );
  }

  const avail = (a: boolean, reason: string): Availability => ({ available: a, reason });

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="display text-5xl md:text-6xl">Portfolio</h1>
          <p className="text-ink-2">Positions and claims for the connected wallet.</p>
        </div>
        <button onClick={refresh} className="text-sm font-semibold text-ink-2 hover:text-ink">Refresh</button>
      </div>

      {pf.error && <Notice tone="warn" title="Indexed history unavailable">Live balances and claims still work. Cost basis and history need the index.</Notice>}

      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-5 md:grid-cols-5">
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted">Claimable now <Hint label="claimable">Sum of the contract&apos;s claimable() for every market you hold. Authoritative.</Hint></dt>
          <dd className="tnum text-xl font-semibold">{formatMusd(totals.claimable)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted">Open cost basis <Hint label="cost basis">MUSD paid (fees included) for shares still held in unresolved markets, average-cost method.</Hint></dt>
          <dd className="tnum text-xl font-semibold">{formatMusd(totals.open)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted">Sell value now <Hint label="sell value">What selling every open position to the pools right now would return after fees. Not a guaranteed value; prices move.</Hint></dt>
          <dd className="tnum text-xl font-semibold">{formatMusd(totals.exit)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted">Realized P&amp;L <Hint label="realized">Sales and redemptions minus average cost of the shares closed. From indexed events.</Hint></dt>
          <dd className={cx("tnum text-xl font-semibold", totals.realized > 0n ? "text-gain" : totals.realized < 0n ? "text-loss" : "")}>{signed(totals.realized)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Fees paid · won / lost</dt>
          <dd className="tnum text-xl font-semibold">{formatMusd(totals.fees)} <span className="text-base text-ink-2">· {totals.won} / {totals.lost}</span></dd>
        </div>
      </dl>

      {bondCredits > 0n && (
        <div className="max-w-md">
          <ClaimButton fn="withdrawBond" marketId={0} account={address} avail={avail(true, "")} amount={bondCredits} title="Withdraw bonds" variant="secondary" details={<></>} onDone={refresh} />
        </div>
      )}

      <section aria-labelledby="claims" className="space-y-4">
        <h2 id="claims" className="text-xl font-semibold">Positions and claims</h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div role="group" aria-label="Filter by status" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
            {FILTERS.map((f) => (
              <button key={f.v} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)} className={cx("shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold", filter === f.v ? "bg-primary text-on-primary" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                {f.l}
              </button>
            ))}
          </div>
          <div className="flex gap-2 md:ml-auto">
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by market" aria-label="Filter by market" className={cx(inputClass, "md:w-56")} />
            <select aria-label="Closed within" value={since} onChange={(e) => setSince(e.target.value as typeof since)} className={cx(inputClass, "w-36")}>
              <option value="all">Any date</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </div>
        </div>

        {pf.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        ) : !rows.length ? (
          <EmptyState title="No positions yet" action={<ButtonLink href="/discover">Find a market</ButtonLink>}>
            {deployment.chain.testnet ? (
              <>Need MUSD? Get testnet BTC from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">faucet</a> and <a className="underline" href={TESTNET_FUNDING.borrowMusd} target="_blank" rel="noreferrer">borrow MUSD</a>.</>
            ) : null}
          </EmptyState>
        ) : !filtered.length ? (
          <p className="py-6 text-sm text-muted">Nothing matches these filters.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {filtered.map(({ p, yes, no, claimable, outcome, status, cost, exit, chainOk, pend }) => (
              <li key={p.marketId} className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_14rem_16rem]">
                <div className="min-w-0 space-y-1">
                  <Status tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Status>
                  <Link href={`/markets/${p.marketId}`} className="block font-semibold hover:underline">{p.question}</Link>
                  <p className="text-sm text-ink-2">
                    {outcome != null ? `Final: ${outcomeLabel(outcome)}` : p.stage.label}
                    {p.stage.stage === "open" && ` · closes ${relativeTime(new Date(p.closeTime))}`}
                  </p>
                  {claimTx.get(p.marketId) && <p className="text-xs text-muted">Claim tx <TxLink hash={claimTx.get(p.marketId)!} /></p>}
                  {pend && <p className="text-xs text-muted">Submitted <TxLink hash={pend.hash} /> · waiting for confirmation</p>}
                </div>
                <dl className="tnum space-y-0.5 text-sm">
                  {yes > 0n && <div className="flex justify-between"><dt className="text-yes-text">Yes</dt><dd>{formatShares(yes)}</dd></div>}
                  {no > 0n && <div className="flex justify-between"><dt className="text-no-text">No</dt><dd>{formatShares(no)}</dd></div>}
                  {cost > 0n && <div className="flex justify-between text-ink-2"><dt>Cost basis</dt><dd>{formatMusd(cost)}</dd></div>}
                  {exit !== null && exit > 0n && <div className="flex justify-between text-ink-2"><dt>Sell value</dt><dd>{formatMusd(exit)}</dd></div>}
                  {big(p.redeemedPayout) > 0n && <div className="flex justify-between text-ink-2"><dt>Paid out</dt><dd>{formatMusd(p.redeemedPayout)}</dd></div>}
                  <div className="flex justify-between text-ink-2"><dt>Fees paid</dt><dd>{formatMusd(p.feesPaid)}</dd></div>
                  {!chainOk && <p className="text-xs text-warn">Live read failed; showing indexed shares.</p>}
                </dl>
                <div>
                  {(status === "claimable" || status === "refund") && outcome != null ? (
                    <ClaimButton
                      fn="redeem"
                      marketId={p.marketId}
                      account={address}
                      avail={avail(true, "")}
                      amount={claimable}
                      title={status === "refund" ? "Claim refund" : "Claim payout"}
                      details={<RedeemDetails outcome={outcome} yes={yes} no={no} />}
                      onDone={refresh}
                    />
                  ) : status === "lost" ? (
                    <p className="text-sm text-ink-2">Your shares were on the losing side. Nothing to claim.</p>
                  ) : status === "awaiting" ? (
                    <p className="text-sm text-ink-2">Claims open once the outcome is final. <Link className="underline" href={`/markets/${p.marketId}#resolution`}>Follow resolution</Link></p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!!pf.data?.created.length && (
        <section aria-labelledby="created" className="space-y-3">
          <h2 id="created" className="text-xl font-semibold">Markets you created</h2>
          <ul className="divide-y divide-line border-y border-line">
            {pf.data.created.map((c) => (
              <li key={c.marketId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/markets/${c.marketId}#resolution`} className="font-semibold hover:underline">{c.question}</Link>
                <span className="tnum text-sm text-ink-2">{c.stage.label} · seeded {formatMusd(c.initialLiquidity)} · volume {formatMusd(c.volume, { compact: true })}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Withdraw pool liquidity and creator fees from each market&apos;s resolution section.</p>
        </section>
      )}

      <section aria-labelledby="history" className="space-y-3">
        <h2 id="history" className="text-xl font-semibold">History</h2>
        {acts.isLoading ? <Skeleton className="h-32 w-full" /> : acts.data?.events.length ? <ActivityList events={acts.data.events} showMarket /> : <p className="text-sm text-muted">No indexed activity for this wallet.</p>}
      </section>

      <p className="text-xs text-muted">
        Methodology: claimable amounts and share balances are live contract reads. Cost basis, realized P&amp;L and fees come from indexed
        Trade and Redeemed events using the average-cost method. Seeded creator shares are costed at the opening price. Sell value is a
        quote against the current pool and changes with every trade.
      </p>
    </div>
  );
}
