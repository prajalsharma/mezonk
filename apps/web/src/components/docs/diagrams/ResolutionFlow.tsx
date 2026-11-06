"use client";

import type { ReactNode } from "react";
import { Box, Figure, Flow, StepDot } from "./primitives";

/*
 * Optimistic resolution in MezonkResolution, as deployed on testnet (exchange 0x4555…49B9): only the market's
 * resolver proposes; anyone but the resolver may dispute once; the arbitrator's ruling sends both bonds to whoever
 * it agrees with. The merged-but-not-deployed rules (commit c8fbaff) are in the "Next deployment" box.
 */

/** Arrow label at 13.5px with a surface-coloured halo so it stays readable over lines. */
function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={13.5} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" paintOrder="stroke">
      {children}
    </text>
  );
}

const H = 56;
// Columns: spine (usual path), dispute branch, far right.
const S = { x: 24, w: 220 };
const B = { x: 404, w: 220 };
const R = { x: 756, w: 188 };
const SC = S.x + S.w / 2; // 134
const BC = B.x + B.w / 2; // 514
const RC = R.x + R.w / 2; // 850
const Y = [30, 130, 240, 350, 480] as const;
const mid = (y: number) => y + H / 2;
const NOTE_Y = 576;
const ROLES: ReadonlyArray<readonly [string, string]> = [
  ["Propose", "the market's resolver, once"],
  ["Dispute", "anyone but the resolver, once, with a bond"],
  ["Rule", "the market's arbitrator, with a rationale"],
  ["Finalize", "anyone, once the deadline has passed"],
];

