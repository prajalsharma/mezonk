"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero object: 1 MUSD as a square, cut by the Seam into a Yes half and a No half.
 * The seam moves between illustrative prices; the two halves always add up to 100¢.
 * Labelled as an illustration on the page. It never shows a real market's price.
 */
const STATES = [62, 38, 55, 71, 47];
const S = 400;
const GAP = 10;
const X1 = 120;
const X2 = 285;
const D = 26;

const ease = (t: number) => 1 - Math.pow(2, -10 * t);

function paths(p: number) {
  const c = Math.min(330, Math.max(70, S * (1 - p / 100)));
  const l = c + D * 0.45;
  const m = c - D;
  const no = `M0 0H${S}V${c}H${X2}V${m}H${X1}V${l}H0Z`;
  const yes = `M0 ${S}H${S}V${c + GAP}H${X2 - GAP}V${m + GAP}H${X1 + GAP}V${l + GAP}H0Z`;
  return { no, yes };
}

export function SeamSplit() {
  const [p, setP] = useState(STATES[0]!);
  const shown = useRef(STATES[0]!);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    if (box.current) io.observe(box.current);
    const tween = (to: number) => {
      const from = shown.current;
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 1100);
        const v = from + (to - from) * ease(k);
        shown.current = v;
        setP(v);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const id = window.setInterval(() => {
      if (!visible || document.hidden) return;
      i = (i + 1) % STATES.length;
      tween(STATES[i]!);
    }, 3200);
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  const { no, yes } = paths(p);
  const yesC = Math.round(p);
  return (
    <figure ref={box} className="relative mx-auto w-full max-w-[30rem]">
      <div className="relative aspect-square">
        <svg viewBox={`0 0 ${S} ${S}`} className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path d={no} fill="var(--no)" />
          <path d={yes} fill="var(--yes)" />
        </svg>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 text-on-no md:p-7">
          <span className="text-lg font-semibold">No</span>
          <span className="mono text-4xl font-medium tabular-nums md:text-5xl">{100 - yesC}¢</span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-5 text-on-yes md:p-7">
          <span className="text-lg font-semibold">Yes</span>
          <span className="mono text-4xl font-medium tabular-nums md:text-5xl">{yesC}¢</span>
        </div>
      </div>
      <figcaption className="mt-4 flex items-baseline justify-between gap-4 text-sm text-muted">
        <span>Illustration. One MUSD splits into one Yes and one No; the seam sits where traders agree.</span>
        <span className="mono shrink-0 text-ink">= 1 MUSD</span>
      </figcaption>
      <p className="sr-only">Yes and No prices always add up to 1 MUSD. If Yes trades at 62¢, No is worth 38¢.</p>
    </figure>
  );
}
