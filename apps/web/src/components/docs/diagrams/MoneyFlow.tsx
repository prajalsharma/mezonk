"use client";

import { Box, Figure, Flow, Note, StepDot } from "./primitives";

/*
 * 1 MUSD ⇄ 1 Yes + 1 No. Sources: contracts/src/MezonkExchange.sol split (LIVE only), merge (after graduation,
 * until final), redeem/_payout (Yes or No pays 1 per winning share, Invalid pays (y + n) / 2), and the
 * check_sharesFullyBacked invariant in contracts/test/exchange/ExchangeInvariants.t.sol.
 */
export function MoneyFlow() {
  return (
    <Figure
      title="How MUSD becomes shares: split, merge and redeem, and why the pool always covers every share"
      width={920}
      height={560}
      minWidth={740}
      legend={["mezo", "mezonk", "yes", "no"]}
      caption={
        <>
          One MUSD always sits behind each Yes + No pair, so the pool can pay every share whatever the outcome. Fills
          on the order book mint and merge pairs the same way, so they keep the same balance.
        </>
      }
    >
      {/* column heads */}
      <Note x={160} y={46} anchor="middle" size={12.5}>Your MUSD</Note>
      <Note x={460} y={46} anchor="middle" size={12.5}>MezonkExchange</Note>
      <Note x={752} y={46} anchor="middle" size={12.5}>Your shares</Note>

      {/* pool */}
      <Box x={370} y={62} w={180} h={216} label="Collateral pool" sub="one per market" tone="mezonk" emphasis />
      <Note x={460} y={218} anchor="middle" size={12.5}>1 MUSD for</Note>
      <Note x={460} y={236} anchor="middle" size={12.5}>every pair</Note>

      {/* 1 split */}
      <StepDot x={30} y={110} n={1} />
      <Box x={80} y={86} w={160} h={48} label="1 MUSD" tone="mezo" />
      <Flow d="M240 110 H370" tone="mezo" label="split: lock 1 MUSD" at={[305, 101]} />
      <Flow d="M550 110 H652" tone="mezonk" label="mint" at={[601, 101]} />
      <Box x={652} y={86} w={96} h={48} label="1 Yes" tone="yes" />
      <Box x={756} y={86} w={96} h={48} label="1 No" tone="no" />
      <Note x={80} y={156} size={12.5}>Live markets only</Note>

      {/* 2 merge */}
      <StepDot x={30} y={230} n={2} />
      <Box x={80} y={206} w={160} h={48} label="1 MUSD" tone="mezo" />
      <Flow d="M370 230 H240" tone="mezo" label="1 MUSD back" at={[305, 221]} />
      <Flow d="M652 230 H550" tone="mezonk" label="merge: burn" at={[601, 221]} />
      <Box x={652} y={206} w={96} h={48} label="1 Yes" tone="yes" />
      <Box x={756} y={206} w={96} h={48} label="1 No" tone="no" />
      <Note x={80} y={276} size={12.5}>After launch, until the outcome is final</Note>

      <line x1={20} x2={900} y1={306} y2={306} stroke="var(--border)" />

      {/* 3 redeem */}
      <StepDot x={30} y={340} n={3} />
      <text x={50} y={345} fontSize={13.5} fontWeight={600} fill="var(--ink)">
        Redeem once the outcome is final
      </text>
      <Note x={140} y={382} anchor="middle" size={12.5}>Final outcome</Note>
      <Note x={318} y={382} anchor="middle" size={12.5}>Each Yes share pays</Note>
      <Note x={494} y={382} anchor="middle" size={12.5}>Each No share pays</Note>

      <Box x={60} y={394} w={160} h={40} label="Yes" tone="neutral" />
      <Box x={236} y={394} w={164} h={40} label="1 MUSD" tone="yes" />
      <Box x={412} y={394} w={164} h={40} label="0" tone="neutral" />

      <Box x={60} y={442} w={160} h={40} label="No" tone="neutral" />
      <Box x={236} y={442} w={164} h={40} label="0" tone="neutral" />
      <Box x={412} y={442} w={164} h={40} label="1 MUSD" tone="no" />

      <Box x={60} y={490} w={160} h={40} label="Invalid" tone="neutral" />
      <Box x={236} y={490} w={164} h={40} label="0.50 MUSD" tone="yes" />
      <Box x={412} y={490} w={164} h={40} label="0.50 MUSD" tone="no" />

      {/* invariant */}
      <text x={624} y={406} fontSize={13.5} fontWeight={600} fill="var(--ink)">
        Always true
      </text>
      <Note x={624} y={430} size={12.5}>Before final: pool = Yes shares</Note>
      <Note x={624} y={448} size={12.5}>outstanding = No shares outstanding.</Note>
      <Note x={624} y={476} size={12.5}>After final: pool = what the</Note>
      <Note x={624} y={494} size={12.5}>shares left can still redeem for.</Note>
      <Note x={624} y={522} size={12.5}>Redeeming burns your shares.</Note>
    </Figure>
  );
}