export function ResolutionFlow() {
  const split = Y[3] + H + 28; // junction under the arbitrator
  return (
    <Figure
      title="Resolution: the resolver proposes with a bond and evidence, a challenge window follows, then either anyone finalizes or a challenger disputes with a bond and the arbitrator rules; missed deadlines settle Invalid; shows who receives each bond"
      width={960}
      height={680}
      minWidth={780}
      legend={["mezonk", "success", "danger"]}
      caption={
        <>
          Read the bond line in each final box. In the live contract the arbitrator&apos;s side takes both bonds, so a
          wrong proposal or a frivolous challenge costs its poster a bond. If nobody rules in time, both bonds go back and
          the market settles Invalid.
        </>
      }
    >
      {/* ── Usual path ── */}
      <Box x={S.x} y={Y[0]} w={S.w} h={H} label="Trading closes" sub="RStage.AwaitingProposal" tone="neutral" />
      <Box x={S.x} y={Y[1]} w={S.w} h={H} label="Resolver proposes" sub="outcome · evidence · bond" tone="mezonk" />
      <Box x={S.x} y={Y[2]} w={S.w} h={H} label="Challenge window" sub="disputes open" tone="neutral" />
      <Box x={S.x} y={Y[3]} w={S.w} h={H} label="Anyone finalizes" sub="finalize()" tone="mezonk" />
      <Box x={S.x} y={Y[4]} w={S.w} h={H} label="Final: as proposed" sub="proposer's bond back" tone="success" emphasis />

      <Flow d={`M${SC} ${Y[0] + H} V${Y[1] - 1}`} tone="success" />
      <Label x={SC + 12} y={(Y[0] + H + Y[1]) / 2 + 4.5} anchor="start">within the proposal window</Label>
      <Flow d={`M${SC} ${Y[1] + H} V${Y[2] - 1}`} tone="success" />
      <Flow d={`M${SC} ${Y[2] + H} V${Y[3] - 1}`} tone="success" />
      <Label x={SC + 12} y={(Y[2] + H + Y[3]) / 2 + 4.5} anchor="start">window ends, no dispute</Label>
      <Flow d={`M${SC} ${Y[3] + H} V${Y[4] - 1}`} tone="success" />

      {/* No proposal in time */}
      <Box x={B.x} y={Y[0]} w={B.w} h={H} label="Final: Invalid" sub="no bond was posted" tone="danger" />
      <Flow d={`M${S.x + S.w} ${mid(Y[0])} H${B.x - 2}`} tone="danger" />
      <Label x={324} y={mid(Y[0]) - 9}>no proposal in time</Label>

      {/* Who may call what */}
      {ROLES.map(([who, what], i) => (
        <g key={who}>
          <text x={B.x + 16} y={Y[1] + 4 + i * 23} fontSize={13.5} fontWeight={600} fill="var(--ink)">
            {who}
          </text>
          <text x={B.x + 96} y={Y[1] + 4 + i * 23} fontSize={13.5} fill="var(--ink-2)">
            {what}
          </text>
        </g>
      ))}

      {/* ── Dispute branch ── */}
      <Box x={B.x} y={Y[2]} w={B.w} h={H} label="Challenger disputes" sub="bond + evidence" tone="mezonk" />
      <Flow d={`M${S.x + S.w} ${mid(Y[2])} H${B.x - 2}`} tone="neutral" />
      <Label x={324} y={mid(Y[2]) - 9}>disputed in time</Label>

      <Box x={B.x} y={Y[3]} w={B.w} h={H} label="Arbitrator rules" sub="outcome + rationale" tone="mezonk" />
      <Flow d={`M${BC} ${Y[2] + H} V${Y[3] - 1}`} tone="neutral" />
      <Label x={BC + 12} y={(Y[2] + H + Y[3]) / 2 + 4.5} anchor="start">within the arbitration window</Label>

      <Box x={R.x} y={Y[3]} w={R.w} h={H} label="Final: Invalid" sub="each bond refunded" tone="danger" />
      <Flow d={`M${B.x + B.w} ${mid(Y[3])} H${R.x - 2}`} tone="danger" />
      <Label x={(B.x + B.w + R.x) / 2} y={mid(Y[3]) - 9}>no ruling in time</Label>

      <Box x={B.x} y={Y[4]} w={B.w} h={H} label="Final: upheld" sub="proposer gets both bonds" tone="success" />
      <Box x={R.x} y={Y[4]} w={R.w} h={H} label="Final: overturned" sub="challenger gets both" tone="success" />
      <Flow d={`M${BC} ${Y[3] + H} V${Y[4] - 1}`} tone="neutral" />
      <Flow d={`M${BC} ${split} H${RC} V${Y[4] - 1}`} tone="neutral" />
      <Label x={BC - 12} y={split + 30} anchor="end">ruling agrees</Label>
      <Label x={(BC + RC) / 2 + 20} y={split - 9}>ruling differs</Label>

      {/* ── Merged, not yet deployed ── */}
      <g>
        <rect x={S.x} y={NOTE_Y} width={R.x + R.w - S.x} height={84} rx={8} fill="none" stroke="var(--border-strong)" strokeDasharray="5 4" />
        <text x={S.x + 16} y={NOTE_Y + 25} fontSize={13.5} fontWeight={600} fill="var(--ink)">
          Next deployment <tspan fontWeight={400} fill="var(--muted)">(merged and tested, not on chain yet)</tspan>
        </text>
        <text x={S.x + 16} y={NOTE_Y + 48} fontSize={13.5} fill="var(--ink-2)">
          Overturned: half the proposer&apos;s bond goes to the protocol and the challenger gets the rest.
        </text>
        <text x={S.x + 16} y={NOTE_Y + 69} fontSize={13.5} fill="var(--ink-2)">
          If the resolver is silent for half the proposal window, anyone may propose. A proposer can&apos;t dispute its own proposal.
        </text>
      </g>

      <StepDot x={S.x} y={Y[1]} n={1} tone="success" />
      <StepDot x={S.x} y={Y[2]} n={2} tone="success" />
      <StepDot x={S.x} y={Y[3]} n={3} tone="success" />
      <StepDot x={S.x} y={Y[4]} n={4} tone="success" />
    </Figure>
  );
}
