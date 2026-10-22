"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The hero object: 1 MUSD as a square, cut by the Seam into No (top) and Yes (bottom).
 * Until someone touches it, the seam drifts slowly between example prices. Drag it (or use the arrow keys) and it
 * follows you; the two prices always add up to 100¢. Updates go straight to the SVG, not through React state,
 * so the motion stays smooth. Labelled as an example on the page; it never shows a real market's price.
 */
const S = 400;
const GAP = 10;
const X1 = 120;
const X2 = 285;
const D = 24;
// Clamped so both halves always have room for their label at every size.
const MIN = 25;
const MAX = 75;
const DRIFT = [62, 48, 57, 68, 44, 55];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function seam(p: number) {
  const c = S * (1 - p / 100);
  const l = c + D * 0.45;
  const m = c - D;
  return {
    no: `M0 0H${S}V${c}H${X2}V${m}H${X1}V${l}H0Z`,
    yes: `M0 ${S}H${S}V${c + GAP}H${X2 - GAP}V${m + GAP}H${X1 + GAP}V${l + GAP}H0Z`,
  };
}

// Server-rendered first frame, so the square is there before JavaScript loads.
const INITIAL = seam(DRIFT[0]!);

export function SeamSplit() {
  const box = useRef<HTMLDivElement>(null);
  const noPath = useRef<SVGPathElement>(null);
  const yesPath = useRef<SVGPathElement>(null);
  const noLabel = useRef<HTMLSpanElement>(null);
  const yesLabel = useRef<HTMLSpanElement>(null);
  const p = useRef(DRIFT[0]!);
  const touched = useRef(false);
  const raf = useRef(0);
  const tapStart = useRef<{ y: number; t: number } | null>(null);

  const paint = useCallback((v: number) => {
    p.current = v;
    const { no, yes } = seam(v);
    noPath.current?.setAttribute("d", no);
    yesPath.current?.setAttribute("d", yes);
    const y = Math.round(v);
    if (yesLabel.current) yesLabel.current.textContent = `${y}¢`;
    if (noLabel.current) noLabel.current.textContent = `${100 - y}¢`;
    box.current?.setAttribute("aria-valuenow", String(y));
    box.current?.setAttribute("aria-valuetext", `Yes ${y} cents, No ${100 - y} cents`);
  }, []);

  const glide = useCallback(
    (to: number, ms: number) => {
      cancelAnimationFrame(raf.current);
      const from = p.current;
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        paint(from + (to - from) * easeInOut(k));
        if (k < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [paint],
  );

  // Slow drift until the visitor takes over: 2.6s glide, then a long rest.
  useEffect(() => {
    paint(p.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    if (box.current) io.observe(box.current);
    const id = window.setInterval(() => {
      if (touched.current || !visible || document.hidden) return;
      i = (i + 1) % DRIFT.length;
      glide(DRIFT[i]!, 2600);
    }, 5200);
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(raf.current);
      io.disconnect();
    };
  }, [glide, paint]);

  const fromPointer = (clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const v = 100 * (1 - (clientY - r.top) / r.height);
    return Math.min(MAX, Math.max(MIN, v));
  };

  return (
    <figure className="mx-auto w-full max-w-[30rem]">
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label="Example price split between Yes and No"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={DRIFT[0]}
        // touch-action pan-y: on phones the page keeps scrolling through the square; a tap (not a swipe) moves the line.
        className="group relative aspect-square select-none rounded-sm outline-offset-4 [touch-action:pan-y] md:cursor-ns-resize"
        onPointerDown={(e) => {
          if (e.pointerType === "touch") {
            tapStart.current = { y: e.clientY, t: performance.now() };
            return;
          }
          touched.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          glide(fromPointer(e.clientY), 260);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch" || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          cancelAnimationFrame(raf.current);
          paint(fromPointer(e.clientY));
        }}
        onPointerUp={(e) => {
          const t = tapStart.current;
          tapStart.current = null;
          if (e.pointerType !== "touch" || !t) return;
          if (Math.abs(e.clientY - t.y) > 8 || performance.now() - t.t > 500) return; // that was a scroll, not a tap
          touched.current = true;
          glide(fromPointer(e.clientY), 420);
        }}
        onPointerCancel={() => (tapStart.current = null)}
        onKeyDown={(e) => {
          const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          touched.current = true;
          glide(Math.min(MAX, Math.max(MIN, Math.round(p.current) + d * (e.shiftKey ? 10 : 1))), 180);
        }}
      >
        <svg viewBox={`0 0 ${S} ${S}`} className="absolute inset-0 size-full" aria-hidden>
          <path ref={noPath} d={INITIAL.no} fill="var(--no)" />
          <path ref={yesPath} d={INITIAL.yes} fill="var(--yes)" />
        </svg>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 text-on-no md:p-7">
          <span className="text-lg font-semibold">No</span>
          <span ref={noLabel} className="mono text-4xl font-medium tabular-nums md:text-5xl">{100 - DRIFT[0]!}¢</span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-5 text-on-yes md:p-7">
          <span className="text-lg font-semibold">Yes</span>
          <span ref={yesLabel} className="mono text-4xl font-medium tabular-nums md:text-5xl">{DRIFT[0]}¢</span>
        </div>
      </div>
      <figcaption className="mt-4 text-[0.9375rem] text-ink-2">
        <span className="hidden md:inline">Drag the line.</span>
        <span className="md:hidden">Tap the square to move the line.</span> However you split it, a Yes and a No add up to exactly
        1 MUSD.
      </figcaption>
    </figure>
  );
}
