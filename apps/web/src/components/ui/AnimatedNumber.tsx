"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tweens between numeric values without layout shift (tabular numerals, fixed formatting).
 * Honors prefers-reduced-motion by snapping.
 */
export function AnimatedNumber({ value, format, duration = 420, className }: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value || !Number.isFinite(from) || !Number.isFinite(value)) {
      setShown(value);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(from + (value - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={`tnum ${className ?? ""}`}>{format(shown)}</span>;
}
