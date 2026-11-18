"use client";

import type { ReactNode } from "react";
import { Box, Figure, Flow, Group, StepDot } from "./primitives";

/*
 * MezonkBtcRounds (live on Mezo Mainnet): bet on BTC up or down, with BTC. A timeline for one round r. Top: Mezo's
 * PriceFeed, read three times (to size the stake in USD, at the lock, at the close). Middle: the betting window,
 * the price window (which is also round r+1's betting window), and the keeper's two roll() calls that capture one
 * price per boundary. Bottom: Up / Down / Void, then the pool split, the fee, the refund path and the claim.
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
const Y = { feed: 36, actors: 150, bets: 250, next: 320, results: 430, split: 530, claim: 630 } as const;
const T1 = 450; // lockTime(r): the first capture
const T2 = 860; // closeTime(r): the second capture
const STAKE = { x: 24, w: 200 }; // your wallet
const FEED = { x: 360, w: 220 }; // Mezo PriceFeed
const ROLL1 = { x: T1 - 95, w: 190 };
const ROLL2 = { x: T2 - 95, w: 190 };
const BETS = { x: 60, w: 370 }; // betStart(r) → lockTime(r)
const PRICE = { x: 470, w: 370 }; // lockTime(r) → closeTime(r)
const UP = { x: 60, w: 200 };
const DOWN = { x: 290, w: 200 };
const VOID = { x: 520, w: 400 };
const WIN = { x: 60, w: 430 };
const FEE = { x: 60, w: 200 };
const CLAIM = { x: 390, w: 220 };
const cx = (b: { x: number; w: number }) => b.x + b.w / 2;
const mid = (y: number) => y + H / 2;

export function BtcRoundsFlow() {
  return (
    <Figure
      title="BTC rounds: during round r's betting window you stake BTC on Up or Down, sized in USD at Mezo's PriceFeed price; at lockTime(r) a keeper calls roll, which captures price P1 and locks the round; one interval later, at closeTime(r), the next roll captures P2 and settles the round; Up wins if P2 is above P1, Down if below; winners split the whole pool pro rata less the fee; a tie, a one-sided round or a missed capture refunds everyone with no fee; claim pays BTC and never expires"
      width={960}
      height={694}
      minWidth={760}
      legend={["user", "mezonk", "mezo", "success", "danger"]}
      caption={
        <>
          Notice that each boundary gets exactly one price: the roll at <code>lockTime(r)</code> both locks round r and
          settles round r&minus;1, so round r&apos;s close price is round r+1&apos;s lock price. The price window of one
          round is the betting window of the next, so one round is always open. Nothing but stakes ever enters the
          contract, and the only money out is stakes back (winnings or refunds) plus the fee the owner sweeps.
        </>
      }
    >
      {/* ── Mezo's price feed, read three times ── */}
      <Group x={FEED.x - 20} y={4} w={FEED.w + 40} h={H + 60} label="Mezo" tone="mezo" />
      <Box x={FEED.x} y={Y.feed} w={FEED.w} h={H} label="PriceFeed" sub="fetchPrice() · BTC/USD" tone="mezo" />
      <Flow d={`M${FEED.x + 20} ${Y.feed + H} V118 H${cx(STAKE)} V${Y.actors - 1}`} tone="mezo" />
      <Label x={(cx(STAKE) + FEED.x + 20) / 2} y={112}>price now, for the USD check</Label>
      <Flow d={`M${T1} ${Y.feed + H} V${Y.actors - 1}`} tone="mezo" />
      <Label x={T1 + 12} y={mid(Y.feed + H) + 32} anchor="start">P1, inside the capture window</Label>
      <Flow d={`M${FEED.x + FEED.w} ${mid(Y.feed)} H${T2} V${Y.actors - 1}`} tone="mezo" />
      <Label x={T2 + 12} y={mid(Y.feed + H) + 32} anchor="start">P2</Label>

      {/* ── Who acts ── */}
      <Box x={STAKE.x} y={Y.actors} w={STAKE.w} h={H} label="Stake BTC on Up or Down" sub="worth min…max USD right now" tone="user" />
      <Box x={ROLL1.x} y={Y.actors} w={ROLL1.w} h={H} label="Keeper: roll(r)" sub="P1: locks r, settles r−1" tone="user" />
      <Box x={ROLL2.x} y={Y.actors} w={ROLL2.w} h={H} label="Keeper: roll(r+1)" sub="P2: settles r, locks r+1" tone="user" />

      {/* stake enters the open round */}
      <Flow d={`M${STAKE.x + 176} ${Y.actors + H} V${Y.bets - 1}`} tone="user" />
      <Label x={STAKE.x + 188} y={Y.bets - 14} anchor="start">BTC in, sized in USD</Label>

      {/* ── The timeline ── */}
      <Label x={BETS.x} y={Y.bets - 14} anchor="start">betStart(r)</Label>
      <Box x={BETS.x} y={Y.bets} w={BETS.w} h={H} label="Round r: bets open" sub="Up pool + Down pool, in BTC" tone="mezonk" />
      <Box x={PRICE.x} y={Y.bets} w={PRICE.w} h={H} label="Round r: price window" sub="one interval, no bets" tone="mezonk" />
      <Box x={PRICE.x} y={Y.next} w={PRICE.w} h={H} label="Round r+1: bets open" sub="one round is always open" tone="neutral" dashed />

      {/* lock: the capture closes the betting window */}
      <Flow d={`M${T1} ${Y.actors + H} V${Y.next - 2}`} tone="success" />
      <Label x={T1} y={Y.bets - 14}>lockTime(r)</Label>

      {/* close: the capture decides the round */}
      <Flow d={`M${T2} ${Y.actors + H} V${Y.results - 25} H${cx(UP)} V${Y.results - 1}`} tone="success" />
      <Flow d={`M${cx(DOWN)} ${Y.results - 25} V${Y.results - 1}`} tone="success" />
      <Flow d={`M${cx(VOID)} ${Y.results - 25} V${Y.results - 1}`} tone="danger" />
      <Label x={T2} y={Y.bets - 14}>closeTime(r)</Label>
      <Label x={T2 + 12} y={mid(Y.next)} anchor="start">P2 vs P1</Label>

      {/* ── Up / Down / Void ── */}
      <Box x={UP.x} y={Y.results} w={UP.w} h={H} label="Up wins" sub="P2 > P1" tone="success" />
      <Box x={DOWN.x} y={Y.results} w={DOWN.w} h={H} label="Down wins" sub="P2 < P1" tone="success" />
      <Box x={VOID.x} y={Y.results} w={VOID.w} h={H} label="Void" sub="tie · one side empty · no roll in time" tone="danger" />

      {/* ── Money out ── */}
      <Box x={WIN.x} y={Y.split} w={WIN.w} h={H} label="Winners split the whole pool, less the fee" sub="pro rata to your stake" tone="success" />
      <Box x={VOID.x} y={Y.split} w={VOID.w} h={H} label="Everyone refunded in full" sub="no fee on a void round" tone="danger" />
      <Flow d={`M${cx(UP)} ${Y.results + H} V${Y.split - 1}`} tone="success" />
      <Flow d={`M${cx(DOWN)} ${Y.results + H} V${Y.split - 1}`} tone="success" />
      <Flow d={`M${cx(VOID)} ${Y.results + H} V${Y.split - 1}`} tone="danger" />

      <Box x={FEE.x} y={Y.claim} w={FEE.w} h={H} label="Fee to the owner" sub="sweep() moves only fees" tone="neutral" />
      <Box x={CLAIM.x} y={Y.claim} w={CLAIM.w} h={H} label="Claim BTC" sub="claim(roundIds) · never expires" tone="user" emphasis />
      <Flow d={`M${cx(FEE)} ${Y.split + H} V${Y.claim - 1}`} tone="neutral" />
      <Label x={cx(FEE) + 12} y={Y.claim - 18} anchor="start">1% of the pool (default)</Label>
      <Flow d={`M${cx(WIN) + 60} ${Y.split + H} V${mid(Y.claim)} H${CLAIM.x - 2}`} tone="success" />
      <Label x={cx(WIN) + 72} y={Y.claim - 18} anchor="start">your share</Label>
      <Flow d={`M${cx(VOID)} ${Y.split + H} V${mid(Y.claim)} H${CLAIM.x + CLAIM.w + 2}`} tone="danger" />
      <Label x={cx(VOID) + 12} y={Y.claim - 18} anchor="start">your stake back</Label>

      <StepDot x={STAKE.x} y={Y.actors} n={1} tone="success" />
      <StepDot x={ROLL1.x} y={Y.actors} n={2} tone="success" />
      <StepDot x={ROLL2.x} y={Y.actors} n={3} tone="success" />
      <StepDot x={UP.x} y={Y.results} n={4} tone="success" />
      <StepDot x={CLAIM.x} y={Y.claim} n={5} tone="success" />
    </Figure>
  );
}
