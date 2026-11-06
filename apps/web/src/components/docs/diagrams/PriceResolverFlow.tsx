"use client";

import type { ReactNode } from "react";
import { Box, Figure, Flow, Group, Note, StepDot } from "./primitives";

/*
 * MezonkPriceResolver (merged, not deployed): settles "BTC above/below $X" markets from Mezo's PriceFeed.
 * Left: who acts. Middle: what settle() does, in order. Right: Mezo's price contracts it reads.
 */

/** Arrow label at 13.5px with a surface-coloured halo so it stays readable over lines. */
function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={13.5} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" paintOrder="stroke">
      {children}
    </text>
  );
}

const H = 52;
const L = { x: 24, w: 180 };
const C = { x: 324, w: 280 };
const R = { x: 724, w: 192 };
const LC = L.x + L.w / 2; // 114
const CC = C.x + C.w / 2; // 464
const LE = L.x + L.w; // 204
const CE = C.x + C.w; // 604
const Y = [0, 36, 124, 212, 300, 388, 476, 564, 652, 740] as const; // rows 1–9 (index 0 unused)
const mid = (y: number) => y + H / 2;
const row = (i: number) => Y[i] ?? 0;
const gap = (a: number) => (row(a) + H + row(a + 1)) / 2 + 4.5; // label baseline between row a and a+1

