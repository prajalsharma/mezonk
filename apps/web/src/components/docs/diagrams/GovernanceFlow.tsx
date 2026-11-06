"use client";

import type { ReactNode } from "react";
import { Box, Figure, Flow, Group, Note, StepDot } from "./primitives";

/*
 * From suggestion to a published market. Only the last step is on-chain, and it is the one that matters:
 * MezonkMarketFactory.createMarket runs these checks in this order and reverts on the first failure.
 */

/** Arrow label at 13.5px with a surface-coloured halo so it stays readable over lines. */
function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={13.5} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" paintOrder="stroke">
      {children}
    </text>
  );
}

const MONO = "var(--font-geist-mono), ui-monospace, monospace";

// The signed struct, field by field (MARKET_APPROVAL_TYPEHASH in MezonkMarketFactory.sol).
const FIELDS: [string, string][] = [
  ["metadataHash", "the rules"],
  ["creator", "publisher"],
  ["resolver", ""],
  ["closeTime", ""],
  ["policyId", "fees, seeding"],
  ["deadline", "expiry"],
  ["nonce", "single use"],
];

// createMarket checks in code order, with the error each one reverts with.
const CHECKS: [string, string][] = [
  ["Rules text is 1 to 8,192 bytes", "InvalidParams"],
  ["Resolver is on the allowlist", "NotResolver"],
  ["Caller is an approved creator", "NotApprovedCreator"],
  ["Signer is an approved curator", "NotCurator"],
  ["Curator is not the caller", "SelfApproval"],
  ["Approval hasn't expired", "ApprovalExpired"],
  ["Nonce not used or voided", "ApprovalUsed"],
  ["Every field matches the market", "ApprovalMismatch"],
  ["Signature valid (EOA or ERC-1271)", "BadApprovalSignature"],
];

const TOP = 40;
const BH = 60;
const CARD = { x: 360, y: 132, w: 200 };
const PANEL = { x: 400, y: 352, w: 500, h: 310 };
const ROW0 = PANEL.y + 50;
const PITCH = 30;

export function GovernanceFlow() {
  const cardH = 40 + FIELDS.length * 21;
  return (
    <Figure
      title="Market governance: anyone suggests, a curator signs an EIP-712 MarketApproval, an approved creator calls createMarket, and the factory checks nine conditions before the market is published into seeding"
      width={920}
      height={684}
      minWidth={760}
      legend={["offchain", "user", "mezonk", "success", "danger"]}
      caption={
        <>
          Notice that two different wallets must act: the curator signs, a separate approved creator publishes, and the
          contract refuses a curator approving their own market. The signature binds the exact rules text (by hash),
          the publisher, the resolver, the close time and the policy, so nothing can be changed between review and
          publication.
        </>
      }
    >
      {/* ── 1–3: suggestion, signature, publication ── */}
      <Box x={20} y={TOP} w={200} h={BH} label="Anyone suggests" sub="off-chain draft" tone="offchain" />
      <Box x={360} y={TOP} w={200} h={BH} label="Curator signs" sub="EIP-712, own wallet" tone="user" />
      <Box x={700} y={TOP} w={200} h={BH} label="Creator publishes" sub="factory.createMarket()" tone="user" />
      <Flow d={`M220 ${TOP + BH / 2} H358`} tone="success" />
      <Label x={290} y={TOP + BH / 2 - 9}>public review</Label>
      <Flow d={`M560 ${TOP + BH / 2} H698`} tone="success" />
      <Label x={630} y={TOP + BH / 2 - 9}>signed approval</Label>

      {/* What review means, under step 1 */}
      <Note x={20} y={146} size={13.5}>
        <tspan>Anyone signed in can suggest.</tspan>
        <tspan x={20} dy={20}>A curator approves, asks for</tspan>
        <tspan x={20} dy={20}>changes or rejects, with a</tspan>
        <tspan x={20} dy={20}>public reason.</tspan>
        <tspan x={20} dy={32}>The curator names the publisher;</tspan>
        <tspan x={20} dy={20}>the approval binds that wallet.</tspan>
      </Note>

      {/* The signed struct, under step 2 */}
      <Flow d={`M460 ${TOP + BH} V${CARD.y}`} tone="user" animated={false} dashed />
      <g>
        <rect x={CARD.x} y={CARD.y} width={CARD.w} height={cardH} rx={8} fill="var(--surface-sunk)" stroke="var(--border-strong)" strokeWidth={1.25} />
        <text x={CARD.x + 14} y={CARD.y + 25} fontSize={13.5} fontWeight={600} fill="var(--ink)">
          MarketApproval
        </text>
        {FIELDS.map(([f, why], i) => (
          <g key={f}>
            <text x={CARD.x + 14} y={CARD.y + 50 + i * 21} fontSize={12.5} fill="var(--ink)" fontFamily={MONO}>
              {f}
            </text>
            {why && (
              <text x={CARD.x + CARD.w - 14} y={CARD.y + 50 + i * 21} fontSize={13} fill="var(--muted)" textAnchor="end">
                {why}
              </text>
            )}
          </g>
        ))}
      </g>

      {/* ── 4: on-chain checks ── */}
      <Flow d={`M800 ${TOP + BH} V${PANEL.y - 2}`} tone="success" />
      <Label x={788} y={232} anchor="end">approval + signature</Label>
      <Group x={PANEL.x} y={PANEL.y} w={PANEL.w} h={PANEL.h} label="MezonkMarketFactory checks, in order" tone="mezonk" />
      {CHECKS.map(([text, err], i) => {
        const y = ROW0 + i * PITCH;
        return (
          <g key={err}>
            {i > 0 && <line x1={PANEL.x + 16} x2={PANEL.x + PANEL.w - 16} y1={y - 20} y2={y - 20} stroke="var(--border)" strokeWidth={1} />}
            <text x={PANEL.x + 20} y={y} fontSize={12} fill="var(--muted)" fontFamily={MONO}>
              {i + 1}
            </text>
            <text x={PANEL.x + 42} y={y} fontSize={13.5} fill="var(--ink)">
              {text}
            </text>
            <text x={PANEL.x + PANEL.w - 18} y={y} fontSize={12} fill="var(--danger)" textAnchor="end" fontFamily={MONO}>
              {err}
            </text>
          </g>
        );
      })}

      {/* ── 5: result ── */}
      <Box x={40} y={400} w={290} h={BH} label="Published, now seeding" sub="Stage.Seeding · nonce used" tone="success" emphasis />
      <Flow d={`M${PANEL.x} 430 H332`} tone="success" />
      <Label x={365} y={421}>all pass</Label>
      <Box x={40} y={590} w={290} h={BH} label="Transaction reverts" sub="no market, nothing stored" tone="danger" />
      <Flow d={`M${PANEL.x} 620 H332`} tone="danger" />
      <Label x={365} y={611}>any fails</Label>
      <Note x={40} y={500} size={13.5}>
        <tspan>A curator or the owner can void an</tspan>
        <tspan x={40} dy={20}>unused approval with cancelApproval.</tspan>
      </Note>

      <StepDot x={20} y={TOP} n={1} tone="success" />
      <StepDot x={360} y={TOP} n={2} tone="success" />
      <StepDot x={700} y={TOP} n={3} tone="success" />
      <StepDot x={PANEL.x} y={PANEL.y} n={4} tone="success" />
      <StepDot x={40} y={400} n={5} tone="success" />
    </Figure>
  );
}
