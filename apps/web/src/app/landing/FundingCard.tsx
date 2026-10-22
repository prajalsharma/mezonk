"use client";

import { ArrowRight, Bitcoin, CircleDollarSign, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

/**
 * How you pay for a trade, as one card. Two tabs: holding BTC (borrow MUSD on Mezo, trade, repay) or holding MUSD
 * (just trade). In the BTC tab a highlight walks the three steps while the card is on screen, and stops for good the
 * moment someone points at or picks a step. Server-rendered with the BTC tab open and every step readable.
 */
const STEPS = [
  { icon: Bitcoin, title: "Your BTC", sub: "locked on Mezo", say: "Lock BTC on Mezo as collateral. It's locked, not sold, and it's still yours." },
  { icon: CircleDollarSign, title: "MUSD", sub: "borrowed against it", say: "Borrow MUSD against it, from Mezo's own contracts. Fees and limits are shown before you sign." },
  { icon: Target, title: "Yes or No", sub: "your call, here", say: "Back Yes or No with that MUSD. Right call: each share pays 1 MUSD. Repay the loan and your BTC unlocks." },
] as const;

type Tab = "btc" | "musd";

export function FundingCard() {
  const [tab, setTab] = useState<Tab>("btc");
  const [dir, setDir] = useState<"left" | "right" | null>(null);
  const [step, setStep] = useState(0);
  const auto = useRef(true);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab !== "btc" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting), { threshold: 0.4 });
    if (card.current) io.observe(card.current);
    const id = window.setInterval(() => {
      if (auto.current && visible && !document.hidden) setStep((s) => (s + 1) % STEPS.length);
    }, 2400);
    return () => {
      window.clearInterval(id);
      io.disconnect();
    };
  }, [tab]);

  const pick = (t: Tab) => {
    if (t === tab) return;
    setDir(t === "musd" ? "right" : "left");
    setTab(t);
  };
  const choose = (i: number) => {
    auto.current = false;
    setStep(i);
  };

  return (
    <div ref={card} className="float mx-auto max-w-[56rem] overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-line px-6 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <p className="text-lg font-semibold tracking-tight">What are you holding?</p>
        <div role="tablist" aria-label="What are you holding" className="relative grid grid-cols-2 rounded-md border border-line bg-sunk p-1">
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-sm bg-surface shadow-1 ring-1 ring-line transition-transform duration-[220ms] ease-[var(--ease-out-expo)]"
            style={{ transform: tab === "musd" ? "translateX(100%)" : "none" }}
          />
          {(["btc", "musd"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`fund-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="fund-panel"
              onClick={() => pick(t)}
              className={cx("relative h-9 px-5 text-sm font-medium transition-colors", tab === t ? "text-ink" : "text-muted hover:text-ink")}
            >
              {t === "btc" ? "BTC" : "MUSD"}
            </button>
          ))}
        </div>
      </div>

      <div id="fund-panel" role="tabpanel" aria-labelledby={`fund-tab-${tab}`} className="px-6 py-8 md:px-8 md:py-10">
        {tab === "btc" ? (
          <div key="btc" className={cx("space-y-8", dir === "left" && "enter-left")}>
            <ol className="relative grid grid-cols-3 gap-2" onPointerEnter={() => (auto.current = false)}>
              {/* The seam joining the steps; the lit part grows to the active step. */}
              <span aria-hidden className="absolute left-[16.66%] right-[16.66%] top-7 h-0.5 rounded-full bg-line" />
              <span
                aria-hidden
                className="absolute left-[16.66%] top-7 h-0.5 rounded-full bg-yes transition-[width] duration-700 ease-[var(--ease-out-expo)]"
                style={{ width: `${(step / (STEPS.length - 1)) * 66.66}%` }}
              />
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const on = i <= step;
                return (
                  <li key={s.title} className="relative">
                    <button
                      type="button"
                      onClick={() => choose(i)}
                      aria-current={i === step ? "step" : undefined}
                      className="group flex w-full flex-col items-center gap-3 text-center"
                    >
                      <span
                        className={cx(
                          "flex size-14 items-center justify-center rounded-full border-2 transition-[border-color,background-color,color,transform] duration-300 ease-[var(--ease-out-expo)]",
                          i === step
                            ? "scale-110 border-yes bg-yes text-on-yes"
                            : on
                              ? "border-yes bg-surface text-yes-text"
                              : "border-line bg-surface text-muted group-hover:border-line-strong",
                        )}
                      >
                        <Icon className="size-6" strokeWidth={1.75} aria-hidden />
                      </span>
                      <span>
                        <span className="block font-semibold">{s.title}</span>
                        <span className="block text-sm text-ink-2">{s.sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p aria-live="polite" className="mx-auto min-h-[3.5rem] max-w-xl text-center text-lg text-ink-2">
              {STEPS[step]!.say}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/borrow" size="lg">
                Borrow MUSD <ArrowRight className="size-4" />
              </ButtonLink>
            </div>
          </div>
        ) : (
          <div key="musd" className={cx("flex flex-col items-center gap-6 py-6 text-center", dir === "right" && "enter-right")}>
            <p className="max-w-md text-2xl font-semibold tracking-tight">Skip the loan. Trade with the MUSD you have.</p>
            <ButtonLink href="/markets" size="lg">
              Browse markets <ArrowRight className="size-4" />
            </ButtonLink>
          </div>
        )}
      </div>

      <p className="border-t border-line px-6 py-4 text-sm text-muted md:px-8">
        Loans are Mezo&apos;s, with Mezo&apos;s fees, interest and liquidation rules. MEZONK never holds your bitcoin. Already have
        MUSD? Go straight to the markets.
      </p>
    </div>
  );
}
