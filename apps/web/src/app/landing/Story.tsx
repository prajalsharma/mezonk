"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";

/**
 * "From question to payout": the steps scroll on the right while one illustrated market on the left changes state.
 * Text is always visible; only the illustration responds to scroll. On phones each step carries its own picture.
 */
const STEPS = [
  {
    title: "Backers fund both sides",
    body: "A reviewed market opens for seeding. Backers lock real offers on Yes and No. If both sides aren't funded by the deadline, everyone gets their deposit back.",
  },
  {
    title: "Anyone can trade",
    body: "Once both sides are funded the market goes live. Buy Yes or No from other people's offers, sell any time before close. MEZONK never takes a side.",
  },
  {
    title: "The outcome is checked in public",
    body: "After close, the resolver proposes Yes, No or Invalid with evidence and a bond. Anyone can challenge it during the window; an arbitrator rules.",
  },
  {
    title: "Winners are paid in full",
    body: "Each winning share redeems for exactly 1 MUSD, straight from the contract. If a market is ruled Invalid, every share pays 0.50.",
  },
];

const QUESTION = "Will BTC close above $150,000 on 31 December?";

function Bar({ label, value, active, tone }: { label: string; value: number; active: boolean; tone: "yes" | "no" }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="mono text-ink">{active ? value : 0}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx("h-full rounded-full transition-[width] duration-[1400ms] ease-[var(--ease-out-expo)]", tone === "yes" ? "bg-yes" : "bg-no")}
          style={{ width: active ? `${value}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "yes" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-sm font-medium",
        tone === "yes" ? "bg-yes-soft text-yes-text" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

export function StoryVisual({ step, active = true }: { step: number; active?: boolean }) {
  const on = (i: number) => active && step === i;
  return (
    <div className="panel relative overflow-hidden p-6 shadow-2 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <p className="max-w-xs text-lg font-medium leading-snug">{QUESTION}</p>
        <span className="shrink-0 text-xs text-muted">Illustration</span>
      </div>
      <div className="relative min-h-[12.5rem]">
        {/* 1. Seeding */}
        <div className={cx("story-layer space-y-5", step === 0 ? "is-on" : "")} aria-hidden={step !== 0}>
          <Chip tone="warn">Seeding · not trading yet</Chip>
          <Bar label="Yes side funded" value={100} active={on(0)} tone="yes" />
          <Bar label="No side funded" value={84} active={on(0)} tone="no" />
          <p className="text-sm text-ink-2">
            <span className="mono text-ink">4</span> backers · goes live when both sides are funded, refunds if not.
          </p>
        </div>
        {/* 2. Live */}
        <div className={cx("story-layer space-y-5", step === 1 ? "is-on" : "")} aria-hidden={step !== 1}>
          <div className="flex items-baseline gap-2">
            <span className="mono text-5xl font-medium tracking-tight">41%</span>
            <span className="text-lg font-semibold text-yes-text">Yes</span>
          </div>
          <svg viewBox="0 0 300 70" className="h-20 w-full" aria-hidden>
            <path d="M0 55H40V48H85V58H130V40H175V44H215V30H255V36H300" fill="none" stroke="var(--border)" strokeWidth="2" />
            <path
              key={on(1) ? "on" : "off"}
              d="M0 55H40V48H85V58H130V40H175V44H215V30H255V36H300"
              fill="none"
              stroke="var(--yes)"
              strokeWidth="2.5"
              pathLength={1}
              className={on(1) ? "draw" : "opacity-0"}
              style={{ "--len": 1, "--draw-dur": "1600ms", "--draw-delay": "100ms" } as React.CSSProperties}
            />
          </svg>
          <div className="grid grid-cols-2 gap-2">
            <span className="flex h-12 items-center justify-between rounded-md bg-yes px-4 font-semibold text-on-yes">
              Buy Yes <span className="mono">42¢</span>
            </span>
            <span className="flex h-12 items-center justify-between rounded-md bg-no px-4 font-semibold text-on-no">
              Buy No <span className="mono">60¢</span>
            </span>
          </div>
        </div>
        {/* 3. Resolving */}
        <div className={cx("story-layer space-y-5", step === 2 ? "is-on" : "")} aria-hidden={step !== 2}>
          <div className="flex flex-wrap gap-2">
            <Chip>Trading closed</Chip>
            <Chip tone="yes">Proposed: Yes</Chip>
          </div>
          <div className="space-y-1 rounded-md border border-line p-4">
            <p className="text-sm text-muted">Evidence</p>
            <p className="font-medium">Coinbase BTC-USD daily close, 31 Dec</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-ink-2">Challenge window</span>
              <span className="mono text-ink">48h</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-line-strong transition-[width] duration-[2200ms] ease-[var(--ease-out-quart)]"
                style={{ width: on(2) ? "100%" : "0%" }}
              />
            </div>
            <p className="text-sm text-muted">Anyone can challenge with a bond. Nobody did.</p>
          </div>
        </div>
        {/* 4. Paid */}
        <div className={cx("story-layer space-y-5", step === 3 ? "is-on" : "")} aria-hidden={step !== 3}>
          <span className="flex h-12 items-center rounded-md bg-yes px-4 text-lg font-semibold text-on-yes">Resolved Yes</span>
          <div>
            <p className="text-sm text-muted">Your 100 Yes shares redeem for</p>
            <p className="mono text-6xl font-medium tracking-tight">
              <AnimatedNumber value={on(3) ? 100 : 0} format={(n) => n.toFixed(2)} duration={1200} />
            </p>
            <p className="mt-1 text-sm text-muted">MUSD · paid by the contract, not by MEZONK</p>
          </div>
        </div>
      </div>
      <ol className="mt-5 flex gap-1.5" aria-hidden>
        {STEPS.map((_, i) => (
          <li key={i} className={cx("h-1 flex-1 rounded-full transition-colors duration-500", i <= step ? "bg-yes" : "bg-surface-2")} />
        ))}
      </ol>
    </div>
  );
}

/** Phones: one card per stage in a swipeable row; the visible card plays its animation, dots show where you are. */
function MobileStory() {
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLOListElement>(null);
  const slides = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { root, threshold: 0.6 },
    );
    for (const s of slides.current) if (s) io.observe(s);
    return () => io.disconnect();
  }, []);
  const go = (i: number) => slides.current[i]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  return (
    <div className="space-y-5 lg:hidden">
      <ol
        ref={scroller}
        aria-label="Four stages of a market"
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] md:-mx-6 md:px-6"
      >
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            data-step={i}
            ref={(el) => {
              slides.current[i] = el;
            }}
            className="w-[86%] shrink-0 snap-center space-y-4 sm:w-[70%]"
          >
            <div className="space-y-2">
              <h3 className="flex items-baseline gap-2.5 text-2xl font-semibold tracking-tight">
                <span className="mono text-base text-yes-text">{i + 1}</span>
                {s.title}
              </h3>
              <p className="text-ink-2">{s.body}</p>
            </div>
            <StoryVisual step={i} active={active === i} />
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-center gap-2" role="tablist" aria-label="Choose a stage">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-label={`Stage ${i + 1}: ${s.title}`}
            onClick={() => go(i)}
            className="flex h-11 items-center px-1"
          >
            <span className={cx("block h-1.5 rounded-full transition-all duration-300", active === i ? "w-8 bg-yes" : "w-3 bg-line-strong")} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Story() {
  const [step, setStep] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const r of refs.current) if (r) io.observe(r);
    return () => io.disconnect();
  }, []);
  return (
    <>
    <MobileStory />
    <div className="hidden gap-20 lg:grid lg:grid-cols-2">
      <div className="hidden lg:block">
        <div className="sticky top-32">
          <StoryVisual step={step} />
        </div>
      </div>
      <ol>
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            data-step={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="flex min-h-[42vh] flex-col justify-center"
          >
            <div className="space-y-3">
              <span
                className={cx(
                  "mono inline-flex size-9 items-center justify-center rounded-full border text-sm transition-colors duration-500",
                  step === i ? "border-yes bg-yes text-on-yes" : "border-line text-ink-2",
                )}
              >
                {i + 1}
              </span>
              <h3 className={cx("display text-4xl transition-colors duration-500", step === i ? "text-ink" : "text-muted")}>{s.title}</h3>
              <p className="max-w-md text-lg text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
    </>
  );
}
