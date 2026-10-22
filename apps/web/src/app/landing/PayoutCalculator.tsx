"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { cx } from "@/components/ui/cx";
import { formatMusd, formatShares } from "@/lib/format";
import { cost, feeOf, sharesForBudget } from "@/lib/orderbook/math";
import { SeamSplit } from "./SeamSplit";

const FEE_BPS = 100; // illustration uses a 1% taker fee; each market shows its own on the ticket
const START_YES = 62; // matches the seam's first frame

/**
 * Try a trade: the seam square is the price input (drag the line), the card beside it shows exactly what you'd hold
 * and what each outcome pays. The range slider is the same control for keyboards and screen readers. Exact bigint math.
 */
export function PayoutCalculator() {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [yes, setYes] = useState(START_YES);
  const [target, setTarget] = useState<number | undefined>(undefined);
  const [amount, setAmount] = useState("100");
  const price = side === "yes" ? yes : 100 - yes;
  const ok = /^\d{1,7}(\.\d{0,2})?$/.test(amount) && Number(amount) > 0;
  const budget = ok ? parseUnits(amount, 18) : 0n;
  const { qty } = sharesForBudget([{ price, shares: 10n ** 30n }], budget, FEE_BPS);
  const notional = cost(qty, price);
  const paid = notional + feeOf(notional, FEE_BPS);
  const win = qty; // 1 MUSD per share
  const invalid = qty / 2n;
  const profit = win - paid;
  const label = side === "yes" ? "Yes" : "No";
  const multiple = paid > 0n ? Number((win * 100n) / paid) / 100 : 0;

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
      <SeamSplit onChange={setYes} target={target} />
      <div className="float overflow-hidden">
        <div className="space-y-5 border-b border-line p-6 md:p-8">
          <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                onClick={() => setSide(s)}
                className={cx(
                  "press flex h-12 items-center justify-between rounded-md border px-4 font-semibold transition-colors duration-200",
                  side === s ? (s === "yes" ? "border-yes bg-yes text-on-yes" : "border-no bg-no text-on-no") : "border-line text-ink-2 hover:border-line-strong",
                )}
              >
                Buy {s === "yes" ? "Yes" : "No"}
                <span className="mono">{s === "yes" ? yes : 100 - yes}¢</span>
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="calc-price" className="text-sm font-medium">{label} price</label>
              <input
                id="calc-price"
                type="range"
                min={25}
                max={75}
                value={price}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const y = side === "yes" ? v : 100 - v;
                  setYes(y);
                  setTarget(y);
                }}
                className="h-12 w-full accent-[var(--yes)]"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="calc-amount" className="text-sm font-medium">You spend</label>
              <div className="relative">
                <input
                  id="calc-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => /^\d{0,7}(\.\d{0,2})?$/.test(e.target.value) && setAmount(e.target.value)}
                  className="mono h-12 w-full rounded-md border border-line bg-sunk px-3.5 pr-16 text-lg font-medium outline-none focus:border-yes"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">MUSD</span>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-5 p-6 md:p-8" aria-live="polite">
          <div>
            <p className="text-ink-2">If {label} wins, you get</p>
            <p className="mono text-5xl font-medium tracking-tight sm:text-6xl">{formatMusd(win)}</p>
            <p className="mt-1 text-sm text-muted">MUSD{paid > 0n ? ` · ${multiple.toFixed(2)}× what you paid` : ""}</p>
          </div>
          <dl className="divide-y divide-line border-y border-line text-[0.9375rem]">
            {[
              ["Shares", `${formatShares(qty)} ${label}`],
              ["You pay, incl. 1% fee", `${formatMusd(paid)} MUSD`],
              [`If ${label} wins`, `+${formatMusd(profit > 0n ? profit : 0n)} MUSD profit`],
              [`If ${side === "yes" ? "No" : "Yes"} wins`, "0.00 MUSD"],
              ["If ruled Invalid", `${formatMusd(invalid)} MUSD`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-ink-2">{k}</dt>
                <dd className="mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">Example numbers. Real markets show their own price and fee on the ticket.</p>
        </div>
      </div>
    </div>
  );
}
