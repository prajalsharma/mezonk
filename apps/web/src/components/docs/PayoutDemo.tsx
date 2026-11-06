"use client";

import { useId, useState } from "react";

/*
 * Illustration of what a stake buys and pays at a chosen price. Integer maths only (cents and hundredths of a share,
 * matching the contract's whole-cent prices and 0.01-share lots). Fees are left out and the page says so; the real
 * ticket shows them, read live from the market's policy.
 */

const fmt = (cents: number) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${fmt(Math.abs(cents))}`;

export function PayoutDemo({ defaultPrice = 40, defaultStake = 10 }: { defaultPrice?: number; defaultStake?: number }) {
  const id = useId();
  const [yesPrice, setYesPrice] = useState(defaultPrice);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState(String(defaultStake));

  const price = side === "yes" ? yesPrice : 100 - yesPrice; // cents per share of the side you back
  const stakeCents = Math.max(0, Math.min(1_000_000_00, Math.round((Number.parseFloat(stake) || 0) * 100)));
  const shares = Math.floor((stakeCents * 100) / price); // hundredths of a share
  const cost = Math.round((shares * price) / 100); // cents actually spent (lots are whole)
  const win = shares; // 1 MUSD per share → cents equal hundredths
  const invalid = Math.floor(shares / 2);

  const outcomes = [
    { key: "yes", label: "Yes wins", pays: side === "yes" ? win : 0 },
    { key: "no", label: "No wins", pays: side === "no" ? win : 0 },
    { key: "invalid", label: "Ruled Invalid", pays: invalid },
  ] as const;

  return (
    <section className="demo not-prose" aria-labelledby={`${id}-h`}>
      <div className="demo-head">
        <h4 id={`${id}-h`} className="text-[0.9375rem] font-semibold text-[var(--ink)]">Try it: what a stake buys and pays</h4>
        <span className="text-xs text-[var(--muted)]">Example numbers you choose. Fees not included.</span>
      </div>
      <div className="demo-body space-y-5">
        <div>
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <label htmlFor={`${id}-p`} className="font-medium text-[var(--ink)]">Price of Yes</label>
            <span className="demo-num text-[var(--ink-2)]">
              Yes <strong className="text-[var(--yes-text)]">{yesPrice}¢</strong> · No <strong className="text-[var(--ink)]">{100 - yesPrice}¢</strong>
            </span>
          </div>
          <input
            id={`${id}-p`}
            type="range"
            min={1}
            max={99}
            value={yesPrice}
            onChange={(e) => setYesPrice(Number(e.target.value))}
            className="demo-range"
            aria-valuetext={`Yes ${yesPrice} cents, No ${100 - yesPrice} cents`}
          />
          <div className="demo-bar mt-2" aria-hidden>
            <span style={{ flexBasis: `${yesPrice}%`, background: "var(--yes)" }} />
            <span style={{ flexBasis: `${100 - yesPrice}%`, background: "var(--no)" }} />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            The crowd puts the chance of Yes at about {yesPrice}%. A Yes and a No always add up to 100¢: together they are one fully backed MUSD.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[var(--ink)]">You back</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1">
              {(["yes", "no"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  onClick={() => setSide(s)}
                  className="h-9 rounded-md text-sm font-semibold transition-colors"
                  style={
                    side === s
                      ? { background: s === "yes" ? "var(--yes)" : "var(--no)", color: s === "yes" ? "var(--on-yes)" : "var(--on-no)" }
                      : { color: "var(--ink-2)" }
                  }
                >
                  {s === "yes" ? `Yes at ${yesPrice}¢` : `No at ${100 - yesPrice}¢`}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-s`} className="mb-2 block text-sm font-medium text-[var(--ink)]">You spend (MUSD)</label>
            <input
              id={`${id}-s`}
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
              className="demo-num h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <p className="text-sm text-[var(--ink-2)]">
          That buys <strong className="demo-num text-[var(--ink)]">{fmt(shares)}</strong> {side === "yes" ? "Yes" : "No"} shares at {price}¢ for{" "}
          <strong className="demo-num text-[var(--ink)]">{fmt(cost)} MUSD</strong>.
        </p>

        <div className="grid gap-2 sm:grid-cols-3" role="list">
          {outcomes.map((o) => {
            const profit = o.pays - cost;
            const mine = o.key === side;
            return (
              <div key={o.key} role="listitem" className="demo-tile" data-on={mine}>
                <div className="text-xs text-[var(--muted)]">{o.label}</div>
                <div className="demo-num mt-1 text-lg font-semibold text-[var(--ink)]">{fmt(o.pays)} MUSD</div>
                <div className="demo-num text-xs" style={{ color: profit > 0 ? "var(--gain)" : profit < 0 ? "var(--loss)" : "var(--muted)" }}>
                  {signed(profit)} vs what you spent
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