export function PriceResolverFlow() {
  return (
    <Figure
      title="BTC price resolver: after close a keeper calls settle within the capture window, the resolver reads Mezo's PriceFeed and oracle, checks the price is from after close, compares it with the strike, stores the reading and proposes with a bond; if the window is missed the owner proposes by hand; either way the proposal can be disputed"
      width={940}
      height={812}
      minWidth={760}
      legend={["user", "mezonk", "mezo", "success", "danger"]}
      caption={
        <>
          Notice the timing: Mezo&apos;s oracle only reports the latest price, with no history, so the reading must be taken
          within the capture window after close (15 minutes by default) and must be dated at or after the close. The
          result is an ordinary proposal: it waits out the challenge window and can be disputed like any other.
        </>
      }
    >
      {/* Not deployed yet */}
      <g>
        <rect x={R.x} y={Y[1]} width={R.w} height={H} rx={8} fill="none" stroke="var(--border-strong)" strokeDasharray="5 4" />
        <text x={R.x + R.w / 2} y={Y[1] + 22} textAnchor="middle" fontSize={13.5} fontWeight={600} fill="var(--ink)">
          Next deployment
        </text>
        <text x={R.x + R.w / 2} y={Y[1] + 40} textAnchor="middle" fontSize={13} fill="var(--muted)">
          merged, not on chain yet
        </text>
      </g>

      {/* ── Who acts ── */}
      <Box x={L.x} y={Y[1]} w={L.w} h={H} label="Owner sets the rule" sub="setRule · before close" tone="user" />
      <Box x={L.x} y={Y[2]} w={L.w} h={H} label="Market closes" sub="closeTime" tone="mezonk" />
      <Box x={L.x} y={Y[3]} w={L.w} h={H} label="Keeper calls settle" sub="anyone may call it" tone="user" />
      <Flow d={`M${LC} ${Y[1] + H} V${Y[2] - 1}`} tone="success" />
      <Flow d={`M${LC} ${Y[2] + H} V${Y[3] - 1}`} tone="success" />
      <Label x={LC + 12} y={gap(2)} anchor="start">within 15 min (default)</Label>
      <Flow d={`M${LE} ${mid(Y[3])} H${C.x - 2}`} tone="success" />

      {/* ── settle(), in order ── */}
      <Box x={C.x} y={Y[3]} w={C.w} h={H} label="Read the BTC price" sub="PriceFeed.fetchPrice()" tone="mezonk" />
      <Box x={C.x} y={Y[4]} w={C.w} h={H} label="Check it's from after close" sub="updatedAt ≥ closeTime" tone="mezonk" />
      <Box x={C.x} y={Y[5]} w={C.w} h={H} label="Compare with the strike" sub="Above: Yes if price ≥ strike" tone="mezonk" />
      <Box x={C.x} y={Y[6]} w={C.w} h={H} label="Store the reading" sub="PriceCaptured · evidence hash" tone="mezonk" />
      <Box x={C.x} y={Y[7]} w={C.w} h={H} label="Propose with the bond" sub="MezonkResolution.proposeOutcome" tone="mezonk" />
      <Box x={C.x} y={Y[8]} w={C.w} h={H} label="Challenge window" sub="disputable, arbitrator rules" tone="mezonk" />
      <Box x={C.x} y={Y[9]} w={C.w} h={H} label="Final" sub="outcome settles, claims open" tone="success" emphasis />
      {[3, 4, 5, 6, 7, 8].map((r) => (
        <Flow key={r} d={`M${CC} ${row(r) + H} V${row(r + 1) - 1}`} tone="success" />
      ))}

      {/* ── Mezo's price contracts ── */}
      <Group x={R.x - 12} y={Y[3] - 32} w={R.w + 24} h={Y[4] + H - Y[3] + 44} label="Mezo" tone="mezo" />
      <Box x={R.x} y={Y[3]} w={R.w} h={H} label="PriceFeed" sub="0x86bC…9366" tone="mezo" />
      <Box x={R.x} y={Y[4]} w={R.w} h={H} label="Price oracle" sub="latestRoundData()" tone="mezo" />
      <Flow d={`M${R.x} ${mid(Y[3])} H${CE + 2}`} tone="mezo" />
      <Label x={(CE + R.x) / 2} y={mid(Y[3]) - 9}>BTC/USD</Label>
      <Flow d={`M${R.x} ${mid(Y[4])} H${CE + 2}`} tone="mezo" />
      <Label x={(CE + R.x) / 2} y={mid(Y[4]) - 9}>updatedAt</Label>
      <Note x={R.x} y={mid(Y[5]) + 5} size={13.5}>
        Below: Yes if price &lt; strike
      </Note>

      {/* ── Failures and the fallback ── */}
      <Box x={L.x} y={Y[4]} w={L.w} h={H} label="Reverts" sub="stale or pre-close" tone="danger" />
      <Flow d={`M${C.x} ${mid(Y[4])} H${LE + 2}`} tone="danger" dashed animated={false} />
      <Label x={(LE + C.x) / 2} y={mid(Y[4]) - 9}>if not</Label>
      <Flow d={`M${LC} ${Y[4]} V${Y[3] + H + 1}`} tone="danger" dashed animated={false} />
      <Label x={LC + 12} y={gap(3)} anchor="start">retry</Label>

      <Box x={L.x} y={Y[7]} w={L.w} h={H} label="Owner proposes" sub="proposeManual()" tone="user" />
      <Flow d={`M${LC} ${Y[4] + H} V${Y[7] - 1}`} tone="neutral" />
      <Label x={LC + 12} y={mid(Y[5]) + 16} anchor="start">window ends</Label>
      <Label x={LC + 12} y={mid(Y[5]) + 36} anchor="start">with no reading</Label>
      <Flow d={`M${LE} ${mid(Y[7])} H${C.x - 2}`} tone="neutral" />
      <Label x={(LE + C.x) / 2} y={mid(Y[7]) - 9}>with evidence</Label>
      <Note x={R.x} y={mid(Y[7]) - 4} size={13.5}>
        <tspan>The bond comes from MUSD</tspan>
        <tspan x={R.x} dy={20}>the resolver contract holds.</tspan>
      </Note>

      <StepDot x={L.x} y={Y[1]} n={1} tone="success" />
      <StepDot x={L.x} y={Y[2]} n={2} tone="success" />
      <StepDot x={L.x} y={Y[3]} n={3} tone="success" />
      <StepDot x={C.x} y={Y[3]} n={4} tone="success" />
      <StepDot x={C.x} y={Y[4]} n={5} tone="success" />
      <StepDot x={C.x} y={Y[5]} n={6} tone="success" />
      <StepDot x={C.x} y={Y[6]} n={7} tone="success" />
      <StepDot x={C.x} y={Y[7]} n={8} tone="success" />
      <StepDot x={C.x} y={Y[8]} n={9} tone="success" />
      <StepDot x={C.x} y={Y[9]} n={10} tone="success" />
    </Figure>
  );
}
