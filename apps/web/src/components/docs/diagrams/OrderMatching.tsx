"use client";

import { Box, Figure, Flow, FlowLabel, Note, StepDot } from "./primitives";

/*
 * One book in Yes-price terms, and the two kinds of fill. Sources: docs/ORDERBOOK_ARCHITECTURE.md (fill table),
 * contracts/src/MezonkExchange.sol _bookPosition (bids want Yes: buy Yes / sell No; asks offer Yes: sell Yes / buy No)
 * and _settle (complement: maker p·q + taker (1−p)·q = q MUSD → mint q pairs; two sellers → merge). The taker fills
 * at the maker's price and pays the fee; makers pay none. Every price here is an illustrative example.
 */

type Row = { y: number; price: number; text: string; side: "ask" | "bid"; step?: number };

const ROWS: Row[] = [
  { y: 98, price: 62, text: "sell Yes at 62¢", side: "ask", step: 2 },
  { y: 140, price: 60, text: "buy No at 40¢", side: "ask", step: 1 },
  { y: 226, price: 58, text: "sell No at 42¢", side: "bid" },
  { y: 268, price: 57, text: "buy Yes at 57¢", side: "bid" },
];

function Level({ y, price, text, side, step }: Row) {
  const ask = side === "ask";
  return (
    <g>
      <rect
        x={30}
        y={y}
        width={262}
        height={34}
        rx={4}
        fill={ask ? "var(--surface-2)" : "var(--accent-soft)"}
        stroke={ask ? "var(--no)" : "var(--accent)"}
        strokeWidth={1.1}
      />
      <text
        x={46}
        y={y + 22}
        fontSize={13.5}
        fontWeight={600}
        fill={ask ? "var(--ink)" : "var(--accent-text)"}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
      >
        {price}¢
      </text>
      <text x={98} y={y + 22} fontSize={13.5} fill="var(--ink-2)">
        {text}
      </text>
      {step && <StepDot x={272} y={y + 17} n={step} />}
    </g>
  );
}

export function OrderMatching() {
  return (
    <Figure
      title="Order matching: one book in Yes prices, with a complement fill that mints a pair and a direct fill"
      width={920}
      height={504}
      minWidth={760}
      legend={["yes", "no", "mezo", "mezonk", "user"]}
      caption={
        <>
          Example prices only. A taker buying 2 Yes with a 62¢ limit takes the best ask first: the No buyer at 40¢
          (fill 1, a new pair is minted), then the Yes seller at 62¢ (fill 2, existing shares move). Each fill happens
          at the maker&apos;s price; the taker pays the trading fee, which isn&apos;t shown.
        </>
      }
    >
      {/* ── the book ── */}
      <text x={30} y={40} fontSize={13.5} fontWeight={600} fill="var(--ink)">
        The book, in Yes prices
      </text>
      <Note x={30} y={60} size={12.5}>Example orders, best prices nearest the middle</Note>
      <Note x={30} y={88} size={12.5}>Asks: offer Yes</Note>
      {ROWS.filter((r) => r.side === "ask").map((r) => (
        <Level key={r.price} {...r} />
      ))}
      <line x1={30} x2={292} y1={194} y2={194} stroke="var(--border-strong)" strokeDasharray="3 4" />
      <FlowLabel x={161} y={198}>spread</FlowLabel>
      <Note x={30} y={216} size={12.5}>Bids: want Yes</Note>
      {ROWS.filter((r) => r.side === "bid").map((r) => (
        <Level key={r.price} {...r} />
      ))}

      <Note x={30} y={340} size={12.5}>Every order is shown at its Yes price.</Note>
      <Note x={30} y={360} size={12.5}>Buying No at p is a Yes ask at 100 − p,</Note>
      <Note x={30} y={380} size={12.5}>so a No bid at 45¢ is a Yes ask at 55¢.</Note>
      <Note x={30} y={400} size={12.5}>Selling No at p is a Yes bid at 100 − p.</Note>

      <line x1={316} x2={316} y1={24} y2={480} stroke="var(--border)" />

      {/* ── fill 1: complement ── */}
      <StepDot x={352} y={36} n={1} />
      <text x={372} y={41} fontSize={13.5} fontWeight={600} fill="var(--ink)">
        Example fill 1, at 60¢: a new pair is minted
      </text>
      <Box x={340} y={62} w={170} h={52} label="Taker: buy Yes" sub="pays 60¢" tone="user" />
      <Box x={340} y={142} w={170} h={52} label="Maker: buy No at 40¢" sub="pays 40¢" tone="user" />
      <Box x={570} y={74} w={160} h={108} label="Exchange" sub="60¢ + 40¢ = 1 MUSD" tone="mezonk" emphasis />
      <Note x={650} y={160} anchor="middle" size={12.5}>mints 1 Yes + 1 No</Note>
      <Flow d="M510 88 H570" tone="mezo" label="60¢" at={[540, 81]} />
      <Flow d="M510 168 H570" tone="mezo" label="40¢" at={[540, 161]} />
      <Flow d="M730 88 H790" tone="yes" />
      <Flow d="M730 168 H790" tone="no" />
      <Box x={790} y={62} w={110} h={52} label="1 Yes" sub="to the taker" tone="yes" />
      <Box x={790} y={142} w={110} h={52} label="1 No" sub="to the maker" tone="no" />
      <Note x={340} y={222} size={12.5}>Mirror case: a Yes seller at 60¢ meeting a No seller at 40¢ merges</Note>
      <Note x={340} y={240} size={12.5}>their pair, and the freed 1 MUSD is split 60¢ / 40¢ between them.</Note>

      <line x1={340} x2={900} y1={262} y2={262} stroke="var(--border)" />

      {/* ── fill 2: direct ── */}
      <StepDot x={352} y={290} n={2} />
      <text x={372} y={295} fontSize={13.5} fontWeight={600} fill="var(--ink)">
        Example fill 2, at 62¢: existing shares change hands
      </text>
      <Box x={340} y={316} w={170} h={52} label="Taker: buy Yes" sub="pays 62¢" tone="user" />
      <Box x={340} y={396} w={170} h={52} label="Maker: sell Yes at 62¢" sub="gives 1 Yes" tone="user" />
      <Box x={570} y={328} w={160} h={108} label="Exchange" sub="nothing minted" tone="mezonk" emphasis />
      <Note x={650} y={414} anchor="middle" size={12.5}>moves Yes and MUSD</Note>
      <Flow d="M510 342 H570" tone="mezo" label="62¢" at={[540, 335]} />
      <Flow d="M510 422 H570" tone="yes" label="1 Yes" at={[540, 415]} />
      <Flow d="M730 342 H790" tone="yes" />
      <Flow d="M730 422 H790" tone="mezo" />
      <Box x={790} y={316} w={110} h={52} label="1 Yes" sub="to the taker" tone="yes" />
      <Box x={790} y={396} w={110} h={52} label="62¢ MUSD" sub="to the maker" tone="mezo" />
      <Note x={340} y={482} size={12.5}>Pool check: fill 1 adds 1 MUSD and 1 pair; fill 2 changes neither.</Note>
    </Figure>
  );
}
