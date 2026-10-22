"use client";

import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui/cx";
import { deployment } from "@/lib/chain/config";

/**
 * Optional pointers for MUSD a user isn't trading with. Every item was checked against Mezo's docs and apps on
 * 2026-10-22 (mainnet links). Shown only on /borrow, to people about to borrow MUSD.
 * MUSD can't be locked into veBTC/veMEZO (those lock BTC and MEZO), so that isn't offered. Everything here keeps MUSD on Mezo.
 */
const IDEAS: Array<{ title: string; body: string; href: string; cta: string }> = [
  {
    title: "Save it",
    body: "Deposit into Mezo's MUSD Savings Vault. It earns a variable rate from MUSD loan fees, with no lock-up.",
    href: "https://mezo.org/earn/vaults/0xb4D498029af77680cD1eF828b967f010d06C51CC",
    cta: "Savings Vault",
  },
  {
    title: "Swap or add liquidity",
    body: "Trade MUSD for BTC, USDC or USDT on Mezo Swap, or add it to a pool and earn a share of swap fees.",
    href: "https://mezo.org/explore/pools",
    cta: "Mezo Pools",
  },
  {
    title: "Pay down your loan",
    body: "Borrowed MUSD on Mezo? Paying some back lowers your debt and your liquidation risk. There's no fixed repayment date.",
    href: "https://mezo.org/feature/borrow",
    cta: "Your Mezo loan",
  },
];

export function MusdIdeas({
  dismissKey,
  className,
  title = "Borrowing more than you'll trade?",
}: {
  dismissKey?: string;
  className?: string;
  title?: string;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!dismissKey) return;
    try {
      if (localStorage.getItem(dismissKey) === "1") setHidden(true);
    } catch {
      /* storage unavailable: just show it */
    }
  }, [dismissKey]);
  if (hidden) return null;
  return (
    <section aria-labelledby="musd-ideas" className={cx("panel overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5 md:px-8">
        <div className="space-y-1">
          <h2 id="musd-ideas" className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="text-ink-2">
            Whatever you don&apos;t trade with can keep working on Mezo{deployment.chain.testnet ? " (these live on Mezo mainnet)" : ""}.
          </p>
        </div>
        {dismissKey && (
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem(dismissKey, "1");
              } catch {
                /* ignore */
              }
            }}
            aria-label="Hide these suggestions"
            className="press -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 lg:divide-x lg:divide-line">
        {IDEAS.map((i) => (
          <li key={i.title} className="flex flex-col gap-3 border-b border-line px-6 py-5 md:px-8 lg:border-b-0">
            <h3 className="font-semibold">{i.title}</h3>
            <p className="text-[0.9375rem] text-ink-2">{i.body}</p>
            <a
              href={i.href}
              target="_blank"
              rel="noreferrer"
              className="mt-auto inline-flex items-center gap-1 text-[0.9375rem] font-medium text-yes-text underline-offset-4 hover:underline"
            >
              {i.cta} <ArrowUpRight className="size-4" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
