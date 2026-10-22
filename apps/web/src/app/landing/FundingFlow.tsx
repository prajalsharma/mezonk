import { ArrowUpRight, Bitcoin, CircleDollarSign, Trophy } from "lucide-react";
import { mezoBorrowUrl } from "@/lib/chain/config";

/**
 * How money gets in without selling BTC: borrow MUSD on Mezo, trade here, repay on Mezo.
 * A real three-step sequence, so the steps are numbered. The connector carries a small dot that travels
 * borrow → trade → payout to show the direction money moves (static under reduced motion).
 */
const STEPS = [
  {
    icon: Bitcoin,
    title: "Borrow MUSD on Mezo",
    body: "Lock BTC as collateral on Mezo and borrow MUSD, its bitcoin-backed dollar. Nothing gets sold.",
  },
  {
    icon: CircleDollarSign,
    title: "Buy Yes or No here",
    body: "Spend that MUSD on any market. A share costs 1¢ to 99¢ and pays 1 MUSD if you call it right.",
  },
  {
    icon: Trophy,
    title: "Collect, then repay",
    body: "Winnings arrive in MUSD. Pay back your Mezo loan whenever you like and your BTC unlocks.",
  },
];

export function FundingFlow() {
  return (
    <div className="panel overflow-hidden">
      <ol className="relative grid md:grid-cols-3">
        {/* connector with a travelling dot (desktop) */}
        <span aria-hidden className="absolute left-[16.6%] right-[16.6%] top-[3.75rem] hidden h-px bg-line md:block">
          <span className="flow-track absolute inset-0">
            <span className="absolute -left-[3px] -top-[3px] size-[7px] rounded-full bg-yes" />
          </span>
        </span>
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative space-y-4 border-line p-7 max-md:border-b max-md:last:border-b-0 md:px-8 md:py-9">
            <span className="relative z-10 flex size-12 items-center justify-center rounded-md border border-line bg-surface text-ink md:mx-auto">
              <s.icon className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="space-y-2 md:text-center">
              <h3 className="text-lg font-semibold">
                <span className="mono mr-2 text-sm text-muted">{i + 1}</span>
                {s.title}
              </h3>
              <p className="text-ink-2 md:mx-auto md:max-w-[19rem]">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-sunk px-7 py-5 md:px-8">
        <p className="max-w-2xl text-sm text-ink-2">
          Borrowing happens on Mezo, with Mezo&apos;s fees and liquidation rules. MEZONK never holds or lends your bitcoin.
        </p>
        <a
          href={mezoBorrowUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-yes-text hover:underline underline-offset-4"
        >
          Borrow MUSD on Mezo <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </div>
    </div>
  );
}
