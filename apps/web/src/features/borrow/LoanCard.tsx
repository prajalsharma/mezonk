"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { mezoBorrow, useMezoLoan } from "@/hooks/useMezoLoan";
import { formatMusd } from "@/lib/format";
import { DANGER_RATIO, WARN_RATIO, closeCost, liquidationPrice, maxRepay, ratioOf } from "@/lib/mezo/borrow";

const pct = (ratio: bigint) => `${(Number(ratio / 10n ** 14n) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
const usd = (wei: bigint) => `$${Math.round(Number(wei / 10n ** 16n) / 100).toLocaleString("en-US")}`;
const btc = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * The wallet's Mezo loan next to its bets. `ifWin` is the best case: every open position paid on its larger side,
 * plus what is claimable now. It's a projection, labelled as one; nothing here moves money.
 */
export function LoanCard({ ifWin, claimable }: { ifWin: bigint; claimable: bigint }) {
  const loan = useMezoLoan();
  const trove = loan.trove.data;
  const p = loan.params.data;
  if (!mezoBorrow || !trove?.active || !p) return null;

  const ratio = ratioOf(trove.coll, trove.debt, p.price);
  const tone = ratio >= WARN_RATIO ? "text-success" : ratio >= DANGER_RATIO ? "text-warn" : "text-danger";
  const bar = ratio >= WARN_RATIO ? "bg-success" : ratio >= DANGER_RATIO ? "bg-warn" : "bg-danger";
  const pos = Math.min(100, Math.max(0, ((Number(ratio / 10n ** 14n) / 100 - 100) / 200) * 100));
  const total = ifWin + claimable;
  const room = maxRepay(trove, p);
  const close = closeCost(trove, p);
  const repayable = total < room ? total : room;

  let projection: React.ReactNode = null;
  if (total > 0n) {
    projection =
      total >= close ? (
        <>If your open bets win, the <span className="mono text-ink">{formatMusd(total)}</span> MUSD they pay covers the whole loan: close it and unlock <span className="mono text-ink">{btc(trove.coll)}</span> BTC.</>
      ) : repayable > 0n ? (
        <>
          If your open bets win: debt goes from <span className="mono text-ink">{formatMusd(trove.debt)}</span> to{" "}
          <span className="mono text-ink">{formatMusd(trove.debt - repayable)}</span> MUSD, and the ratio to{" "}
          <span className="mono text-ink">{pct(ratioOf(trove.coll, trove.debt - repayable, p.price))}</span>.
        </>
      ) : (
        <>Your loan is at Mezo&apos;s minimum size, so winnings can only pay it off in full (needs {formatMusd(close)} MUSD).</>
      );
  }

  return (
    <section aria-labelledby="loan-h" className="panel space-y-4 p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="loan-h" className="text-xl font-semibold">Your Mezo loan</h2>
        <ButtonLink href="/borrow" variant="secondary" size="sm">Manage loan</ButtonLink>
      </div>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">BTC locked</dt>
          <dd className="tnum text-xl font-semibold">{btc(trove.coll)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">You owe</dt>
          <dd className="tnum text-xl font-semibold">{formatMusd(trove.debt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Ratio</dt>
          <dd className={cx("tnum text-xl font-semibold", tone)}>{pct(ratio)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Liquidated if BTC falls to</dt>
          <dd className="tnum text-xl font-semibold">{usd(liquidationPrice(trove.coll, trove.debt, p.mcr))}</dd>
        </div>
      </dl>
      <div className="relative h-1.5 rounded-full bg-surface-2" aria-hidden>
        <div className={cx("absolute inset-y-0 left-0 rounded-full", bar)} style={{ width: `${pos}%` }} />
        <span className="absolute -top-1 h-3.5 w-px bg-danger" style={{ left: "5%" }} />
      </div>
      {p.recoveryMode && <p className="text-sm text-warn">Mezo is in recovery mode: you can repay or add BTC, but not borrow more or take BTC out.</p>}
      {projection && <p className="text-sm text-ink-2">{projection} <span className="text-muted">Best case; losing bets pay nothing.</span></p>}
      {claimable > 0n && repayable > 0n && (
        <p className="text-sm text-ink-2">Tick &ldquo;Use winnings to repay my Mezo loan&rdquo; when you claim below. <Link className="underline" href="/borrow">Or repay any amount now</Link>.</p>
      )}
    </section>
  );
}
