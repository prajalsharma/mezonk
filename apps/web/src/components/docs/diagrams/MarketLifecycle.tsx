"use client";

import type { ReactNode } from "react";
import { Box, Figure, Flow, Note, StepDot } from "./primitives";

/*
 * A market from suggestion to final outcome. Stage names follow the contracts: MezonkExchange.Stage
 * (Seeding, Live, Failed, Closed, Finalized) and MezonkResolution.RStage (AwaitingProposal, Proposed, Disputed,
 * Finalized). Green = the usual path, red = failure exits, grey = the dispute detour.
 */

/** Arrow label at 13.5px with a surface-coloured halo so it stays readable over lines. */
function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={13.5} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" paintOrder="stroke">
      {children}
    </text>
  );
}

// Spine column (stages 1–5)
const SX = 40;
const SW = 230;
const SC = SX + SW / 2; // 155
const H = 52;
const ROW = [28, 124, 220, 316, 412] as const;

// Resolution columns
const PX = 400; // Proposed / Challenged
const PW = 180;
const PC = PX + PW / 2; // 490
const FX = 760; // Final / Arbitrated
const FW = 160;
const FC = FX + FW / 2; // 840
const R2 = 548;
const INV = 684;

export function MarketLifecycle() {
  const mid = (y: number) => y + H / 2;
  return (
    <Figure
      title="Market lifecycle: suggested, approved, seeding, live, closed, proposed, optionally challenged and arbitrated, then final; failed seeding refunds seeders and missed resolution deadlines settle Invalid"
      width={940}
      height={760}
      minWidth={760}
      legend={["offchain", "mezonk", "success", "danger"]}
      caption={
        <>
          Follow the green arrows: that is the path most markets take. The red exits never wait for MEZONK: if a market
          doesn&apos;t launch before its seeding deadline, seeders cancel their orders and get every MUSD back, and if a
          resolver or arbitrator misses a deadline, anyone can finalize the market as Invalid (0.5 MUSD a share).
        </>
      }
    >
      {/* ── Stages 1–5: listing and trading ── */}
      <Box x={SX} y={ROW[0]} w={SW} h={H} label="Suggested" sub="off-chain" tone="offchain" />
      <Box x={SX} y={ROW[1]} w={SW} h={H} label="Approved" sub="curator's EIP-712 signature" tone="offchain" />
      <Box x={SX} y={ROW[2]} w={SW} h={H} label="Seeding" sub="Stage.Seeding" tone="mezonk" />
      <Box x={SX} y={ROW[3]} w={SW} h={H} label="Live" sub="Stage.Live" tone="mezonk" />
      <Box x={SX} y={ROW[4]} w={SW} h={H} label="Closed" sub="RStage.AwaitingProposal" tone="mezonk" />

      <Flow d={`M${SC} ${ROW[0] + H} V${ROW[1] - 1}`} tone="success" />
      <Label x={SC + 12} y={ROW[0] + H + 26.5} anchor="start">a curator signs an approval</Label>
      <Flow d={`M${SC} ${ROW[1] + H} V${ROW[2] - 1}`} tone="success" />
      <Label x={SC + 12} y={ROW[1] + H + 26.5} anchor="start">an approved creator publishes it</Label>
      <Flow d={`M${SC} ${ROW[2] + H} V${ROW[3] - 1}`} tone="success" />
      <Label x={SC + 12} y={ROW[2] + H + 26.5} anchor="start">rules met: anyone presses Launch</Label>
      <Flow d={`M${SC} ${ROW[3] + H} V${ROW[4] - 1}`} tone="success" />
      <Label x={SC + 12} y={ROW[3] + H + 26.5} anchor="start">close time passes</Label>

      {/* Failure exit: seeding deadline */}
      <Box x={600} y={ROW[2]} w={280} h={H} label="Failed" sub="Stage.Failed · refunds only" tone="danger" />
      <Flow d={`M${SX + SW} ${mid(ROW[2])} H598`} tone="danger" />
      <Label x={435} y={mid(ROW[2]) - 9}>deadline passes before launch</Label>
      <Note x={740} y={ROW[2] + H + 26} anchor="middle" size={13.5}>
        Each seeder cancels and gets every MUSD back.
      </Note>

      {/* ── Resolution ── */}
      <Box x={PX} y={ROW[4]} w={PW} h={H} label="Proposed" sub="outcome, evidence, bond" tone="mezonk" />
      <Box x={FX} y={ROW[4]} w={FW} h={H} label="Final" sub="Yes · No · Invalid" tone="success" emphasis />
      <Box x={PX} y={R2} w={PW} h={H} label="Challenged" sub="RStage.Disputed" tone="mezonk" />
      <Box x={FX} y={R2} w={FW} h={H} label="Arbitrated" sub="ruling + rationale" tone="mezonk" />

      <Flow d={`M${SX + SW} ${mid(ROW[4])} H${PX - 2}`} tone="success" />
      <Label x={335} y={mid(ROW[4]) + 21}>resolver proposes</Label>
      <Flow d={`M${PX + PW} ${mid(ROW[4])} H${FX - 2}`} tone="success" />
      <Label x={670} y={mid(ROW[4]) - 9}>no challenge in time:</Label>
      <Label x={670} y={mid(ROW[4]) + 21}>anyone finalizes</Label>

      <Flow d={`M${PC} ${ROW[4] + H} V${R2 - 1}`} tone="neutral" />
      <Label x={PC + 12} y={ROW[4] + H + 46} anchor="start">someone disputes</Label>
      <Flow d={`M${PX + PW} ${mid(R2)} H${FX - 2}`} tone="neutral" />
      <Label x={670} y={mid(R2) - 9}>arbitrator rules</Label>
      <Flow d={`M${FC} ${R2} V${ROW[4] + H + 1}`} tone="neutral" />
      <Label x={FC - 12} y={ROW[4] + H + 46} anchor="end">settles at once</Label>

      {/* Failure exit: missed resolution deadlines */}
      <Box x={SX} y={INV} w={PX + PW - SX} h={H} label="Final: Invalid" sub="anyone calls finalize() · 0.5 MUSD a share" tone="danger" />
      <Flow d={`M${SC} ${ROW[4] + H} V${INV - 1}`} tone="danger" />
      <Label x={SC + 12} y={(ROW[4] + H + INV) / 2 + 4.5} anchor="start">no proposal in time</Label>
      <Flow d={`M${PC} ${R2 + H} V${INV - 1}`} tone="danger" />
      <Label x={PC + 12} y={(R2 + H + INV) / 2 + 4.5} anchor="start">no ruling in time</Label>

      <Note x={612} y={INV + 14} size={13.5}>
        <tspan fontWeight={600} fill="var(--ink-2)">Next deployment</tspan>
        <tspan x={612} dy={19}>if the resolver is silent for half the</tspan>
        <tspan x={612} dy={19}>proposal window, anyone may propose.</tspan>
      </Note>

      {/* Step numbers on the usual path */}
      <StepDot x={SX} y={ROW[0]} n={1} tone="success" />
      <StepDot x={SX} y={ROW[1]} n={2} tone="success" />
      <StepDot x={SX} y={ROW[2]} n={3} tone="success" />
      <StepDot x={SX} y={ROW[3]} n={4} tone="success" />
      <StepDot x={SX} y={ROW[4]} n={5} tone="success" />
      <StepDot x={PX} y={ROW[4]} n={6} tone="success" />
      <StepDot x={FX} y={ROW[4]} n={7} tone="success" />
    </Figure>
  );
}
