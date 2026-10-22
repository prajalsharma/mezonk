"use client";

import { ArrowRight, ArrowUpRight, Check, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { cx } from "@/components/ui/cx";
import { mezoBorrowUrl } from "@/lib/chain/config";

/**
 * Two ways in. Holding BTC: borrow MUSD on Mezo, trade, collect, repay, BTC unlocks. Holding MUSD: trade now.
 * The BTC path plays out step by step when it scrolls into view. Only numbers MEZONK's own contracts fix are shown
 * (1,000 MUSD on Yes at 40¢ buys 2,475 shares; each pays 1 MUSD). How much MUSD a given amount of BTC can back depends
 * on the BTC price and Mezo's collateral rules at the time, so no BTC-to-MUSD figure is printed here.
 */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  // Visible by default (server render, no JS, crawlers). Only once the script runs and the block is still below the
  // fold does it hide and wait to play.
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.8) return;
    setSeen(false);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setSeen(true), io.disconnect()), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

function Step({ n, title, body, on, children }: { n: number; title: string; body: string; on: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cx(
        "flex flex-col gap-5 p-6 transition-[opacity,transform] duration-700 ease-[var(--ease-out-expo)] md:p-8",
        on ? "opacity-100" : "translate-y-3 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
      )}
      style={{ transitionDelay: on ? `${(n - 1) * 260}ms` : "0ms" }}
    >
      <div className="space-y-2">
        <h3 className="flex items-baseline gap-2.5 text-xl font-semibold tracking-tight">
          <span className="mono text-base text-yes-text">{n}</span>
          {title}
        </h3>
        <p className="text-ink-2">{body}</p>
      </div>
      <div className="mt-auto rounded-md border border-line bg-sunk p-4">{children}</div>
    </li>
  );
}

export function FundingFlow() {
  const [ref, on] = useInView<HTMLDivElement>();
  return (
    <div className="space-y-4">
      <div ref={ref} className="panel overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4 md:px-8">
          <p className="font-semibold">You hold BTC</p>
          <p className="text-sm text-muted">Example trade</p>
        </div>
        <ol className="grid divide-line max-md:divide-y md:grid-cols-3 md:divide-x">
          <Step
            n={1}
            on={on}
            title="Borrow MUSD on Mezo"
            body="Lock BTC as collateral and borrow MUSD, Mezo's bitcoin-backed dollar. How much you can borrow depends on the BTC price and Mezo's limits."
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-ink-2">
                <Lock className="size-4 text-ink" aria-hidden /> Your BTC
              </span>
              <span className="font-medium">Locked, not sold</span>
            </div>
            <div className="my-3 h-px bg-line" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-2">You receive</span>
              <span className="font-medium">MUSD to trade with</span>
            </div>
          </Step>
          <Step n={2} on={on} title="Buy Yes or No here" body="Say you put 1,000 MUSD on Yes at 40¢. A share costs 1¢ to 99¢ and pays 1 MUSD if you're right.">
            <div className="flex h-11 items-center justify-between rounded-sm bg-yes px-3.5 font-semibold text-on-yes">
              <span>Buy Yes</span>
              <span className="mono">40¢</span>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-2">1,000 MUSD buys, at a 1% fee</span>
              <span className="mono text-2xl font-medium">
                <AnimatedNumber value={on ? 2475 : 0} format={(v) => Math.round(v).toLocaleString("en-US")} duration={1100} />
                <span className="ml-1 text-sm text-muted">Yes</span>
              </span>
            </div>
          </Step>
          <Step n={3} on={on} title="Collect, then repay" body="If Yes wins you're paid in MUSD. Repay the loan on Mezo when you choose, and your BTC unlocks.">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-2">Yes wins, you get</span>
              <span className="mono text-2xl font-medium text-yes-text">
                +<AnimatedNumber value={on ? 2475 : 0} format={(v) => Math.round(v).toLocaleString("en-US")} duration={1300} />
              </span>
            </div>
            <div className="my-3 h-px bg-line" />
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Check className="size-4 shrink-0 text-yes-text" aria-hidden /> Repay what you borrowed plus interest, your BTC unlocks
            </p>
          </Step>
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-4 md:px-8">
          <p className="max-w-2xl text-sm text-muted">
            Loans live on Mezo, with Mezo&apos;s fees, interest and liquidation rules. MEZONK never holds or lends your bitcoin.
          </p>
          <a
            href={mezoBorrowUrl()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-yes-text underline-offset-4 hover:underline"
          >
            Borrow on Mezo <ArrowUpRight className="size-4" aria-hidden />
          </a>
        </div>
      </div>

      <Link
        href="/markets"
        className="panel group flex flex-wrap items-center justify-between gap-4 px-6 py-5 transition-colors hover:border-line-strong md:px-8"
      >
        <span>
          <span className="font-semibold">Already hold MUSD?</span>{" "}
          <span className="text-ink-2">Skip the loan and go straight to the markets.</span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium text-yes-text">
          Browse markets <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>
    </div>
  );
}
