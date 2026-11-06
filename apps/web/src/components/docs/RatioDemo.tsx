"use client";

import Link from "next/link";
import { useId, useState } from "react";

/*
 * A loan's collateral ratio (BTC value ÷ debt) against Mezo's lines: 110% minimum (below it the loan can be
 * liquidated), 150% where the app warns, 200% the app's suggestion. No BTC price is assumed: the "can fall" figure is
 * the drop in BTC's price that takes this ratio to 110%, which only depends on the ratio.
 */

const MIN = 110;
const WARN = 150;
const SUGGESTED = 200;
const LO = 100;
const HI = 300;
const pos = (r: number) => ((r - LO) / (HI - LO)) * 100;

export function RatioDemo({ defaultRatio = 200 }: { defaultRatio?: number }) {
  const id = useId();
  const [ratio, setRatio] = useState(defaultRatio);
  const drop = ratio > MIN ? Math.floor((1 - MIN / ratio) * 1000) / 10 : 0;
  const zone =
    ratio < MIN
      ? { label: "Below Mezo's minimum: can be liquidated", color: "var(--danger)" }
      : ratio < WARN
        ? { label: "Risky: a modest dip could reach 110%", color: "var(--warn)" }
        : ratio < SUGGESTED
          ? { label: "OK, with less room than suggested", color: "var(--ink-2)" }
          : { label: "Comfortable: at or above the suggested 200%", color: "var(--success)" };

  return (
    <section className="demo not-prose" aria-labelledby={`${id}-h`}>
      <div className="demo-head">
        <h4 id={`${id}-h`} className="text-[0.9375rem] font-semibold text-[var(--ink)]">Try it: how safe is a loan at this ratio?</h4>
        <span className="text-xs text-[var(--muted)]">Ratio = your BTC&apos;s value ÷ what you owe</span>
      </div>
      <div className="demo-body space-y-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${id}-r`} className="text-sm font-medium text-[var(--ink)]">Collateral ratio</label>
          <span className="demo-num text-2xl font-semibold text-[var(--ink)]">{ratio}%</span>
        </div>
        <div className="relative pt-1">
          <div className="relative h-3 overflow-hidden rounded-full" aria-hidden>
            <span className="absolute inset-y-0 left-0" style={{ width: `${pos(MIN)}%`, background: "var(--danger)", opacity: 0.85 }} />
            <span className="absolute inset-y-0" style={{ left: `${pos(MIN)}%`, width: `${pos(WARN) - pos(MIN)}%`, background: "var(--warn)", opacity: 0.75 }} />
            <span className="absolute inset-y-0" style={{ left: `${pos(WARN)}%`, width: `${pos(SUGGESTED) - pos(WARN)}%`, background: "var(--border-strong)", opacity: 0.6 }} />
            <span className="absolute inset-y-0 right-0" style={{ left: `${pos(SUGGESTED)}%`, background: "var(--success)", opacity: 0.75 }} />
          </div>
          <span
            aria-hidden
            className="absolute top-0 h-5 w-1 -translate-x-1/2 rounded-full bg-[var(--ink)] shadow transition-[left] duration-300"
            style={{ left: `${pos(Math.min(HI, Math.max(LO, ratio)))}%` }}
          />
          <div className="demo-num relative mt-1.5 h-4 text-[11px] text-[var(--muted)]" aria-hidden>
            {[MIN, WARN, SUGGESTED].map((m) => (
              <span key={m} className="absolute -translate-x-1/2" style={{ left: `${pos(m)}%` }}>{m}%</span>
            ))}
          </div>
        </div>
        <input
          id={`${id}-r`}
          type="range"
          min={LO + 5}
          max={HI}
          step={5}
          value={ratio}
          onChange={(e) => setRatio(Number(e.target.value))}
          className="demo-range"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="demo-tile">
            <div className="text-xs text-[var(--muted)]">Status</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: zone.color }}>{zone.label}</div>
          </div>
          <div className="demo-tile">
            <div className="text-xs text-[var(--muted)]">BTC can fall this much before 110%</div>
            <div className="demo-num mt-1 text-lg font-semibold text-[var(--ink)]">{ratio > MIN ? `${drop}%` : "None"}</div>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">
          Interest slowly adds to what you owe, which lowers the ratio over time. In recovery mode (when all of Mezo&apos;s loans together drop
          below 150%), Mezo blocks some actions; see <Link className="underline" href="/docs/mezo/manage-your-loan">Manage your loan</Link>.
        </p>
      </div>
    </section>
  );
}
