"use client";

import type { ReactNode } from "react";
import { Box, Figure, Flow, Group, StepDot } from "./primitives";

/*
 * Borrow MUSD against BTC on Mezo, trade on MEZONK, repay. Three lanes: Mezo's contracts (left), your wallet
 * (middle), MEZONK (right). Functions are Mezo's BorrowerOperations as called by lib/mezo/borrow.ts; the repay after
 * a claim is the second signature offered in features/resolution/Claims.tsx.
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
const M = { x: 24, w: 220 }; // Mezo
const W = { x: 384, w: 176 }; // wallet
const K = { x: 696, w: 220 }; // MEZONK
const MC = M.x + M.w / 2; // 134
const KC = K.x + K.w / 2; // 806
const Y = [60, 170, 280, 390, 500, 610] as const;
const mid = (y: number) => y + H / 2;
const ME = M.x + M.w; // 244
const WE = W.x + W.w; // 560

export function LoanFlow() {
  return (
    <Figure
      title="Loan flow: lock BTC in a Mezo trove with openTrove, receive MUSD, buy shares on MEZONK, claim winnings, repay with repayMUSD, then close the loan to get the BTC back; liquidation if the ratio drops below 110%"
      width={940}
      height={704}
      minWidth={760}
      legend={["user", "mezo", "mezonk", "success", "danger"]}
      caption={
        <>
          Notice that your BTC stays in Mezo&apos;s loan contract the whole time: MEZONK only ever holds MUSD. Repaying
          is a separate transaction you sign after the claim, and you can repay part and keep the loan open. Keep the
          ratio well above 110%, because below it Mezo can liquidate the loan whether your trade wins or not.
        </>
      }
    >
      <Group x={12} y={16} w={244} h={672} label="Mezo" tone="mezo" />
      <Group x={W.x - 12} y={16} w={W.w + 24} h={672} label="Your wallet" tone="user" />
      <Group x={K.x - 12} y={16} w={K.w + 24} h={672} label="MEZONK" tone="mezonk" />

      {/* Side risk: liquidation */}
      <Box x={M.x} y={Y[0]} w={M.w} h={H} label="Liquidation" sub="if the ratio drops below 110%" tone="danger" />
      <Flow d={`M${MC} ${Y[1]} V${Y[0] + H + 1}`} tone="danger" dashed animated={false} />
      <Label x={MC + 12} y={(Y[0] + H + Y[1]) / 2 + 4.5} anchor="start">BTC price falls</Label>

      {/* 1–2 lock BTC */}
      <Box x={W.x} y={Y[1]} w={W.w} h={H} label="BTC in your wallet" tone="user" />
      <Box x={M.x} y={Y[1]} w={M.w} h={H} label="Trove holds your BTC" sub="BorrowerOperations.openTrove" tone="mezo" />
      <Flow d={`M${W.x} ${mid(Y[1])} H${ME + 2}`} tone="mezo" />
      <Label x={(ME + W.x) / 2} y={mid(Y[1]) - 9}>lock BTC</Label>

      {/* 3 MUSD to wallet */}
      <Box x={W.x} y={Y[2]} w={W.w} h={H} label="MUSD in your wallet" tone="user" />
      <Flow d={`M${MC} ${Y[1] + H} V${mid(Y[2])} H${W.x - 2}`} tone="user" />
      <Label x={(MC + W.x) / 2} y={mid(Y[2]) - 9}>MUSD minted to you</Label>

      {/* 4 trade */}
      <Box x={K.x} y={Y[2]} w={K.w} h={H} label="Shares in a market" sub="MezonkExchange" tone="mezonk" />
      <Flow d={`M${WE} ${mid(Y[2])} H${K.x - 2}`} tone="mezonk" />
      <Label x={(WE + K.x) / 2} y={mid(Y[2]) - 9}>buy shares</Label>

      {/* 5 win */}
      <Box x={K.x} y={Y[3]} w={K.w} h={H} label="Your side wins" sub="redeem()" tone="success" />
      <Flow d={`M${KC} ${Y[2] + H} V${Y[3] - 1}`} tone="mezonk" />
      <Label x={KC + 12} y={(Y[2] + H + Y[3]) / 2 + 4.5} anchor="start">market resolves</Label>

      {/* 6 claim */}
      <Box x={W.x} y={Y[4]} w={W.w} h={H} label="Winnings, in MUSD" tone="user" />
      <Flow d={`M${KC} ${Y[3] + H} V${mid(Y[4])} H${WE + 2}`} tone="user" />
      <Label x={(WE + K.x) / 2} y={mid(Y[4]) - 9}>claim pays MUSD</Label>

      {/* 7 repay */}
      <Box x={M.x} y={Y[4]} w={M.w} h={H} label="Loan repaid" sub="BorrowerOperations.repayMUSD" tone="mezo" />
      <Flow d={`M${W.x} ${mid(Y[4])} H${ME + 2}`} tone="mezo" />
      <Label x={(ME + W.x) / 2} y={mid(Y[4]) - 9}>repayMUSD</Label>
      <Label x={(ME + W.x) / 2} y={mid(Y[4]) + 22}>second signature</Label>

      {/* 8–9 close and get BTC back */}
      <Box x={M.x} y={Y[5]} w={M.w} h={H} label="Close the loan" sub="closeTrove() · or keep it open" tone="mezo" />
      <Flow d={`M${MC} ${Y[4] + H} V${Y[5] - 1}`} tone="mezo" />
      <Box x={W.x} y={Y[5]} w={W.w} h={H} label="BTC back to you" tone="user" emphasis />
      <Flow d={`M${ME} ${mid(Y[5])} H${W.x - 2}`} tone="user" />
      <Label x={(ME + W.x) / 2} y={mid(Y[5]) - 9}>BTC returned</Label>

      <StepDot x={W.x} y={Y[1]} n={1} tone="success" />
      <StepDot x={M.x} y={Y[1]} n={2} tone="success" />
      <StepDot x={W.x} y={Y[2]} n={3} tone="success" />
      <StepDot x={K.x} y={Y[2]} n={4} tone="success" />
      <StepDot x={K.x} y={Y[3]} n={5} tone="success" />
      <StepDot x={W.x} y={Y[4]} n={6} tone="success" />
      <StepDot x={M.x} y={Y[4]} n={7} tone="success" />
      <StepDot x={M.x} y={Y[5]} n={8} tone="success" />
      <StepDot x={W.x} y={Y[5]} n={9} tone="success" />
    </Figure>
  );
}
