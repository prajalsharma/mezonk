"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { cx } from "@/components/ui/cx";
import { formatMusd, formatShares } from "@/lib/format";
import { cost, feeOf, sharesForBudget } from "@/lib/orderbook/math";

const FEE_BPS = 100; // illustration uses a 1% taker fee; each market shows its own on the ticket

/** Pick a side, a price and an amount; see exactly what you'd hold and what each outcome pays. Exact bigint math. */
export function PayoutCalculator() {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [price, setPrice] = useState(40);
  const [amount, setAmount] = useState("20");
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
    <div className="panel grid overflow-hidden shadow-2 md:grid-cols-[1fr_1.05fr]">
      <div className="space-y-6 border-b border-line p-6 md:border-b-0 md:border-r md:p-8">
        <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => setSide(s)}
              className={cx(
                "press h-12 rounded-md border font-semibold transition-colors duration-200",
                side === s ? (s === "yes" ? "border-yes bg-yes text-on-yes" : "border-no bg-no text-on-no") : "border-line text-ink-2 hover:border-line-strong",
              )}
            >
              Buy {s === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="calc-price" className="font-medium">Price per share</label>
            <span className="mono text-lg">{price}¢</span>
          </div>
          <input
            id="calc-price"
            type="range"
            min={1}
            max={99}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full accent-[var(--yes)]"
          />
          <p className="text-sm text-muted">The market thinks {label} has about a {price}% chance.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="calc-amount" className="font-medium">You spend</label>
          <div className="relative">
            <input
              id="calc-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => /^\d{0,7}(\.\d{0,2})?$/.test(e.target.value) && setAmount(e.target.value)}
              className="mono h-12 w-full rounded-md border border-line bg-sunk px-3.5 pr-16 text-xl font-medium outline-none focus:border-yes"
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">MUSD</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-between gap-6 bg-surface p-6 md:p-8" aria-live="polite">
        <div>
          <p className="text-muted">If {label} wins, you get</p>
          <p className="mono text-6xl font-medium tracking-tight">{formatMusd(win)}</p>
          <p className="mt-1 text-sm text-muted">
            MUSD{paid > 0n ? ` · ${multiple.toFixed(2)}× what you paid` : ""}
          </p>
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
        <p className="text-sm text-muted">Example numbers. Every Yes and No pair is backed by 1 MUSD held in the contract until it pays out.</p>
      </div>
    </div>
  );
}
