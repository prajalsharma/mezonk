"use client";

import { Box, Figure, Flow, FlowLabel, Group, Note } from "./primitives";

/*
 * The whole system. Sources: apps/web/src/lib/chain/config.ts (one exchange address, the other three derived),
 * apps/web/src/server/orderbook.ts (suggests sources, holds no keys), apps/web/src/server/indexer/indexer.ts
 * (getLogs over all four contracts), apps/web/src/lib/mezo/borrow.ts (wallet calls BorrowerOperations directly),
 * apps/web/scripts/market-maker.ts (placeOrder; keeper settle() on MezonkPriceResolver).
 */
export function SystemDiagram() {
  return (
    <Figure
      title="MEZONK system: browser and wallet, Next.js server, MEZONK and Mezo contracts, market-maker bot"
      width={940}
      height={632}
      minWidth={760}
      legend={["mezonk", "mezo", "user", "offchain"]}
      caption={
        <>
          Every transaction goes from your wallet straight to the contracts. The server indexes events, serves JSON
          and suggests which orders a trade could fill, but it holds no keys and can&apos;t move funds. Balances,
          stage and claimable amounts are always read live from the chain.
        </>
      }
    >
      {/* ── Browser ── */}
      <Group x={20} y={20} w={560} h={192} label="Browser" tone="user" />
      <Box x={44} y={48} w={512} h={48} label="MEZONK web app" sub="Next.js client · wagmi · React Query" tone="offchain" />
      <Box x={336} y={126} w={220} h={52} label="Your wallet" sub="signs every transaction" tone="user" emphasis />
      <Flow d="M446 96 V126" tone="user" label="sign request" at={[456, 116]} anchor="start" animated={false} />

      {/* ── Server ── */}
      <Group x={20} y={228} w={560} h={220} label="MEZONK server (Next.js)" tone="offchain" />
      <Box x={44} y={268} w={212} h={52} label="/api routes" sub="JSON: lists, books, quotes" tone="offchain" />
      <Box x={344} y={268} w={212} h={52} label="Order service" sub="suggests fill sources only" tone="offchain" />
      <Box x={44} y={376} w={212} h={52} label="Postgres" sub="events + read tables" tone="offchain" />
      <Box x={344} y={376} w={212} h={52} label="Indexer" sub="embedded, cron or worker" tone="offchain" />

      <Flow d="M200 96 V268" tone="offchain" both label="fetch JSON" at={[208, 166]} anchor="start" />
      <Flow d="M256 294 H344" tone="offchain" label="quote, book" at={[300, 286]} />
      <Flow d="M100 320 V376" tone="offchain" both label="queries" at={[108, 352]} anchor="start" />
      <Flow d="M420 320 V348 H200 V376" tone="offchain" label="signed orders" at={[310, 342]} />
      <Flow d="M344 402 H256" tone="offchain" label="writes" at={[300, 395]} />

      {/* ── Bot ── */}
      <Group x={20} y={464} w={560} h={144} label="Bot host (optional, testnet)" tone="offchain" />
      <Box x={344} y={490} w={212} h={92} label="Market-maker bot" sub="+ keeper for price markets" tone="offchain" />
      <Note x={44} y={524} size={12.5}>A separate process with its</Note>
      <Note x={44} y={542} size={12.5}>own wallet key. Not the server.</Note>

      {/* ── Mezo chain ── */}
      <Group x={616} y={20} w={304} h={596} label="Mezo chain" tone="neutral" />
      <Group x={632} y={44} w={272} h={196} label="Mezo" tone="mezo" />
      <Box x={648} y={78} w={232} h={44} label="PriceFeed" sub="BTC/USD price" tone="mezo" />
      <Box x={648} y={130} w={232} h={44} label="Borrowing contracts" sub="BorrowerOperations, TroveManager" tone="mezo" />
      <Box x={648} y={182} w={232} h={44} label="MUSD" sub="Mezo's dollar (ERC-20)" tone="mezo" />

      <Group x={632} y={264} w={272} h={336} label="MEZONK contracts" tone="mezonk" />
      <Box x={648} y={332} w={232} h={44} label="MezonkMarketFactory" tone="mezonk" />
      <Box x={648} y={384} w={232} h={44} label="MezonkResolution" tone="mezonk" />
      <Box x={648} y={436} w={232} h={44} label="MezonkIncentives" tone="mezonk" />
      <Box x={648} y={488} w={232} h={44} label="MezonkExchange" sub="holds the MUSD" tone="mezonk" emphasis />
      <Box x={648} y={540} w={232} h={44} label="MezonkPriceResolver" sub="next deployment" tone="mezonk" dashed />

      {/* wallet → chain */}
      <Flow d="M556 152 H648" tone="mezo" label="borrow" at={[602, 146]} />
      <Flow d="M556 168 H604 V296 H632" tone="mezonk" />
      <FlowLabel x={644} y={301} anchor="start">signed transactions</FlowLabel>

      {/* chain → app (live reads) */}
      <Flow d="M632 312 H590 V200 H300 V96" tone="offchain" label="live reads: stage, balances, claimable" at={[446, 193]} />
      <FlowLabel x={644} y={318} anchor="start">live reads</FlowLabel>

      {/* chain → indexer */}
      <Flow d="M632 402 H556" tone="offchain" label="getLogs" at={[594, 396]} />

      {/* bot → contracts */}
      <Flow d="M556 510 H648" tone="offchain" label="placeOrder" at={[602, 504]} />
      <Flow d="M556 562 H648" tone="offchain" dashed label="settle()" at={[602, 556]} />

      {/* exchange ⇄ MUSD */}
      <Flow d="M880 510 H894 V204 H880" tone="mezo" both />
      <FlowLabel x={888} y={256} anchor="end">MUSD in and out</FlowLabel>
    </Figure>
  );
}
