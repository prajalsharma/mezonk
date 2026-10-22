"use client";

import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import { HeroTicket } from "@/app/HomeLive";
import { useMarkets } from "@/hooks/useMarkets";
import { deployment } from "@/lib/chain/config";

/**
 * The hero is the product: a trade ticket, with the Mezo loan that funds it floating behind it.
 * With a deployment and open markets the ticket is a real market (HeroTicket); otherwise it's an example ticket,
 * labelled as one. The loan card never prints a BTC→MUSD figure (that depends on the price); only the ratio the
 * borrower picks.
 */
export function HeroStack() {
  const box = useRef<HTMLDivElement>(null);
  const any = useMarkets({ status: "open", sort: "trending", limit: 1, offset: 0 }, { enabled: deployment.ready });
  const real = deployment.ready && !!any.data && any.data.total > 0;

  // Pointer tilt, hover-capable devices only; max 3°. Written straight to CSS vars, no React state per frame.
  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    box.current.style.setProperty("--ry", `${(x * 6).toFixed(2)}deg`);
    box.current.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
    box.current.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
    box.current.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const leave = () => {
    for (const k of ["--rx", "--ry"]) box.current?.style.setProperty(k, "0deg");
  };

  return (
    <div className="relative mx-auto w-full max-w-[34rem] pb-12 pt-[5.5rem] sm:pb-14">
      {/* Behind, top left: the loan that pays for the trade. */}
      <div
        aria-hidden
        className="stack-back glass-card absolute left-0 top-0 z-0 w-[78%] p-4 sm:-left-4 sm:w-[66%]"
        style={{ "--from": "translate(18px, 18px) rotate(0deg)", "--to": "rotate(-2.5deg)" } as CSSProperties}
      >
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Lock className="size-3.5" /> Your BTC, locked on Mezo
          </span>
          <span className="hidden text-xs text-muted sm:inline">Locked, not sold</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-1/2 rounded-full bg-success" />
        </div>
        <p className="mt-2 flex justify-between text-xs text-ink-2">
          <span>Borrowed MUSD at a 200% ratio</span>
          <span className="font-medium text-success">Comfortable</span>
        </p>
      </div>

      {/* Front: the ticket. */}
      <div ref={box} onPointerMove={move} onPointerLeave={leave} className="stack-front relative z-10">
        <div className="tilt relative">
          {real ? <HeroTicket /> : <ExampleTicket />}
          <div aria-hidden className="sheen pointer-events-none absolute inset-0 rounded-lg" />
        </div>
      </div>

      {/* Behind, bottom right: what a right call pays. */}
      <div
        aria-hidden
        className="stack-back glass-card absolute bottom-0 right-0 z-20 flex items-center gap-3 px-4 py-3 sm:-right-4"
        style={{ "--from": "translate(-18px, -18px) rotate(0deg)", "--to": "rotate(2deg)" } as CSSProperties}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-yes text-on-yes">
          <Check className="size-4" strokeWidth={2.5} />
        </span>
        <span className="text-sm">
          <span className="block font-medium">Called it</span>
          <span className="text-ink-2">Paid in MUSD by the contract</span>
        </span>
      </div>
    </div>
  );
}

/** Shown when no market is open on this network. Clearly an example; its buttons lead to the real markets page. */
function ExampleTicket() {
  return (
    <div className="float overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
        <span className="font-medium text-ink-2">Example market</span>
        <span className="text-xs text-muted">Crypto · closes 31 Dec</span>
      </div>
      <div className="space-y-5 p-5">
        <p className="text-lg font-medium leading-snug">Will BTC close above $150,000 on 31 December?</p>
        <div className="flex items-baseline gap-2">
          <span className="mono text-5xl font-medium tracking-tight">57%</span>
          <span className="text-sm text-muted">chance of Yes</span>
        </div>
        <svg viewBox="0 0 300 64" className="h-16 w-full" aria-hidden>
          <path
            d="M0 50 L30 46 L55 52 L85 40 L110 43 L140 33 L170 37 L200 26 L230 30 L260 21 L300 24"
            fill="none"
            stroke="var(--yes)"
            strokeWidth="2"
            strokeLinejoin="round"
            pathLength={1}
            className="draw"
            style={{ "--len": 1, "--draw-dur": "1800ms", "--draw-delay": "500ms" } as CSSProperties}
          />
        </svg>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/markets" className="press flex h-12 items-center justify-between rounded-md bg-yes px-4 font-semibold text-on-yes hover:bg-accent-hover">
            Buy Yes <span className="mono">57¢</span>
          </Link>
          <Link href="/markets" className="press flex h-12 items-center justify-between rounded-md bg-no px-4 font-semibold text-on-no hover:opacity-90">
            Buy No <span className="mono">43¢</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
