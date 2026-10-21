"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { formatProb, marketSignal } from "@/lib/format";

/**
 * YES/NO split bar in the brand's split-coin language: the red (YES) half sits a touch lower,
 * the ink (NO) half a touch higher, and the slip between them marks the implied probability.
 * Text labels always accompany the bar, so the state never relies on colour.
 */
export function ProbabilityBar({ priceYes, size = "md", className }: { priceYes: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const pct = Math.min(100, Math.max(0, priceYes * 100));
  const h = size === "lg" ? 10 : size === "sm" ? 6 : 8;
  const slip = size === "lg" ? 3 : size === "sm" ? 1.5 : 2;
  return (
    <div
      className={cx("relative w-full", className)}
      style={{ height: h + slip * 2 }}
      role="img"
      aria-label={`Yes ${formatProb(priceYes)}, No ${formatProb(1 - priceYes)}`}
    >
      <div
        className="absolute left-0 rounded-full bg-yes transition-[width] duration-500 ease-[var(--ease-out-expo)]"
        style={{ top: slip * 2, height: h, width: `calc(${pct}% - 1px)` }}
      />
      <div
        className="absolute right-0 rounded-full bg-no transition-[width] duration-500 ease-[var(--ease-out-expo)]"
        style={{ top: 0, height: h, width: `calc(${100 - pct}% - 1px)` }}
      />
    </div>
  );
}

export function OddsLabels({ priceYes, className }: { priceYes: number; className?: string }) {
  return (
    <div className={cx("tnum flex justify-between text-sm font-semibold", className)}>
      <span className="text-yes-text">Yes {formatProb(priceYes)}</span>
      <span className="text-no-text">No {formatProb(1 - priceYes)}</span>
    </div>
  );
}

/** 24h movement in percentage points. Direction is shown by arrow and text, colour is secondary. */
export function Change({ from, to }: { from: number; to: number }) {
  const d = (to - from) * 100;
  if (Math.abs(d) < 0.5) return <span className="tnum text-muted">0 pts</span>;
  return (
    <span className={cx("tnum", d > 0 ? "text-gain" : "text-loss")}>
      <span aria-hidden>{d > 0 ? "▲" : "▼"}</span>
      <span className="sr-only">{d > 0 ? "up" : "down"}</span> {Math.abs(Math.round(d))} pts
    </span>
  );
}

/**
 * Probability that tweens between values and briefly flashes toward the side that gained,
 * so a verified update is noticeable without flashing odds continuously.
 */
export function LiveProbability({ value, precise = false, className }: { value: number; precise?: boolean; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<"yes" | "no" | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(to);
      return;
    }
    setFlash(to > from ? "yes" : "no");
    const t0 = performance.now();
    const dur = 480;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const f = setTimeout(() => setFlash(null), 900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(f);
    };
  }, [value]);
  return (
    <span
      className={cx("tnum inline-block rounded px-0.5 -mx-0.5", flash === "yes" && "animate-[flash-yes_900ms_ease-out]", flash === "no" && "animate-[flash-no_900ms_ease-out]", className)}
    >
      {formatProb(shown, precise)}
    </span>
  );
}

/** "What the market thinks", labelled by where the number comes from (trade, book midpoint, or nothing). */
export function SignalValue({ m, className }: { m: { priceYes: number | null; bestBid: number | null; bestAsk: number | null }; className?: string }) {
  const s = marketSignal(m);
  if (s.kind === "none") return <span className={cx("text-muted", className)} title="No trades and no two-sided book yet">—</span>;
  return (
    <span className={cx(s.kind === "indicative" && "text-ink-2", className)} title={s.kind === "trade" ? "Last trade" : "Book midpoint (indicative, not a trade)"}>
      {s.kind === "indicative" ? "~" : ""}
      {formatProb(s.p)}
    </span>
  );
}
